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

  const instructions =
    `あなたは人材育成の専門家です。以下の1on1面談記録を読み、総評をJSON形式で返してください。\n` +
    `面談対象：${target || '不明'}。期間：${sheet_name || '不明'}。\n\n` +
    `【面談記録】\n${allText.substring(0, 2000)}\n\n` +
    `以下の観点を必ず含めた総評文を作成してください：\n` +
    `・課題（何が問題か、どの程度深刻か）\n` +
    `・状態（進行中／停滞中／予定段階のどれか）\n` +
    `・感情・モチベーション（本人の状態や気持ちの読み取り）\n` +
    `・原因と結果（なぜその状態になっているか、何をもたらしているか）\n` +
    `・アクション（決定事項／保留事項／予定に分けて）\n\n` +
    `以下のJSON形式のみで返してください（説明文・前置き不要）:\n` +
    `{"ai_review":"この面談の総評を600〜800字程度の流れのある文章で。上記の観点をすべて自然に織り込むこと。箇条書き禁止。",` +
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
    `以下のJSON形式のみで返してください（説明文・前置き不要）:\n` +
    `{"ai_review":"全体を通じた総合評価を800〜1000字程度の流れのある文章で。成長の軌跡、継続課題、改善傾向、今後の展望を自然に織り込むこと。箇条書き禁止。",` +
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
