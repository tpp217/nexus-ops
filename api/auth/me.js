// GET /api/auth/me  （whoami）
//
// SSO ログイン済みブラウザの本人情報だけを返す軽量エンドポイント。
// フロント（ヘッダ）がマウント時に1回だけ叩き、テナント名・氏名・所属を描画する。
//
// 認証:
//   - wh_token cookie（SSO callback が張る HttpOnly cookie）を JWKS 検証する。
//     ヘッダ Authorization: Bearer も受け付ける（server-to-server / 将来用）。
//   - enforce の有無に関係なく、検証できなければ 401 を返す（whoami は資格情報そのもの）。
//     監視モードでも「未ログインなら 401／ログイン済みなら 200」が成立する＝
//     ヘッダ表示は enforce 点灯を待たずに機能する。
//
// 返却（200）:
//   { ok:true, is_demo, name, tenant_name, department, tenant_id, line_user_id }
//   - is_demo は未配布クレームのとき false 既定（実テナント扱い＝安全側）。
//   - name / tenant_name / department は未配布なら null（フロントはフォールバック表示）。
//
// 注意: 認可境界ではない（systems[] 判定はしない）。あくまで本人の表示用。
//
// 単体版（STANDALONE）について:
//   - 単体版では wh JWT が存在しないため、自前ローカルログインの nexus_session を正本にする。
//     有効な nexus_session が無ければ 401（standalone:true を additive に載せる）。
//     フロントは standalone:true を見て /api/auth/login（SSO）ではなく /login（自前）へ誘導する。
//   - 有効ならログイン済みとして 200。identity（テナント名/部署）は単体版では持たないため
//     空（name は session の email を控えめに使う）。
//   - プラットフォーム版（既定）は従来どおり 401／200 の挙動を一切変えない。
import { verifyToken } from '../_lib/auth-gate.js';
import { isStandalone } from '../_lib/app-mode.js';
import { verifySession, SESSION_COOKIE, parseCookies } from '../_lib/session.js';

/** Cookie ヘッダから wh_token を取り出す（無ければ null）。 */
function extractWhTokenCookie(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'wh_token' && rest.length > 0) {
      const v = rest.join('=').trim();
      if (v.length > 0) return v;
    }
  }
  return null;
}

/** Authorization: Bearer <token> からトークンを取り出す（無ければ null）。 */
function extractBearer(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET のみ' });
  }

  // ブラウザ/プロキシに本人情報をキャッシュさせない。
  res.setHeader('Cache-Control', 'no-store');

  // 単体版: wh JWT を見ずに、自前ローカルログインの nexus_session を正本にする。
  //   - 無効 / 未ログイン → 401（standalone:true）。フロントは /login へ誘導する。
  //   - 有効 → 200。氏名は session の email を控えめに使う（テナント名/部署は単体版では持たない）。
  if (isStandalone()) {
    const session = verifySession(parseCookies(req)[SESSION_COOKIE]);
    if (!session) {
      return res.status(401).json({ ok: false, standalone: true, authenticated: false });
    }
    return res.status(200).json({
      ok: true,
      standalone: true,
      authenticated: true,
      is_demo: false,
      name: (session && session.name) || null,
      tenant_name: null,
      department: null,
      tenant_id: null,
      line_user_id: null,
    });
  }

  const token =
    extractBearer(req.headers.authorization) ??
    extractWhTokenCookie(req.headers.cookie);

  if (!token) {
    return res.status(401).json({ ok: false, error: '未認証です' });
  }

  const result = await verifyToken(token);
  if (!result.ok) {
    return res.status(401).json({ ok: false, error: 'トークンの検証に失敗しました' });
  }

  const c = result.claims;
  return res.status(200).json({
    ok: true,
    standalone: false,
    authenticated: true,
    is_demo: c.is_demo ?? false,
    name: c.name ?? null,
    tenant_name: c.tenant_name ?? null,
    department: c.department ?? null,
    tenant_id: c.tenant_id ?? null,
    line_user_id: c.line_user_id ?? null,
  });
}
