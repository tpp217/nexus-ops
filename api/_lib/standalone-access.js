/**
 * 単体販売版（STANDALONE）の入室許可の判定（サーバー専用）。
 *
 * ── なぜ必要か ──
 *   単体版のログインは Supabase Auth（email/password）だが、Supabase プロジェクトは
 *   複数アプリで共有されている（例: ops DB は複数システムが同居し、自己サインアップを
 *   公開しているアプリもある）。「そのプロジェクトのユーザーなら誰でも入れる」と、
 *   自分でアカウントを作った第三者が顧客（STANDALONE_TENANT_ID）のデータを見たり
 *   変えたりできてしまう。
 *   そこで、管理者が付けた印 app_metadata.standalone_tenant_id がこのアプリの顧客
 *   （env STANDALONE_TENANT_ID）と一致するユーザーだけを通す。
 *   app_metadata は利用者自身では書き換えられない（service_role のみ）ため、印は偽造できない。
 *   判定ルールは template-library の src/lib/standalone-access.ts と同一。
 *
 * ── 利用者の登録方法（管理者） ──
 *   1) Supabase ダッシュボードの Authentication でユーザーを作成する（email/password）。
 *   2) そのユーザーの app_metadata に次を設定する（service_role / 管理 API / SQL で設定）:
 *        {"standalone_tenant_id": "<STANDALONE_TENANT_ID と同じ値>"}
 *      例（SQL）: update auth.users
 *                  set raw_app_meta_data = raw_app_meta_data || '{"standalone_tenant_id":"<値>"}'::jsonb
 *                  where email = '<メールアドレス>';
 *   印の無いユーザーはログイン時に 403（利用権限なし）になる。
 *
 * ── fail-closed ──
 *   STANDALONE_TENANT_ID が未設定（空）なら誰も通さない。
 *
 * ※プラットフォーム版（STANDALONE 未設定）では本ヘルパは呼ばれない。
 */

/** env STANDALONE_TENANT_ID（前後空白を除く）。未設定は空文字＝誰も通さない。 */
export function standaloneAccessTenantId() {
  return String(process.env.STANDALONE_TENANT_ID || '').trim();
}

/**
 * Supabase の /auth/v1/user 応答（user）が単体版の顧客の利用者として登録済みか。
 * テナント未設定なら常に false（fail-closed）。
 */
export function isStandaloneMember(user, tenantId = standaloneAccessTenantId()) {
  if (!user || typeof user !== 'object' || !tenantId) return false;
  const meta = user.app_metadata;
  const mark = meta && typeof meta === 'object' ? meta.standalone_tenant_id : undefined;
  return typeof mark === 'string' && mark.trim() === tenantId;
}

/**
 * ローカルセッション（HMAC cookie の中身）が現在の単体版テナント向けに発行されたものか。
 * ログイン時にセッションへ stid（STANDALONE_TENANT_ID）を刻み、各リクエストで env と照合する
 * （テナント変更や、この判定導入前に発行されたセッションを無効化するため）。
 */
export function sessionMatchesStandaloneTenant(session, tenantId = standaloneAccessTenantId()) {
  if (!session || typeof session !== 'object' || !tenantId) return false;
  return typeof session.stid === 'string' && session.stid === tenantId;
}
