// 自前 HMAC セッション基盤（サーバー専用 / 依存なし）。
//
// 用途:
//   単体販売版（STANDALONE）のローカルログインで発行するセッション cookie の発行・検証。
//   SESSION_SECRET による HMAC-SHA256 署名トークンを HttpOnly Cookie（nexus_session）で保持する。
//
// 設計:
//   - closing-automation の api/_lib/util.js（同種の HMAC セッション基盤）と同型に揃える。
//   - クライアント（ブラウザ）には秘密鍵を一切渡さない。署名・検証はサーバー側のみ。
//   - トークン形式: base64url(JSON{...payload, exp}) + '.' + base64url(HMAC-SHA256)。
//   - 比較は crypto.timingSafeEqual で定数時間（タイミング攻撃の防御）。
//
// 後方互換:
//   本ファイルは新規追加。プラットフォーム版（STANDALONE 未設定）では呼ばれない経路にのみ
//   組み込む（auth-gate の isStandalone 分岐内など）ため、現挙動には一切干渉しない。

import crypto from 'node:crypto';

export const SESSION_COOKIE = 'nexus_session';
const SESSION_TTL_SEC = 60 * 60 * 12; // 12時間

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が未設定です`);
  return v;
}

// ── セッション（HMAC 署名トークン） ──────────────────────────
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const b64uJson = (obj) => b64u(JSON.stringify(obj));

function sign(data) {
  return crypto.createHmac('sha256', env('SESSION_SECRET')).update(data).digest('base64url');
}

/**
 * payload に exp（12時間後）を付けて署名し、トークン文字列を返す。
 * @param {object} payload  セッションに載せる任意のデータ（uid / name など）
 * @returns {string} "base64url(JSON).base64url(HMAC)"
 */
export function issueSession(payload) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
  const p = b64uJson(body);
  return `${p}.${sign(p)}`;
}

/**
 * トークンの署名と有効期限を検証し、正当ならセッション本体（payload）を返す。
 * 無効 / 改竄 / 失効 / 形式不正は null。
 * @param {string|null|undefined} token
 * @returns {object|null}
 */
export function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [p, sig] = token.split('.');
  // 定数時間比較（タイミング攻撃の防御）。長さ不一致なら即 false。
  const expected = sign(p);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

// ── Cookie ───────────────────────────────────────────────────
/** req.headers.cookie をパースして { name: value } を返す（URL デコード込み）。 */
export function parseCookies(req) {
  const out = {};
  const raw = (req && req.headers && req.headers.cookie) || '';
  raw.split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > -1) {
      const name = c.slice(0, i).trim();
      const val = c.slice(i + 1).trim();
      try { out[name] = decodeURIComponent(val); } catch { out[name] = val; }
    }
  });
  return out;
}

/**
 * Cookie ヘッダ文字列から任意の cookie 値を取り出す（無ければ null）。URL デコード込み。
 * auth-gate（evaluateAuth）はヘッダ文字列を直接受け取るため、req に依存しないこの形を使う。
 * @param {string|null|undefined} cookieHeader
 * @param {string} name
 * @returns {string|null}
 */
export function extractCookie(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      if (v.length > 0) { try { return decodeURIComponent(v); } catch { return v; } }
    }
  }
  return null;
}

/**
 * Set-Cookie を追記する（既存の Set-Cookie を壊さず配列で積む）。
 * 属性: Path=/; Secure; SameSite=Lax; HttpOnly（既定）; Max-Age。
 */
export function setCookie(res, name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'Secure',
    'SameSite=Lax',
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}
