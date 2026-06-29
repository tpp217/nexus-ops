// 再ログイン / ログアウト アイコン（画面右上・アイコンのみ）。
//
// todo-report の AuthIcons と同型の要件:
//   - ナビ右側にアイコンのみ（文字ラベルなし）で 2 つ設置。
//     再ログイン＝循環矢印（↻） / ログアウト＝退出矢印（⇥）。
//   - 遷移先をモードで切替（/api/auth/me の standalone フラグを読む）:
//       再ログイン: プラットフォーム版 → /api/auth/login（wh SSO 入口）
//                   単体版         → /login（自前ローカルログイン画面）
//                                     ※ /api/auth/login も単体版では /login へ 302 するため等価だが、
//                                       余計な往復を避けて直接 /login を指す。
//       ログアウト: 両モードとも → /api/auth/logout（cookie 失効。単体版は /login・platform は / へ）
//
// 後方互換:
//   - nexus は静的サイト。マウント先 #authIcons が無ければ何もしない（no-op）。
//   - /api/auth/me は監視モードでも 200/401 を返すだけ＝認証フロー自体は変えない。
//   - identity.js（テナント名/氏名表示）と独立。互いに干渉しない。

(function () {
  // 循環矢印（再ログイン）/ 退出矢印（ログアウト）の SVG（currentColor 追従）。
  var SVG_RELOGIN =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="23 4 23 10 17 10"></polyline>' +
    '<polyline points="1 20 1 14 7 14"></polyline>' +
    '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>' +
    '</svg>';
  var SVG_LOGOUT =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>' +
    '<polyline points="16 17 21 12 16 7"></polyline>' +
    '<line x1="21" y1="12" x2="9" y2="12"></line>' +
    '</svg>';

  function render(host, standalone) {
    // 再ログイン先のみモードで出し分ける（ログアウトは login.js / logout.js 側でモード分岐）。
    //   単体版: /login（自前ログイン画面）／プラットフォーム版: /api/auth/login（wh SSO 入口）。
    var reloginHref = standalone ? '/login' : '/api/auth/login';
    var html =
      '<a class="auth-icon-btn" href="' + reloginHref + '" title="再ログイン" aria-label="再ログイン">' +
        SVG_RELOGIN +
      '</a>' +
      '<a class="auth-icon-btn" href="/api/auth/logout" title="ログアウト" aria-label="ログアウト">' +
        SVG_LOGOUT +
      '</a>';
    host.innerHTML = html;
    host.removeAttribute('hidden');
  }

  function init() {
    var host = document.getElementById('authIcons');
    if (!host) return; // マウント先が無ければ no-op

    // モードフラグの取得は best-effort。失敗してもアイコンは出す（遷移先は共通）。
    fetch('/api/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { render(host, !!(j && j.standalone)); })
      .catch(function () { render(host, false); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
