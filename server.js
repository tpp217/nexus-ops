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
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(new Error(err.message));
      const jsonMatch = stdout.match(/\{[\s\S]*?"ai_[a-z_]+"[\s\S]*\}/);
      if (!jsonMatch) return reject(new Error('AI応答の解析失敗: ' + stdout.substring(0, 300)));
      try {
        resolve(JSON.parse(jsonMatch[0]));
      } catch(e) {
        reject(new Error('JSONパース失敗: ' + e.message));
      }
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

  // 新仕様: セクション見出し + 箇条書き構造 + セマンティックハイライトタグ
  const instructions =
    `あなたは人材育成の専門家です。以下の1on1面談記録を読み、総評をJSON形式で返してください。\n` +
    `面談対象：${target || '不明'}。期間：${sheet_name || '不明'}。\n\n` +
    `【面談記録】\n${allText.substring(0, 2000)}\n\n` +
    `■ai_reviewの出力形式（絶対厳守）\n` +
    `必ず以下の構造・文字列で出力する。見出し・改行・行頭「・」を守らない場合は失格。\n\n` +
    `出力テンプレート（この通りに出力すること。\\nは改行）:\n` +
    `【課題】\\n・項目1\\n・項目2\\n【状態】\\n・項目1\\n【モチベーション】\\n・項目1\\n【原因と結果】\\n・項目1\\n・項目2\\n【アクション】\\n・項目1\\n・項目2\n\n` +
    `ルール:\n` +
    `・5つのセクション（課題/状態/モチベーション/原因と結果/アクション）を必ずこの順で全て出す\n` +
    `・各セクション見出しは【】で囲み、直後に\\nで改行する\n` +
    `・各項目は必ず行頭「・」（中点）で開始し、末尾で\\n改行する\n` +
    `・1項目は1〜2文、合計600字前後\n` +
    `・前置き・自己紹介・入力の丸写し・Markdown記法は禁止\n` +
    `・同じ内容を別セクションに繰り返さない\n\n` +
    `■ハイライト指示（セマンティック強調）\n` +
    `特に重要な語句・フレーズを、本文の該当位置で次のタグで囲んでハイライトする:\n` +
    `・《赤|…》＝課題・懸念・リスク・停滞・深刻な問題\n` +
    `・《緑|…》＝強み・成長・改善・成果\n` +
    `・《青|…》＝状態・傾向・事実の把握\n` +
    `・《金|…》＝アクション・方針・決定事項・今後の指針\n` +
    `対象は語句〜短いフレーズ（最大25字）。タグは各セクション1〜3箇所、重要度の高いものだけに絞る。\n\n` +
    `■出力は以下のJSONのみ（前置き・説明・Markdown不可）:\n` +
    `{"ai_review":"上記テンプレートに従った本文（タグ埋め込み済み、\\nで改行）",` +
    `"ai_status":"進行中／停滞中／予定のいずれか一言",` +
    `"ai_actions_decided":["決定したアクション（最大5件）"],` +
    `"ai_actions_pending":["保留・検討中の事項（最大3件）"],` +
    `"ai_actions_planned":["今後予定している事項（最大3件）"]}`;

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
    `あなたは人材育成の専門家です。以下は${target || '対象者'}の${records.length}回分の1on1面談記録です。全体を俯瞰した総合評価をJSON形式で返してください。\n\n` +
    `【面談記録（全${records.length}回分）】\n${summaries.substring(0, 3000)}\n\n` +
    `■ai_reviewの出力形式（絶対厳守）\n` +
    `必ず以下の構造・文字列で出力する。見出し・改行・行頭「・」を守らない場合は失格。\n\n` +
    `出力テンプレート（この通りに出力すること。\\nは改行）:\n` +
    `【総合評価】\\n・項目1\\n・項目2\\n【成長の軌跡】\\n・項目1\\n【一貫した強み】\\n・項目1\\n【継続課題】\\n・項目1\\n【改善傾向】\\n・項目1\\n【懸念】\\n・項目1\\n【今後の方針】\\n・項目1\\n・項目2\n\n` +
    `ルール:\n` +
    `・7つのセクション（総合評価/成長の軌跡/一貫した強み/継続課題/改善傾向/懸念/今後の方針）を必ずこの順で全て出す\n` +
    `・各セクション見出しは【】で囲み、直後に\\nで改行する\n` +
    `・各項目は必ず行頭「・」（中点）で開始し、末尾で\\n改行する\n` +
    `・1項目は1〜2文、合計900字前後\n` +
    `・前置き・自己紹介・入力の丸写し・Markdown記法は禁止\n` +
    `・同じ内容を別セクションに繰り返さない\n\n` +
    `■ハイライト指示（セマンティック強調）\n` +
    `特に重要な語句・フレーズを、本文の該当位置で次のタグで囲んでハイライトする:\n` +
    `・《赤|…》＝課題・懸念・リスク・停滞・深刻な問題\n` +
    `・《緑|…》＝強み・成長・改善・成果\n` +
    `・《青|…》＝状態・傾向・事実の把握\n` +
    `・《金|…》＝アクション・方針・決定事項・今後の指針\n` +
    `対象は語句〜短いフレーズ（最大25字）。タグは各セクション1〜3箇所、重要度の高いものだけに絞る。\n\n` +
    `■出力は以下のJSONのみ（前置き・説明・Markdown不可）:\n` +
    `{"ai_review":"上記テンプレートに従った本文（タグ埋め込み済み、\\nで改行）",` +
    `"ai_status":"進行中／停滞中／予定のいずれか一言",` +
    `"ai_actions_decided":["全体を通じて決定・実行されたこと（最大5件）"],` +
    `"ai_actions_pending":["継続して保留・検討中の事項（最大3件）"],` +
    `"ai_actions_planned":["今後取り組むべき事項（最大3件）"]}`;

  try {
    const result = await gskAnalyzeAsync(instructions, `${target || '個人'}全体総評`, 180000);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('gsk analyze/person error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ NEXUS OPS AIサーバー :${PORT}`);
  console.log(`   役割: AI分析API（gsk依存部分）`);
  console.log(`   DB: Supabase（フォールバック用 /tables/* も有効）`);
  console.log(`   Engine: gsk super_agent (async/parallel)`);
  console.log(`   公開URL: https://zvtfabus.gensparkclaw.com/nexus/api/`);
});
