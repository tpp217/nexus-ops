/**
 * アプリ動作モード（プラットフォーム版 / 単体販売版）の判定ヘルパ。
 *
 * 目的:
 *   nexus を、現行の「プラットフォーム版」（workspace-hub＝wh の SSO ログイン経由で動く）
 *   に加えて「単体販売版（STANDALONE）」としても出荷できるようにするための、
 *   モードを 1 か所で判定する共通関数。
 *
 * ── 最重要原則：完全後方互換 ──
 *   `STANDALONE` 未設定＝現状のプラットフォーム挙動を一切変えない。単体版の分岐は
 *   フラグ ON のときだけ効く。ON とみなすのは "1" / "true" / "on" / "yes"（大小無視）。
 *   それ以外（未設定含む）はすべて false ＝従来どおり。
 *
 * 設計:
 *   nexus は「静的サイト＋Vercel Functions(JS)」構成。サーバー側（api/*.js, server.js）は
 *   この helper で `process.env.STANDALONE` を読む。クライアント（静的 HTML/JS）はビルド時
 *   インライン化（Next の NEXT_PUBLIC_*）が使えないため、モードは API（/api/auth/me 等）の
 *   レスポンスに additive な真偽値として載せ、フロントはそれを読む（直書きの秘密は無い）。
 *
 * 環境変数:
 *   - STANDALONE  "1"/"true"/"on"/"yes" で単体版。未設定/その他はプラットフォーム版（既定）。
 *   - STANDALONE_TENANT_ID  単体版の固定テナント UUID（auth-gate.js の resolveTenant が参照）。
 *
 * 注意: これは秘密値ではなく構成フラグ。値の真偽だけを公開する（UUID 等は公開しない）。
 */

/** ON とみなす文字列か（"1"/"true"/"on"/"yes"・大小無視・前後空白許容）。 */
function truthy(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

/**
 * 単体販売版か（サーバー側・正本）。
 * `process.env.STANDALONE` のみを参照する。未設定なら false＝プラットフォーム版。
 * @returns {boolean}
 */
export function isStandalone() {
  return truthy(process.env.STANDALONE);
}
