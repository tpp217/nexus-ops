/**
 * Vercel API Route: /api/tables/meeting_records
 * Supabase の meeting_records テーブルへの CRUD
 * - GETとPOSTを処理 (PUT/DELETEは meeting_records/[id].js で処理)
 *
 * シークレット: Vercel 環境変数から注入
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { evaluateAuth, sendBlock, resolveTenant, tenantRequired } from '../_lib/auth-gate.js';

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
    cookieHeader: req.headers.cookie,
    method: req.method,
    path: '/api/tables/meeting_records',
  });
  if (!auth.allowed) return sendBlock(res, auth);

  // テナント解決（永続業務データは必ず tenant_id でスコープする＝主たる防御）。
  // 未解決は fail-closed（enforce 時 401／監視モードは utinc 既定にフォールバック）。
  const tenant = resolveTenant(auth.claims);
  if (!tenant.ok) return sendBlock(res, tenantRequired());
  const tenantId = tenant.tenantId;

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const limit = parseInt(req.query.limit) || 300;
      // total は limit に依存しない全件数を返す（count: 'exact'）。
      // これがないと limit=1 の集計取得で total が常に 1 になりダッシュボードの件数が誤る。
      // 自テナントの行のみ（クロステナント漏洩防止）。
      const { data, error, count } = await supabase
        .from('meeting_records')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .limit(limit);
      if (error) throw error;
      return res.json({ data, total: count ?? data.length });
    }

    if (req.method === 'POST') {
      // クライアント由来の tenant_id は信用せず、必ずサーバー側の解決値で上書き。
      const r = { ...req.body, tenant_id: tenantId };
      const { data, error } = await supabase
        .from('meeting_records')
        .upsert(r, { onConflict: 'tenant_id,sheet_name,source_file' })
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
