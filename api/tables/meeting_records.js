/**
 * Vercel API Route: /api/tables/meeting_records
 * Supabase の meeting_records テーブルへの CRUD
 * - GETとPOSTを処理 (PUT/DELETEは meeting_records/[id].js で処理)
 *
 * シークレット: Vercel 環境変数から注入
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { evaluateAuth, sendBlock } from '../_lib/auth-gate.js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase 環境変数が未設定です');
  return createClient(url, key);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 認証ゲート（既定は監視のみ・ブロックしない / AUTH_ENFORCE=on でブロック）
  const auth = await evaluateAuth({
    authHeader: req.headers.authorization,
    method: req.method,
    path: '/api/tables/meeting_records',
  });
  if (!auth.allowed) return sendBlock(res, auth);

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const limit = parseInt(req.query.limit) || 300;
      const { data, error } = await supabase
        .from('meeting_records')
        .select('*')
        .limit(limit);
      if (error) throw error;
      return res.json({ data, total: data.length });
    }

    if (req.method === 'POST') {
      const r = req.body;
      const { data, error } = await supabase
        .from('meeting_records')
        .upsert(r, { onConflict: 'sheet_name,source_file' })
        .select()
        .single();
      if (error) throw error;
      return res.json(data);
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
