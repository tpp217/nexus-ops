// 認証付き fetch ラッパ（401 → SSO ログイン / ランチャーへ誘導、403 → エラー表示）。
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
//   - ループ防止: sessionStorage 'wh_sso_attempt'。1回目の 401 は /api/auth/login で
//     無音の SSO 再ログインを試み、それでも 401 が続く（未ログイン / nexus の契約が
//     無い operator 等）2回目は、案内バナーを出してランチャー
//     （https://auth.utinc.dev/launcher）へ誘導する＝無限ループにしない。成功応答で解除。
//   - 403（capabilities 不足・システム未契約等）はリダイレクトせず、サーバーが返す
//     日本語エラーを画面に表示する（権限が無いユーザーの無限往復を防ぐ）。
//   - 戻り値は素の Response（呼び出し側は r.ok / r.json() をそのまま使える）。

(function () {
  // 401/403 時に画面上部へ短い案内バナーを出す（alert より邪魔にならない固定表示）。
  function showAuthNotice(message) {
    try {
      let el = document.getElementById('auth-notice-banner');
      if (!el) {
        el = document.createElement('div');
        el.id = 'auth-notice-banner';
        el.style.cssText =
          'position:fixed;top:0;left:0;right:0;z-index:99999;padding:10px 16px;' +
          'background:#111;color:#fff;font-size:14px;text-align:center;' +
          'border-bottom:1px solid #555;';
        document.body.appendChild(el);
      }
      el.textContent = message;
    } catch (_) { /* 通知が出せなくても本処理は止めない */ }
  }

  window.authFetch = async function (path, opts) {
    const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts || {}));
    if (res.status === 401) {
      let attempted = false;
      try { attempted = !!sessionStorage.getItem('wh_sso_attempt'); } catch {}
      if (!attempted) {
        try { sessionStorage.setItem('wh_sso_attempt', '1'); } catch {}
        window.location.href = '/api/auth/login';
      } else {
        // SSO 再ログインを試みても 401 のまま。行き止まりにせず、案内を出して
        // ランチャーへ誘導する（AUTH_ENFORCE 点灯対応）。
        showAuthNotice('ログインが必要です。ランチャーへ移動します…');
        setTimeout(function () { window.location.href = 'https://auth.utinc.dev/launcher'; }, 1500);
      }
      throw new Error('未認証のためログインへリダイレクトします');
    }
    // 認証済みで応答が得られた → 試行印を解除（次回失効時に再ログインを許可）。
    try { sessionStorage.removeItem('wh_sso_attempt'); } catch {}
    if (res.status === 403) {
      // 権限不足。リダイレクトはしない（無限往復防止）。本体を消費しないよう clone から
      // 日本語エラーを読み、画面に表示したうえで Response はそのまま呼び出し側へ返す。
      let msg = 'この操作を行う権限がありません。';
      try {
        const data = await res.clone().json();
        if (data && data.error) msg = data.error;
      } catch (_) {}
      showAuthNotice(msg);
    }
    return res;
  };
})();
