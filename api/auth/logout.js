// GET /api/auth/logout
//
// 現在のセッション cookie を即時失効させ、入口へ戻す。
//   - wh_token（プラットフォーム版の SSO ゲート cookie。SSO callback が張る）を失効。
//   - nexus_session（単体版のローカルログイン cookie。単体版では未設定なら無害）も失効（additive）。
// cookie 削除は Max-Age=0 で行う（Path / 属性は付与時と揃える）。
// 遷移先: 単体版は /login、プラットフォーム版は wh の全体ログアウト（下の logoutLocation）。
//
// 後方互換: nexus_session の失効と単体版の遷移先は単体版（STANDALONE）でのみ意味を持つ。
//   プラットフォーム版では wh_token を / へ戻す従来挙動と一致する（nexus_session は存在しない）。
import { setCookie, SESSION_COOKIE } from '../_lib/session.js';
import { isStandalone } from '../_lib/app-mode.js';

const AUTH_ORIGIN = process.env.AUTH_EXPECTED_ISSUER || 'https://auth.utinc.dev';

// 単体版は /login。プラットフォーム版は wh の全体ログアウトへ送る（SSO 着地=/api/auth/callback）。
// wh の 24h セッションを失効させないと、SSO 入口が無音で再ログインしログアウトできない。
export function logoutLocation(req) {
  if (isStandalone()) return '/login';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/auth/callback`;
  return `${AUTH_ORIGIN}/api/auth/logout?redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export default function handler(req, res) {
  setCookie(res, 'wh_token', '', { maxAge: 0 });
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
  res.statusCode = 302;
  res.setHeader('Location', logoutLocation(req));
  res.end();
}
