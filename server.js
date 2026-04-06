/**
 * NEXUS OPS - All-in-One サーバー
 * - 静的ファイル配信 (HTML/CSS/JS)
 * - tables/ REST API (SQLite)
 * - /api/analyze, /api/analyze/person (gsk super_agent)
 * PORT: 3100
 */
import express from 'express';
import { execSync } from 'child_process';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3100;
// gsk CLIを使用（Gemini不要）

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
    ai_summary TEXT DEFAULT '',
    ai_strengths TEXT DEFAULT '[]',
    ai_challenges TEXT DEFAULT '[]',
    ai_concerns TEXT DEFAULT '[]',
    ai_next_actions TEXT DEFAULT '[]',
    ai_person_profile TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 既存DBへのマイグレーション（カラムがなければ追加）
['ai_summary','ai_strengths','ai_challenges','ai_concerns','ai_next_actions','ai_person_profile','ai_review','ai_status','ai_actions_decided','ai_actions_pending','ai_actions_planned'].forEach(col => {
  try { db.exec(`ALTER TABLE meeting_records ADD COLUMN ${col} TEXT DEFAULT ''`); } catch {}
});

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
  res.json({ status: 'ok', engine: 'gsk-super-agent' });
});

// ── Gemini AI分析 ─────────────────────────────────

// ── AI分析（gsk super_agent使用）────────────────

function gskAnalyze(instructions, taskName, timeout) {
  const escaped = instructions.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  const cmd = `gsk task super_agent --task_name "${taskName}" --query "以下をJSONで分析してください" --instructions '${escaped}' --output text 2>&1`;
  const output = execSync(cmd, { timeout: timeout || 120000, encoding: 'utf8' });

  // JSON部分を抽出（複数パターン対応）
  const jsonMatch = output.match(/\{[\s\S]*?"ai_[a-z_]+"[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI応答の解析失敗: ' + output.substring(0, 300));
  return JSON.parse(jsonMatch[0]);
}

// 単票分析（総評形式）
app.post('/api/analyze', (req, res) => {
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
    const result = gskAnalyze(instructions, '面談総評', 120000);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('gsk analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 個人全体分析
app.post('/api/analyze/person', (req, res) => {
  const { records, target } = req.body;
  if (!records?.length) return res.status(400).json({ error: 'レコードが空です' });

  const history = records.map(r => {
    const c = [r.content_main, r.tasks_given, r.personal_issues, r.evaluation]
      .filter(Boolean).join(' ').substring(0, 300);
    return `【${r.year_month || r.sheet_name}】${c}`;
  }).join('\n\n');

  const instructions =
    `対象者：${target || '不明'} の複数回にわたる面談記録の時系列データです。\n` +
    `${history.substring(0, 3000)}\n\n` +
    `以下のJSON形式のみで返してください（説明文不要）:\n` +
    `{"ai_overall_summary":"全体を通じた5〜7行の総合評価（変化・成長・継続課題含む）",` +
    `"ai_growth_track":["時系列で見た成長・変化のポイント（最大5件）"],` +
    `"ai_persistent_strengths":["一貫して見られる強み（最大5件）"],` +
    `"ai_persistent_challenges":["改善しきれていない継続課題（最大5件）"],` +
    `"ai_future_direction":["今後の育成・対処方針（最大5件）"],` +
    `"ai_risk_assessment":"現状リスクと機会の評価（2〜3行）"}`;

  try {
    const result = gskAnalyze(instructions, '個人総合分析', 180000);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('gsk person error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ NEXUS OPS Server :${PORT}`);
  console.log(`   Static: ${__dirname}`);
  console.log(`   DB: nexus-ops.db`);
  console.log(`   Engine: gsk super_agent`);
});
