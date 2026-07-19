// テーマ切替（ライト/ダーク・カラースキーム）
// 初期値は各 HTML 先頭の同期スクリプトで data-theme / data-color-scheme に設定済み。
// ここでは切替UIの操作とlocalStorageへの保存のみを担当する。
(function () {
  var root = document.documentElement;

  function applyActiveSchemeBtn() {
    var current = root.getAttribute('data-color-scheme') || 'default';
    document.querySelectorAll('.scheme-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-scheme') === current);
    });
  }

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('wl_theme_mode', theme); } catch (e) { /* noop */ }
  }

  function setColorScheme(scheme) {
    root.setAttribute('data-color-scheme', scheme);
    try { localStorage.setItem('wl_color_scheme', scheme); } catch (e) { /* noop */ }
    applyActiveSchemeBtn();
  }

  function init() {
    applyActiveSchemeBtn();

    var toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        setTheme(next);
      });
    }

    document.querySelectorAll('.scheme-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setColorScheme(btn.getAttribute('data-scheme'));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
