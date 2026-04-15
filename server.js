/**
 * NEXUS OPS - VM AIサーバー
 * 役割: gsk依存のAI分析APIのみを担当（Vercelで動かせない処理）
 *
 * エンドポイント:
 *   GET  /api/health          ヘルスチェック
 *   POST /api/analyze         単票AI分析
 *   POST /api/analyze/person  個人全体AI分析
 *
 * ※ 静的ファイルと /tables/* はVercel側で配信する
 * PORT: 3100
 * 起動: doppler run -- node server.js
 */
import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const app  = express();
const PORT = process.env.PORT || 3100;

// CORSはVercelドメインとローカル開発を許可
const ALLOWED_ORIGINS = [
  'https://zvtfabus.gensparkclaw.com',
  'http://localhost:3000',
  'http://localhost:3100',
  /\.vercel\.app$/,
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // 同一オリジン / postmanなど
    const ok = ALLOWED_ORIGINS.some(p =>
      typeof p === 'string' ? p === origin : p.test(origin)
    );
    cb(ok ? null : new Error('CORS: 許可されていないオリジン'), ok);
  },
}));
app.use(express.json({ limit: '2mb' }));

// ── Supabase クライアント ────────────────────────
// シークレットはDopplerで注入: doppler run -- node server.js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_KEY が未設定です。');
  console.error('   起動: doppler run -- node server.js');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── tables/ REST API (Supabase) ─────────────────
// NOTE: VercelのAPI Routesに移行予定。VMでも動作するよう残しておく。

app.get('/tables/meeting_records', async (req, res) => {
  try {
    const { data, error } = await supabase.from('meeting_records').select('*');
    if (error) throw error;
    res.json({ data, total: data.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/tables/meeting_records/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('meeting_records').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'not found' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/tables/meeting_records', async (req, res) => {
  try {
    const r = req.body;
    const { data, error } = await supabase
      .from('meeting_records')
      .upsert(r, { onConflict: 'sheet_name,source_file' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/tables/meeting_records/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('meeting_records')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/tables/meeting_records/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('meeting_records').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ヘルスチェック ────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'gsk-super-agent', db: 'supabase' });
});

// ── AI分析（gsk super_agent, 非同期） ────────────

/**
 * gsk を非同期で実行してJSONを返すPromise
 */
function gskAnalyzeAsync(instructions, taskName, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const escaped = instructions.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    const cmd = `gsk task super_agent --task_name "${taskName}" --query "以下をJSONで分析してください" --instructions '${escaped}' --output text 2>&1`;
    exec(cmd, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      // バランスの取れた { ... } を拾う（ネスト可能）
      const start = stdout.indexOf('{');
      if (start < 0) return reject(new Error('AI応答の解析失敗: ' + stdout.substring(0, 300)));
      let depth = 0, end = -1;
      for (let i = start; i < stdout.length; i++) {
        if (stdout[i] === '{') depth++;
        else if (stdout[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end < 0) return reject(new Error('JSONブロック閉じ未検出'));
      try {
        resolve(JSON.parse(stdout.substring(start, end + 1)));
      } catch(e) {
        reject(new Error('JSONパース失敗: ' + e.message));
      }
    });
  });
}

/**
 * 汎用テキスト生成（JSONを強制しない、プレーンテキスト応答）
 */
function gskGenerateText(instructions, taskName, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const escaped = instructions.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
    const cmd = `gsk task super_agent --task_name "${taskName}" --query "指示通りテキストを生成してください" --instructions '${escaped}' --output text 2>&1`;
    exec(cmd, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      resolve(stdout.trim());
    });
  });
}

/**
 * POST /api/analyze
 * 単票分析（総評形式）— 非同期、並列処理可能
 */
