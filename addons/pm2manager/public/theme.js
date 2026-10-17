// Light / dark for the PM2 Manager pages (PM2 Manager > Settings: light, dark or the device's
// setting), from Page.data.theme, and the Full screen button. The page's root (.pm2m, ref="root") gets
// :class="{ 'is-dark': isDark, 'is-fullscreen': fullscreen }".
// A page that previews another choice (Settings) overrides `themeChoice`.
(function () {
  'use strict';
  Page.setup({
    data: function () {
      var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      return { sysDark: !!(mq && mq.matches), fullscreen: false };
    },
    computed: {
      themeChoice: function () { return this.theme || 'light'; },
      isDark: function () { var t = this.themeChoice; return t === 'dark' || (t === 'system' && this.sysDark); }
    },
    methods: {
      // Full screen: the page's own panel (its dialogs and menus are inside it, so they still show).
      toggleFullscreen: function () {
        var el = this.$refs.root, doc = document;
        if (doc.fullscreenElement || doc.webkitFullscreenElement) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
        else if (el && (el.requestFullscreen || el.webkitRequestFullscreen)) (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      }
    },
    mounted: function () {
      var vm = this, mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      var onFs = function () { vm.fullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement); };
      document.addEventListener('fullscreenchange', onFs);
      document.addEventListener('webkitfullscreenchange', onFs);
      if (!mq) return;
      var on = function (e) { vm.sysDark = e.matches; };
      if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    }
  });
})();
