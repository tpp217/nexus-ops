// 認証付き fetch ラッパ（401 → SSO ログインへ誘導）。
//
// 背景:
//   AUTH_ENFORCE=on のとき、auth-gate が未認証/失効/対象外で 401 を返す。
//   従来は各 fetch が catch で握り潰しており、enforce 時にデータが空になるだけで
//   ユーザーが再ログインできなかった。closing-automation の apiFetch と同じ方式で、
//   401 を検知したらブラウザを /api/auth/login（SSO 入口）へ飛ばす。
//
// 重要:
//   - 監視モード（AUTH_ENFORCE 未設定）では auth-gate が 401 を返さないため、
//     このラッパは素の fetch と同一挙動＝完全な no-op。enforce 前に安全に入れられる。
//   - リダイレクトはこの関数内で実行する。呼び出し側が catch で握り潰しても、
//     window.location 代入は既に発生しているので遷移は起きる。
//   - ループ防止: sessionStorage 'wh_sso_attempt'。401→login→callback→401 の
//     無限ループ（nexus 権限が無い operator 等）を 2 回目で止める。成功応答で解除。
//   - 戻り値は素の Response（呼び出し側は r.ok / r.json() をそのまま使える）。

(function () {
  window.authFetch = async function (path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}));
    if (res.status === 401) {
      let attempted = false;
      try { attempted = !!sessionStorage.getItem('wh_sso_attempt'); } catch {}
      if (!attempted) {
        try { sessionStorage.setItem('wh_sso_attempt', '1'); } catch {}
        window.location.href = '/api/auth/login';
      }
      throw new Error('未認証のためログインへリダイレクトします');
    }
    // 認証済みで応答が得られた → 試行印を解除（次回失効時に再ログインを許可）。
    try { sessionStorage.removeItem('wh_sso_attempt'); } catch {}
    return res;
  };
})();
