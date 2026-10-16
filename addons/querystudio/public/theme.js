// Query Studio light / dark mode. Loaded first by each Query Studio page (Query Data, Query Template,
// Query Data Audit): it sets html.qs-dark (public/dark.css) before the page draws, and adds a switch
// to the top bar: Light, Dark, or System (follows the computer's setting). The choice is kept in this
// browser and applies to every Query Studio page and open tab.
(function () {
  var KEY = 'querystudio.theme';
  var CHOICES = [
    { v: 'light', text: 'Light', icon: 'fas fa-sun' },
    { v: 'dark', text: 'Dark', icon: 'fas fa-moon' },
    { v: 'system', text: 'System', icon: 'fas fa-desktop' }
  ];
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function choice() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'system' ? v : 'light';
    } catch (e) { return 'light'; }
  }
  var isDark = function () { var c = choice(); return c === 'dark' || (c === 'system' && !!mq && mq.matches); };

  function apply() {
    var dark = isDark();
    root.classList.toggle('qs-dark', dark);
    root.style.colorScheme = dark ? 'dark' : '';
    render();
  }

  function set(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked: this page only */ }
    apply();
  }

  // ---- the top-bar switch ----
  var box = null;
  function render() {
    if (!box) return;
    var c = choice(), dark = isDark();
    var btn = box.querySelector('.qs-theme-btn');
    btn.innerHTML = '<i class="fas ' + (dark ? 'fa-moon' : 'fa-sun') + '"></i>';
    var label = 'Theme: ' + CHOICES.filter(function (x) { return x.v === c; })[0].text + (c === 'system' ? ' (' + (dark ? 'dark' : 'light') + ')' : '');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    box.querySelectorAll('[data-qs-theme]').forEach(function (a) {
      var on = a.getAttribute('data-qs-theme') === c;
      a.classList.toggle('is-on', on);
      a.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }
  function mount() {
    if (box || document.getElementById('qsTheme')) return;
    var bar = document.querySelector('.topbar-actions');
    if (!bar) return;
    box = document.createElement('div');
    box.id = 'qsTheme';
    box.className = 'dropdown qs-theme';
    box.innerHTML =
      '<button type="button" class="topbar-icon-btn qs-theme-btn" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"></button>' +
      '<div class="dropdown-menu dropdown-menu-right" role="menu">' +
        '<div class="qs-theme-head">Query Studio theme</div>' +
        CHOICES.map(function (x) {
          return '<button type="button" class="dropdown-item" role="menuitemradio" data-qs-theme="' + x.v + '">' +
            '<i class="' + x.icon + ' fa-fw"></i><span>' + x.text + '</span><i class="fas fa-check"></i></button>';
        }).join('') +
      '</div>';
    box.addEventListener('click', function (e) {
      var item = e.target.closest('[data-qs-theme]');
      if (item) set(item.getAttribute('data-qs-theme'));
    });
    bar.insertBefore(box, bar.firstChild);
    render();
  }

  apply();
  if (mq) {
    var onSystem = function () { if (choice() === 'system') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onSystem); else if (mq.addListener) mq.addListener(onSystem);
  }
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });   // another tab changed it
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  mount();

  window.QsTheme = { get: choice, set: set, isDark: isDark };
})();
