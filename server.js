/**
 * NEXUS OPS - Gemini AI分析サーバー
 * PORT: 3100
 */
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3100;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ヘルスチェック
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: GEMINI_MODEL });
});

// 単票分析（1件のMTG記録を分析）
app.post('/api/analyze', async (req, res) => {
  const { content_main, tasks_given, personal_issues, evaluation, target, sheet_name } = req.body;

  if (!content_main && !tasks_given && !personal_issues && !evaluation) {
    return res.status(400).json({ error: 'テキストが空です' });
  }

  const allText = [content_main, tasks_given, personal_issues, evaluation]
    .filter(Boolean).join('\n');

  const prompt = `あなたは優秀な人材育成コンサルタントです。
以下はスタッフとの1on1面談記録です。この記録を分析し、JSON形式で回答してください。

【面談対象】${target || '不明'}
【シート名】${sheet_name || '不明'}
【面談記録】
${allText}

以下のJSON形式で分析結果を返してください（日本語で、各配列は最大5件）:
{
  "ai_summary": "この面談全体の3〜5行の要約（カウンセラー視点で具体的に）",
  "ai_strengths": ["発揮されている強みや良い点（具体的な文）"],
  "ai_challenges": ["課題・改善が必要な点（具体的な文）"],
  "ai_concerns": ["懸念事項や注意すべき点"],
  "ai_next_actions": ["上司・管理者として次回までに取るべきアクション"],
  "ai_person_profile": "この人物の特徴・傾向・スタイルを3〜5行でプロファイリング（強み・弱み・対処法を含む）"
}

JSONのみ返してください。説明文は不要です。`;

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error('Gemini error:', data.error);
      return res.status(429).json({ error: data.error.message, code: data.error.code });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { ai_summary: text };
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 個人レポート分析（複数回分のMTGをまとめて分析）
app.post('/api/analyze/person', async (req, res) => {
  const { records, target } = req.body;

  if (!records || records.length === 0) {
    return res.status(400).json({ error: 'レコードが空です' });
  }

  // 各月のデータをまとめる
  const history = records.map(r => {
    const content = [r.content_main, r.tasks_given, r.personal_issues, r.evaluation]
      .filter(Boolean).join(' ').substring(0, 400);
    return `【${r.year_month || r.sheet_name}】${content}`;
  }).join('\n\n');

  const prompt = `あなたは優秀な人材育成コンサルタントです。
以下は【${target || '不明'}】の複数回にわたる1on1面談記録の時系列データです。
変化・成長・課題の推移を分析し、JSON形式で回答してください。

【面談履歴（古い順）】
${history}

以下のJSON形式で分析してください（日本語で）:
{
  "ai_overall_summary": "全体を通じた5〜7行の総合評価（変化・成長・継続課題を含む）",
  "ai_growth_track": ["時系列で見た成長・変化のポイント（各回の変化を追って）"],
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
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json'
        }
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(429).json({ error: data.error.message, code: data.error.code });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { ai_overall_summary: text };
    }

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ NEXUS OPS AI Server running on http://127.0.0.1:${PORT}`);
  console.log(`   Model: ${GEMINI_MODEL}`);
  console.log(`   API Key: ${GEMINI_API_KEY ? '✅ 設定済み' : '❌ 未設定'}`);
});
