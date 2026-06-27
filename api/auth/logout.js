// GET /api/auth/logout
//
// wh_token cookie（SSO callback が張る HttpOnly cookie）を即時失効させ、トップへ戻す。
// プラットフォーム版・単体版ともに「現在のセッション cookie を消す」点で同一。
// cookie 削除は Max-Age=0 で行う（Path / 属性は付与時と揃える）。
//
// 後方互換: このエンドポイントは新規追加。既存の挙動には一切干渉しない。
export default function handler(req, res) {
  res.statusCode = 302;
  res.setHeader('Set-Cookie',
    'wh_token=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  res.setHeader('Location', '/');
  res.end();
}
