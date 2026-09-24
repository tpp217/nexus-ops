/**
 * Vercel API Route: /api/tables/meeting_records
 * Supabase の meeting_records テーブルへの CRUD
 * - GET（ページング取得）/ POST（upsert）/ DELETE（自テナント全件削除・level 0/1 のみ）
 *   個別の PUT/DELETE は meeting_records/[id].js で処理
 *
 * シークレット: Vercel 環境変数から注入
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY
 */
import { createClient } from '@supabase/supabase-js';
import { evaluateAuth, sendBlock, resolveTenant, tenantRequired } from '../_lib/auth-gate.js';

// PostgREST の max-rows（既定 1000）を超える limit は黙って切られるため、上限をそろえる。
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 300;

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase 環境変数が未設定です');
  return createClient(url, key);
}

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export default async function handler(req, res) {
  // 同一オリジンのアプリのみが呼ぶため CORS ヘッダは出さない。
  // 認証ゲート（既定は監視のみ・ブロックしない / AUTH_ENFORCE=on でブロック）
  const auth = await evaluateAuth({
    authHeader: req.headers.authorization,
    cookieHeader: req.headers.cookie,
    method: req.method,
    path: '/api/tables/meeting_records',
  });
  if (!auth.allowed) return sendBlock(res, auth);

  // テナント解決（永続業務データは必ず tenant_id でスコープする＝主たる防御）。未解決は 401。
  const tenant = resolveTenant(auth.claims);
  if (!tenant.ok) return sendBlock(res, tenantRequired());
  const tenantId = tenant.tenantId;

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const limit = Math.min(Math.max(toInt(req.query.limit, DEFAULT_LIMIT), 1), MAX_LIMIT);
      const offset = Math.max(toInt(req.query.offset, 0), 0);
      // total は limit に依存しない全件数（count: 'exact'）。ページングのため id で順序を固定する。
      // 自テナントの行のみ（クロステナント漏洩防止）。
      const { data, error, count } = await supabase
        .from('meeting_records')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return res.json({ data, total: count ?? data.length, limit, offset });
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

    if (req.method === 'DELETE') {
      // 全件削除は L0（運営）/ L1（テナント管理者）のみ。claims が無い（単体版等）場合も不可。
      const level = auth.claims ? auth.claims.level : null;
      if (level !== 0 && level !== 1) {
        return res.status(403).json({ error: '全件削除は管理者のみ実行できます' });
      }
      const { error, count } = await supabase
        .from('meeting_records')
        .delete({ count: 'exact' })
        .eq('tenant_id', tenantId);
      if (error) throw error;
      return res.json({ ok: true, deleted: count ?? null });
    }

    res.status(405).json({ error: 'Method Not Allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
