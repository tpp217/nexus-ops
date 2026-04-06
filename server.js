/**
 * NEXUS OPS - All-in-One サーバー
 * - 静的ファイル配信 (HTML/CSS/JS)
 * - tables/ REST API (tpp-api → Turso)
 * - /api/analyze (gsk super_agent, 非同期並列対応)
 * PORT: 3100
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = 3100;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── 静的ファイル配信 ─────────────────────────────
app.use(express.static(__dirname));

// ── tpp-api クライアント（Turso） ─────────────────
const TPP_API_BASE = 'http://127.0.0.1:3001/api/teppei/nexus-ops';
const TPP_API_KEY  = 'a0ea116d6d2e7825390a4ca9e808f6f174087e9abf2fd89bb2e26750c6db1b80';

async function tppGet(collection, query = {}) {
  const params = new URLSearchParams(query).toString();
  const url = `${TPP_API_BASE}/${collection}${params ? '?' + params : ''}`;
  const res = await fetch(url, { headers: { 'X-Api-Key': TPP_API_KEY } });
  if (!res.ok) throw new Error(`GET ${collection} failed: ${res.status}`);
  const json = await res.json();
  return json.data ?? [];
}

async function tppPost(collection, payload) {
  const res = await fetch(`${TPP_API_BASE}/${collection}`, {
    method: 'POST',
    headers: { 'X-Api-Key': TPP_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`POST ${collection} failed: ${res.status}`);
  return res.json();
}

async function tppDelete(collection, id) {
  const url = id ? `${TPP_API_BASE}/${collection}/${id}` : `${TPP_API_BASE}/${collection}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'X-Api-Key': TPP_API_KEY }
  });
  if (!res.ok) throw new Error(`DELETE ${collection} failed: ${res.status}`);
  return res.json();
}

// ── tables/ REST API (tpp-api proxy) ─────────────

app.get('/tables/meeting_records', async (req, res) => {
  try {
    const rows = await tppGet('meeting_records');
    res.json({ data: rows, total: rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/tables/meeting_records/:id', async (req, res) => {
  try {
    const rows = await tppGet('meeting_records');
    const row = rows.find(r => String(r.id) === String(req.params.id));
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/tables/meeting_records', async (req, res) => {
  try {
    const r = req.body;
    const rows = await tppGet('meeting_records');
    const existing = rows.find(x => x.sheet_name === r.sheet_name && x.source_file === r.source_file);
    if (existing) {
      await tppPost('meeting_records', { ...r, id: existing.id });
      const updated = await tppGet('meeting_records');
      const saved = updated.find(x => x.id === existing.id);
      res.json(saved || { ...r, id: existing.id });
    } else {
      await tppPost('meeting_records', r);
      const updated = await tppGet('meeting_records');
      const saved = updated.find(x => x.sheet_name === r.sheet_name && x.source_file === r.source_file)
                 || updated[updated.length - 1];
      res.json(saved || r);
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/tables/meeting_records/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await tppPost('meeting_records', { ...req.body, id });
    const rows = await tppGet('meeting_records');
    const updated = rows.find(x => x.id === id);
    res.json(updated || req.body);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/tables/meeting_records/:id', async (req, res) => {
  try {
    await tppDelete('meeting_records', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ヘルスチェック ────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', engine: 'gsk-super-agent', db: 'turso via tpp-api' });
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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ NEXUS OPS Server :${PORT}`);
  console.log(`   Static: ${__dirname}`);
  console.log(`   DB: Turso (via tpp-api :3001)`);
  console.log(`   Engine: gsk super_agent (async/parallel)`);
});
