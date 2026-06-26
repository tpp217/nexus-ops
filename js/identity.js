// テナント対応 identity 表示。
//
// マウント時に /api/auth/me を1回だけ叩き、ナビの #ssoIdentity に
// 「テナント名・本人氏名・所属部署」を描画する。
//
// 設計方針:
//   - SSO 未ログイン（401）・ネットワーク失敗のときは何も描画しない（現挙動を壊さない）。
//     監視モードでは API が 401 を返さない＝ログインしていなければ /api/auth/me も 401 で no-op。
//   - is_demo は表示分岐に使わない（このアプリに直書きモックが無いため）。
//     実テナント・テスト用テナントを問わず「実際の identity」をそのまま出す。
//   - 値が未配布（再ログイン前など）なら、出せる項目だけ出す（氏名/部署は省略可）。
//   - 認証導線（auth-fetch.js の 401→login）には一切干渉しない。me は素の fetch で叩く。

(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[ch]);
  }

  function render(me) {
    const host = document.getElementById('ssoIdentity');
    if (!host) return;

    const parts = [];
    if (me.tenant_name) {
      parts.push(`<span class="sso-id-tenant">${esc(me.tenant_name)}</span>`);
    }
    // 氏名・部署はサブ情報としてまとめる（どちらか欠けても可）。
    const sub = [];
    if (me.name) sub.push(esc(me.name));
    if (me.department) sub.push(esc(me.department));
    if (sub.length) {
      parts.push(`<span class="sso-id-sub">${sub.join(' / ')}</span>`);
    }

    if (!parts.length) return; // 出せる情報が無ければ何も出さない
    host.innerHTML = parts.join('');
    host.removeAttribute('hidden');
  }

  function init() {
    // 素の fetch（authFetch は使わない＝401 で login へ飛ばさない）。
    fetch('/api/auth/me', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.ok) render(j); })
      .catch(() => { /* 未ログイン / 失敗時は no-op */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
