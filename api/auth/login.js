// GET /api/auth/login
//
// workspace-hub のログイン画面へ誘導する SSO 入口（ランチャーを経由しない直接アクセス用）。
// ログイン成功後は /api/auth/callback に one-time code 付きで戻り、wh_token セッションが確立する。
//
// 単体版（STANDALONE）について:
//   単体版では wh SSO へ飛ばさない（wh を使わない想定のため）。ただし nexus には現状
//   「単体版の自前ログイン」が未整備（要実装）。当面は wh SSO へ誘導せず、その旨を返す。
//   自前ログイン実装後は、ここを単体版ログイン画面へのリダイレクトに差し替える。
import { isStandalone } from '../_lib/app-mode.js';

const AUTH_ORIGIN = process.env.AUTH_EXPECTED_ISSUER || 'https://auth.utinc.dev';

export default function handler(req, res) {
  // 単体版: wh SSO へ飛ばさない。自前ログイン未整備のため案内のみ返す。
  if (isStandalone()) {
    res.statusCode = 501;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      ok: false,
      standalone: true,
      error: '単体版ログインは未整備です（要実装）。',
    }));
    return;
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/auth/callback`;
  res.statusCode = 302;
  res.setHeader('Location', `${AUTH_ORIGIN}/login?redirect_uri=${encodeURIComponent(redirectUri)}`);
  res.end();
}
