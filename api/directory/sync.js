// メンバー名簿ディレクトリ同期。workspace-hub のロスターAPI から名簿をプルし、
// ops DB の member_directory（統一形 system_key,tenant_id,member_id）へ upsert する。
// 認証: Authorization: Bearer <SSO_EXCHANGE_SECRET>（サーバー間。ロスターAPI と同じ秘密で保護）。
//   nexus はフロント SSO 統合が無いため、wh_token ではなくサーバー間秘密で守る。
// トリガは運用者 or cron（名簿管理UIが無いためエンドポイント方式）。
// 名簿は将来の担当アサイン等の候補リスト（ログイン未済の人も含む組織名簿）として使う。
//
// このアプリには共通の Supabase REST ヘルパ(sbFetch)が無いため、self-contained で PostgREST を直叩きする。
import crypto from 'node:crypto';

const SB_URL = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const eq = (v) => `eq.${encodeURIComponent(v)}`;

async function sb(path, init = {}) {
  const res = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY(),
      Authorization: `Bearer ${SB_KEY()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST のみ' });

  const secret = (process.env.SSO_EXCHANGE_SECRET || '').trim();
  if (!secret) return res.status(500).json({ ok: false, error: 'SSO_EXCHANGE_SECRET 未設定' });
  if (!SB_URL() || !SB_KEY()) return res.status(500).json({ ok: false, error: 'Supabase 環境変数 未設定' });

  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  const authed =
    token.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  if (!authed) return res.status(401).json({ ok: false, error: 'unauthorized' });

  const tenantId = ((req.query && req.query.tenant_id) || '').trim();
  if (!tenantId) return res.status(400).json({ ok: false, error: 'tenant_id は必須です' });

  const systemKey = (process.env.AUTH_SYSTEM_KEY || 'nexus').trim();

  try {
    // 実行開始時刻はロスター取得より前に取る（後から始まった実行ほど大きい値になるように）。
    // synced_at は DB トリガ（ops: member_directory_keep_latest_synced_at）で後退しないため、
    // 同期が重なっても古い実行が新しい実行の印を消して現役メンバーを無効化することはない。
    const now = new Date().toISOString();

    // --- ロスターをプル ---
    const rosterRes = await fetch(
      `https://auth.utinc.dev/api/roster?tenant_id=${encodeURIComponent(tenantId)}&system_key=${encodeURIComponent(systemKey)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!rosterRes.ok) return res.status(502).json({ ok: false, error: `roster API ${rosterRes.status}` });
    const roster = await rosterRes.json().catch(() => null);
    // members 配列が無い応答を「0 人」と解釈すると全員を無効化してしまうため、データに触らず失敗させる。
    if (!roster || !Array.isArray(roster.members)) {
      return res.status(502).json({ ok: false, error: 'roster API の応答に members 配列がありません' });
    }
    const members = roster.members;

    // --- service_role(REST) で同期。先に upsert、成功後に今回触れなかった人だけ active=false ---
    // （先に全員無効化すると upsert 失敗時に全員が無効のまま残るため順序を逆にする）
    if (members.length) {
      const rows = members.map((m) => ({
        system_key: systemKey,
        tenant_id: tenantId,
        member_id: String(m.id),
        kind: m.kind ?? null,
        display_name: m.display_name ?? '',
        department: m.department ?? null,
        line_user_id: m.line_user_id ?? null,
        active: true,
        source_updated_at: m.updated_at ?? null,
        synced_at: now,
      }));
      await sb('member_directory?on_conflict=system_key,tenant_id,member_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
    }

    // 今回の upsert で synced_at=now にならなかった行＝名簿から消えた人。自テナント・自システムのみ。
    // member_id の not.in リストは人数次第で URL 長上限を超えるため synced_at で判定する。
    await sb(
      `member_directory?system_key=${eq(systemKey)}&tenant_id=${eq(tenantId)}&active=is.true` +
        `&or=(synced_at.is.null,synced_at.lt.${encodeURIComponent(now)})`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ active: false }),
      },
    );

    return res.status(200).json({ ok: true, count: members.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
