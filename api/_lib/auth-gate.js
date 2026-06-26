/**
 * 認証ゲート（監視モード対応）
 *
 * workspace-hub が発行する JWT（RS256）を JWKS で検証する共通ヘルパ。
 * Vercel Functions（api/*.js）と Express（server.js）の両方から import して使う。
 *
 * ── 設計の核心：既定では「監視のみ」でブロックしない ──
 *   - 既定（AUTH_ENFORCE 未設定 / "off"）では、トークンの有無・検証可否を
 *     console に記録するだけで、リクエストは常に通す（現挙動を一切変えない）。
 *   - AUTH_ENFORCE=on のときだけ、検証失敗 / トークン欠如 / 対象システム不一致を
 *     401 / 403 でブロックする。
 *
 * 環境変数:
 *   - JWKS_URL             JWKS エンドポイント（既定 https://auth.utinc.dev/.well-known/jwks.json）
 *   - AUTH_EXPECTED_ISSUER 期待する iss（既定 https://auth.utinc.dev）。署名に加え発行者を照合（なりすまし二重防御）
 *   - AUTH_ENFORCE         "on" でブロック有効化。それ以外（未設定含む）は監視のみ
 *   - AUTH_SYSTEM_KEY 自アプリのシステムキー（既定 "nexus" = workspace-hub SYSTEM_CATALOG のキー）。
 *                     enforce 時、JWT の systems[] にこのキーが含まれるかを検証
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

const DEFAULT_JWKS_URL = 'https://auth.utinc.dev/.well-known/jwks.json';
// workspace-hub SYSTEM_CATALOG の 'nexus' と一致（AUTH_SYSTEM_KEY で上書き可）
const DEFAULT_SYSTEM_KEY = 'nexus';
// workspace-hub が発行する JWT の iss は "https://auth.utinc.dev" 固定（署名時に強制）
const DEFAULT_ISSUER = 'https://auth.utinc.dev';

/** 期待する issuer（AUTH_EXPECTED_ISSUER で上書き可） */
function expectedIssuer() {
  return process.env.AUTH_EXPECTED_ISSUER || DEFAULT_ISSUER;
}

/** enforce が有効か（"on" のときだけ true） */
export function isEnforcing() {
  return String(process.env.AUTH_ENFORCE || '').toLowerCase() === 'on';
}

/** 自アプリのシステムキー */
function systemKey() {
  return process.env.AUTH_SYSTEM_KEY || DEFAULT_SYSTEM_KEY;
}

// JWKS は遅延生成してプロセス内でキャッシュ（jose が内部で鍵をキャッシュ／更新する）
let _jwks = null;
function getJWKS() {
  if (!_jwks) {
    const url = process.env.JWKS_URL || DEFAULT_JWKS_URL;
    _jwks = createRemoteJWKSet(new URL(url));
  }
  return _jwks;
}

/** Authorization: Bearer <token> からトークンを取り出す（無ければ null） */
/** Cookie ヘッダから wh_token を取り出す（無ければ null）。SSO callback が張る HttpOnly cookie。 */
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

function extractBearer(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * JWT を検証してクレームを取り出す。
 * 成功: { ok:true, claims:{ tenant_id, level, capabilities, systems, sub, line_user_id,
 *                          is_demo, name, tenant_name, department } }
 * 失敗: { ok:false, reason }
 *
 * is_demo / name / tenant_name / department は workspace-hub が additive 署名する
 * 「表示ヒント」クレーム（認可境界ではない）。下流は読むだけ。未配布でも安全に undefined。
 */
export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, getJWKS(), { issuer: expectedIssuer() });
    return {
      ok: true,
      claims: {
        tenant_id:    payload.tenant_id ?? null,
        level:        payload.level ?? null,
        capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
        systems:      Array.isArray(payload.systems) ? payload.systems : [],
        sub:          payload.sub ?? null,
        line_user_id: typeof payload.line_user_id === 'string' ? payload.line_user_id : null,
        // ── 表示ヒント（additive・未配布なら undefined） ──
        is_demo:      typeof payload.is_demo === 'boolean' ? payload.is_demo : undefined,
        name:         typeof payload.name === 'string' ? payload.name : undefined,
        tenant_name:  typeof payload.tenant_name === 'string' ? payload.tenant_name : undefined,
        department:   typeof payload.department === 'string' ? payload.department : undefined,
      },
    };
  } catch (e) {
    return { ok: false, reason: e && e.code ? e.code : (e && e.message) || 'verify_failed' };
  }
}

/**
 * リクエストを評価し、必要なら 401/403 を返す。
 *
 * @param {object} args
 * @param {string} args.authHeader  Authorization ヘッダ値
 * @param {string} args.method      HTTP メソッド（ログ用）
 * @param {string} args.path        パス（ログ用）
 * @returns {Promise<{ allowed:boolean, status?:number, body?:object, claims?:object }>}
 *   - allowed:true  → 通す（監視モードでは常にこちら。enforce 時も検証成功ならこちら）
 *   - allowed:false → 呼び出し側で status/body を返してブロック（enforce 時のみ発生）
 */
export async function evaluateAuth({ authHeader, cookieHeader, method = '', path = '' } = {}) {
  const enforce = isEnforcing();
  // ヘッダ優先・無ければ SSO ログイン済みブラウザの wh_token cookie（フロント変更不要で認証が通る）。
  const token = extractBearer(authHeader) ?? extractWhTokenCookie(cookieHeader);
  const tag = `[auth-gate]${enforce ? '[ENFORCE]' : '[monitor]'} ${method} ${path}`;

  // トークン無し
  if (!token) {
    console.warn(`${tag} no_bearer_token`);
    if (enforce) {
      return { allowed: false, status: 401, body: { error: '認証が必要です（Bearer トークン未提供）' } };
    }
    return { allowed: true }; // 監視モード: 素通り
  }

  // 検証
  const result = await verifyToken(token);
  if (!result.ok) {
    console.warn(`${tag} verify_failed reason=${result.reason}`);
    if (enforce) {
      return { allowed: false, status: 401, body: { error: 'トークンの検証に失敗しました' } };
    }
    return { allowed: true }; // 監視モード: 素通り
  }

  const { claims } = result;

  // systems[] に自アプリが含まれるか（enforce 時のみ判定）
  const key = systemKey();
  const hasSystem = claims.systems.includes(key);
  if (!hasSystem) {
    console.warn(`${tag} system_not_authorized key=${key} tenant=${claims.tenant_id} systems=${JSON.stringify(claims.systems)}`);
    if (enforce) {
      return { allowed: false, status: 403, body: { error: 'このシステムへのアクセス権がありません' }, claims };
    }
    // 監視モード: 記録だけして素通り
    return { allowed: true, claims };
  }

  console.info(`${tag} ok tenant=${claims.tenant_id} level=${claims.level}`);
  return { allowed: true, claims };
}

/**
 * Vercel / Node の res に対してブロック応答を書く小ヘルパ。
 * （allowed:false のときだけ呼ぶ想定）
 */
export function sendBlock(res, evalResult) {
  res.status(evalResult.status || 401).json(evalResult.body || { error: 'unauthorized' });
}
