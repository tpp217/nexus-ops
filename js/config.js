/**
 * NEXUS OPS - 環境設定
 *
 * フロントエンドが参照するAPI URLを一元管理する。
 *
 * ■ VM開発時 (http://localhost:3100 経由)
 *   AI_API_BASE  → 相対パス (/api) で動作
 *   TABLE_BASE   → 相対パス (/tables) で動作
 *
 * ■ Vercel本番
 *   AI_API_BASE  → VM公開URL (https://zvtfabus.gensparkclaw.com/nexus/api)
 *   TABLE_BASE   → 相対パス (/tables) → Vercel API Routes が処理
 *
 * 環境の判定:
 *   - window.NEXUS_AI_API_URL が設定されていれば最優先
 *   - localhost / 127.0.0.1 → VM直結モード
 *   - それ以外 → Vercel本番モード
 */

const _VM_AI_URL  = 'https://zvtfabus.gensparkclaw.com/nexus/api';
const _LOCAL_MODE = (
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1'
);

/** AI分析API (gsk依存 → VMサーバーへ) */
export const AI_API_BASE = (
  window.NEXUS_AI_API_URL ||         // 外部から上書き可能
  (_LOCAL_MODE ? '/api' : _VM_AI_URL)
);

/** テーブルAPI (Supabase CRUD → Vercel API Routes or VMフォールバック) */
export const TABLE_BASE = '/tables';

/** デバッグ用 */
if (_LOCAL_MODE) {
  console.info('[NEXUS] ローカルモード: AI_API_BASE =', AI_API_BASE);
} else {
  console.info('[NEXUS] 本番モード: AI_API_BASE =', AI_API_BASE);
}
