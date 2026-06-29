// GET /api/auth/login
//
// workspace-hub のログイン画面へ誘導する SSO 入口（ランチャーを経由しない直接アクセス用）。
// ログイン成功後は /api/auth/callback に one-time code 付きで戻り、wh_token セッションが確立する。
//
// 単体版（STANDALONE）について:
//   単体版では wh SSO へ飛ばさない（wh を使わない想定のため）。自前ローカルログイン画面
//   /login（login.html）へリダイレクトする。これにより再ログイン導線（auth-icons / index）が
//   両モードとも /api/auth/login を指したまま、単体版では /login に着地する。
import { isStandalone } from '../_lib/app-mode.js';

const AUTH_ORIGIN = process.env.AUTH_EXPECTED_ISSUER || 'https://auth.utinc.dev';

export default function handler(req, res) {
  // 単体版: wh SSO へ飛ばさず、自前ローカルログイン画面 /login へ誘導する。
  if (isStandalone()) {
    res.statusCode = 302;
    res.setHeader('Location', '/login');
    res.end();
    return;
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/auth/callback`;
  res.statusCode = 302;
  res.setHeader('Location', `${AUTH_ORIGIN}/login?redirect_uri=${encodeURIComponent(redirectUri)}`);
  res.end();
}
