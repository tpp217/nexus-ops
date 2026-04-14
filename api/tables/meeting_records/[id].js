/**
 * Vercel API Route: /api/tables/meeting_records/[id]
 * PUT (更新) / DELETE (削除) を処理
 */
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase 環境変数が未設定です');
  return createClient(url, key);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id が必要です' });

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('meeting_records')
        .select('*')
        .eq('id', id)
        .single();
      if (error) return res.status(404).json({ error: 'not found' });
      return res.json(data);
    }

    if (req.method === 'PUT') {
      const { data, error } = await supabase
        .from('meeting_records')
        .update(req.body)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.json(data);
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase
        .from('meeting_records')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