app.post('/api/analyze', async (req, res) => {
  const { content_main, tasks_given, personal_issues, evaluation, target, sheet_name } = req.body;
  const allText = [content_main, tasks_given, personal_issues, evaluation].filter(Boolean).join('\n');
  if (!allText.trim()) return res.status(400).json({ error: 'テキストが空です' });

  // v3: 余計な見出しを出させないため、ai_review を箇条書き配列で返させる
  const instructions =
    `あなたは人材育成の専門家。以下の1on1面談記録（対象:${target || '不明'} / 期間:${sheet_name || '不明'}）を読み、要点をまとめる。\n\n` +
    `【面談記録】\n${allText.substring(0, 5000)}\n\n` +
    `出力はJSONのみ。Markdown・見出し・前置き一切禁止。\n\n` +
    `{"ai_review":["要点1","要点2","要点3","要点4","要点5"],` +
    `"ai_status":"進行中",` +
    `"ai_actions_decided":[],"ai_actions_pending":[],"ai_actions_planned":[]}\n\n` +
    `ルール:\n` +
    `- ai_reviewは4〜6件の文字列配列。1件=1〜2文（40〜80字）。箇条書き記号や見出しは不要（配列がそのまま箇条書きになる）。\n` +
    `- 観点は「課題・状態・モチベ・原因/結果・見落とせない事実」をバランス良く。同じ内容は重複させない。\n` +
    `- ai_statusは「進行中」「停滞中」「予定」のいずれか1語。\n` +
    `- ai_actions_decided/pending/plannedはそれぞれ短文配列（各最大3件、短く）。無ければ[]。\n` +
    `- 入力の丸写し禁止。必ず要約する。`;

  try {
    const result = await gskAnalyzeAsync(instructions, '面談総評');
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('gsk analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/analyze/person
 * 個人全体AI分析（複数レコードをまとめて総評）
 */
app.post('/api/analyze/person', async (req, res) => {
  const { records, target } = req.body;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'レコードが空です' });
  }

  const summaries = records.map((r, i) => {
    const text = [r.content_main, r.tasks_given, r.personal_issues, r.evaluation].filter(Boolean).join(' ');
    return `【${i+1}回目 ${r.sheet_name || ''}】${text.substring(0, 500)}`;
  }).join('\n\n');

  const instructions =
    `あなたは人材育成の専門家。${target || '対象者'}の${records.length}回分の1on1面談記録から全体を俯瞰した要点をまとめる。\n\n` +
    `【面談記録（全${records.length}回分）】\n${summaries.substring(0, 8000)}\n\n` +
    `出力はJSONのみ。Markdown・見出し・前置き一切禁止。\n\n` +
    `{"ai_review":["要点1","要点2","要点3","要点4","要点5","要点6"],` +
    `"ai_status":"進行中",` +
    `"ai_actions_decided":[],"ai_actions_pending":[],"ai_actions_planned":[]}\n\n` +
    `ルール:\n` +
    `- ai_reviewは6〜8件の文字列配列。1件=1〜2文（40〜90字）。箇条書き記号や見出しは不要。\n` +
    `- 観点は「成長の軌跡・一貫した強み・継続課題・改善傾向・懸念・今後の方針」をバランス良く。重複禁止。\n` +
    `- ai_statusは「進行中」「停滞中」「予定」のいずれか1語。\n` +
    `- ai_actions_decided/pending/plannedは短文配列（各最大3件）。無ければ[]。\n` +
    `- 入力の丸写し禁止。必ず要約する。`;

  try {
    const result = await gskAnalyzeAsync(instructions, `${target || '個人'}全体総評`, 180000);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('gsk analyze/person error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/highlight
 * 箇条書き配列の各項目に対し、重要語句を《色|…》タグで囲んで返す。
 * body: { items: string[] } → { items: string[] }（元の配列順を維持）
 */
app.post('/api/highlight', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items が空です' });
  }
  const payload = items.map((s, i) => `${i+1}. ${s}`).join('\n');
  const instructions =
    `次の箇条書きの各行について、重要な語句を以下のタグで囲み、その他は一切変更せずに返してください。\n` +
    `・《赤|…》＝課題・懸念・リスク・停滞・深刻な問題\n` +
    `・《緑|…》＝強み・成長・改善・成果\n` +
    `・《青|…》＝状態・傾向・事実の把握\n` +
    `・《金|…》＝アクション・方針・決定事項・今後の指針\n\n` +
    `ルール:\n` +
    `- 各行につきタグは0〜2箇所。明確に該当する語だけ。過剰につけない。\n` +
    `- タグの内側は最大20字の語句。文全体を囲まない。\n` +
    `- 行番号 "${items.length > 9 ? 'N.' : 'N.'}" はそのまま保持。行の追加・削除・並び替え禁止。\n` +
    `- 説明文・前置き・Markdown禁止。番号付き行だけを返す。\n\n` +
    `【入力】\n${payload}\n\n` +
    `【出力】上記と同じ形式で、タグを付けて返す。`;

  try {
    const text = await gskGenerateText(instructions, 'ハイライト付与', 90000);
    // 行ごとに「N. 本文」を拾って番号順に整理
    const map = new Map();
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*(\d+)[\.\．、)]\s*(.+)$/);
      if (m) map.set(parseInt(m[1]), m[2].trim());
    });
    const out = items.map((orig, i) => map.get(i + 1) || orig);
    res.json({ ok: true, items: out });
  } catch (err) {
    console.error('gsk highlight error:', err.message);
    // 失敗時は元の配列をそのまま返す（UIは崩れない）
    res.status(200).json({ ok: false, items, error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ NEXUS OPS AIサーバー :${PORT}`);
  console.log(`   役割: AI分析API（gsk依存部分）`);
  console.log(`   DB: Supabase（フォールバック用 /tables/* も有効）`);
  console.log(`   Engine: gsk super_agent (async/parallel)`);
  console.log(`   公開URL: https://zvtfabus.gensparkclaw.com/nexus/api/`);
});
