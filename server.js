/**
 * NEXUS OPS - All-in-One サーバー
 * - 静的ファイル配信 (HTML/CSS/JS)
 * - tables/ REST API (SQLite)
 * - /api/analyze, /api/analyze/person (Gemini AI)
 * PORT: 3100
 */
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3100;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ── DB初期化 ──────────────────────────────────────
const db = new Database(path.join(__dirname, 'nexus-ops.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS meeting_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_name TEXT,
    year_month TEXT,
    source_file TEXT,
    date TEXT,
    location TEXT,
    reporter TEXT,
    target TEXT,
    duration TEXT,
    content_main TEXT,
    tasks_given TEXT,
    personal_issues TEXT,
    evaluation TEXT,
    strengths TEXT,
    challenges TEXT,
    concerns TEXT,
    instructions TEXT,
    progress TEXT,
    next_actions TEXT,
    characteristics TEXT,
    initiatives TEXT,
    relations TEXT,
    growth_signals TEXT,
    manager_actions TEXT,
    period_summary TEXT,
    raw_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── 静的ファイル配信 ─────────────────────────────
app.use(express.static(__dirname));

// ── tables/ REST API ─────────────────────────────

// GET /tables/meeting_records?limit=N
app.get('/tables/meeting_records', (req, res) => {
  const limit = parseInt(req.query.limit) || 300;
  const rows = db.prepare(`SELECT * FROM meeting_records ORDER BY year_month ASC, date ASC LIMIT ?`).all(limit);
  res.json({ data: rows, total: rows.length });
});

// GET /tables/meeting_records/:id
app.get('/tables/meeting_records/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM meeting_records WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// POST /tables/meeting_records
app.post('/tables/meeting_records', (req, res) => {
  const r = req.body;
  const stmt = db.prepare(`
    INSERT INTO meeting_records
      (sheet_name, year_month, source_file, date, location, reporter, target, duration,
       content_main, tasks_given, personal_issues, evaluation,
       strengths, challenges, concerns, instructions, progress, next_actions,
       characteristics, initiatives, relations, growth_signals, manager_actions,
       period_summary, raw_data)
    VALUES
      (@sheet_name, @year_month, @source_file, @date, @location, @reporter, @target, @duration,
       @content_main, @tasks_given, @personal_issues, @evaluation,
       @strengths, @challenges, @concerns, @instructions, @progress, @next_actions,
       @characteristics, @initiatives, @relations, @growth_signals, @manager_actions,
       @period_summary, @raw_data)
  `);
  const info = stmt.run(r);
  const saved = db.prepare(`SELECT * FROM meeting_records WHERE id = ?`).get(info.lastInsertRowid);
  res.json(saved);
});

// PUT /tables/meeting_records/:id
app.put('/tables/meeting_records/:id', (req, res) => {
  const r = req.body;
  const fields = Object.keys(r).filter(k => k !== 'id').map(k => `${k} = @${k}`).join(', ');
  if (!fields) return res.status(400).json({ error: 'no fields' });
  db.prepare(`UPDATE meeting_records SET ${fields} WHERE id = @id`).run({ ...r, id: req.params.id });
  const updated = db.prepare(`SELECT * FROM meeting_records WHERE id = ?`).get(req.params.id);
  res.json(updated);
});

// DELETE /tables/meeting_records/:id
app.delete('/tables/meeting_records/:id', (req, res) => {
  db.prepare(`DELETE FROM meeting_records WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ── ヘルスチェック ────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: GEMINI_MODEL });
});

// ── Gemini AI分析 ─────────────────────────────────

// 単票分析
app.post('/api/analyze', async (req, res) => {
  const { content_main, tasks_given, personal_issues, evaluation, target, sheet_name } = req.body;
  const allText = [content_main, tasks_given, personal_issues, evaluation].filter(Boolean).join('\n');
  if (!allText.trim()) return res.status(400).json({ error: 'テキストが空です' });

  const prompt = `あなたは優秀な人材育成コンサルタントです。
以下はスタッフとの1on1面談記録です。この記録を分析し、JSON形式で回答してください。

【面談対象】${target || '不明'}
【シート名】${sheet_name || '不明'}
【面談記録】
${allText}

以下のJSON形式で分析結果を返してください（日本語で、各配列は最大5件）:
{
  "ai_summary": "この面談全体の3〜5行の要約（カウンセラー視点で具体的に）",
  "ai_strengths": ["発揮されている強みや良い点"],
  "ai_challenges": ["課題・改善が必要な点"],
  "ai_concerns": ["懸念事項や注意すべき点"],
  "ai_next_actions": ["上司として次回までに取るべきアクション"],
  "ai_person_profile": "この人物の特徴・傾向・スタイルを3〜5行でプロファイリング"
}
JSONのみ返してください。`;

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1500, responseMimeType: 'application/json' }
      })
    });
    const data = await response.json();
    if (data.error) return res.status(429).json({ error: data.error.message, code: data.error.code });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    res.json({ ok: true, ...JSON.parse(text) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 個人全体分析
app.post('/api/analyze/person', async (req, res) => {
  const { records, target } = req.body;
  if (!records?.length) return res.status(400).json({ error: 'レコードが空です' });

  const history = records.map(r => {
    const content = [r.content_main, r.tasks_given, r.personal_issues, r.evaluation]
      .filter(Boolean).join(' ').substring(0, 400);
    return `【${r.year_month || r.sheet_name}】${content}`;
  }).join('\n\n');

  const prompt = `あなたは優秀な人材育成コンサルタントです。
以下は【${target || '不明'}】の複数回にわたる1on1面談記録の時系列データです。

【面談履歴（古い順）】
${history}

以下のJSON形式で分析してください（日本語で）:
{
  "ai_overall_summary": "全体を通じた5〜7行の総合評価（変化・成長・継続課題を含む）",
  "ai_growth_track": ["時系列で見た成長・変化のポイント"],
  "ai_persistent_strengths": ["複数回にわたって一貫して見られる強み"],
  "ai_persistent_challenges": ["改善しきれていない継続課題"],
  "ai_future_direction": ["今後の育成・対処方針（具体的なアクション）"],
  "ai_risk_assessment": "このスタッフの現状リスクと機会の評価（2〜3行）"
}
JSONのみ返してください。`;

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2000, responseMimeType: 'application/json' }
      })
    });
    const data = await response.json();
    if (data.error) return res.status(429).json({ error: data.error.message, code: data.error.code });
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    res.json({ ok: true, ...JSON.parse(text) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ NEXUS OPS Server :${PORT}`);
  console.log(`   Static: ${__dirname}`);
  console.log(`   DB: nexus-ops.db`);
  console.log(`   Gemini: ${GEMINI_API_KEY ? '✅' : '❌ 未設定'}`);
});
