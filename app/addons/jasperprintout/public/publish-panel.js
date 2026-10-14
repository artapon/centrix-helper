// "Publish to" panel shared by the Print-Out Builder, Jasper Designer and Publish Report (Vue 2,
// no build step). It edits one publish form and shows what Reports > Settings provides:
//
//   <jr-publish-to :form="form" :ctx="ctx" :report-name="name" check-url="/reports/…/check-code" uid="x">
//
//   form  JRPublish.form(values, ctx): { servers: [ids], target: 'jasper' | 'both', folder, dataSource,
//         hisCode, hisName, locale, dup: { exists, name, asked } }. The panel changes it in place.
//   ctx   the page context from the server: { defaults: { folder, dataSource },
//         jasper: { configured, servers: [{ id, name, url, configured, publishByDefault }] }, his, isAdmin }
//   own-code      an HIS code this report was saved with before (re-using it asks nothing)
//   show-target / show-status   hide the Jasper | Jasper + Centrix switch or the status line
//   show-servers  hide the JasperServers to tick (the deploy workflow picks them by zone)
//
// window.JRPublish has the matching helpers: form(values, ctx), hisBlocked(ctx), issue(form, ctx),
// serverNames(form, ctx) and fields(form) (what to send to the server).
// With several JasperServers in Reports > Settings the panel lists them to tick; a report is
// published to each ticked one. Those set to "publish by default" start ticked.
(function () {
  'use strict';

  var FOLDER_RE = /^[A-Za-z0-9_\-/ ]+$/;
  var cleanFolder = function (f) { return String(f || '').trim().replace(/^\/+|\/+$/g, ''); };

  var JRPublish = window.JRPublish = {
    defaultServers: function (ctx) {
      var list = (ctx && ctx.jasper && ctx.jasper.servers) || [];
      var ids = list.filter(function (s) { return s.publishByDefault && s.configured; }).map(function (s) { return s.id; });
      if (!ids.length) ids = list.filter(function (s) { return s.configured; }).slice(0, 1).map(function (s) { return s.id; });
      return ids;
    },
    form: function (values, ctx) {
      return Object.assign({
        servers: JRPublish.defaultServers(ctx), target: 'jasper', folder: '', dataSource: '',
        hisCode: '', hisName: '', locale: 'th', dup: { exists: false, name: '', asked: false }
      }, values || {});
    },
    serverNames: function (form, ctx) {
      return ((ctx.jasper && ctx.jasper.servers) || []).filter(function (s) { return form.servers.indexOf(s.id) >= 0; })
        .map(function (s) { return s.name; });
    },
    hisBlocked: function (ctx) {
      var his = ctx.his || {};
      if (!his.connected) return 'Connect to a Centrix site to save reports to HIS.';
      if (!his.ready) return ctx.isAdmin ? 'Set the interface user UID in Reports > Settings to save reports to HIS.' : 'An administrator needs to set the interface user in Reports > Settings before reports can be saved to HIS.';
      return '';
    },
    route: function (form, ctx, name) {
      return '/' + cleanFolder(form.folder || ctx.defaults.folder) + '/' + (name || '');
    },
    // Why the form cannot be published yet ('' = it can).
    issue: function (form, ctx) {
      var folder = cleanFolder(form.folder || ctx.defaults.folder);
      if (!ctx.jasper.configured) return 'JasperServer is not set up yet (Reports > Settings).';
      var chosen = (ctx.jasper.servers || []).filter(function (s) { return form.servers.indexOf(s.id) >= 0; });
      if (!chosen.length) return 'Choose at least one JasperServer.';
      var notReady = chosen.filter(function (s) { return !s.configured; });
      if (notReady.length) return notReady.map(function (s) { return s.name; }).join(', ') + ' is not fully set up in Reports > Settings.';
      if (!folder || !FOLDER_RE.test(folder) || folder.indexOf('..') >= 0) return 'Folder may contain English letters, numbers, spaces, _ - and /.';
      if (form.target !== 'both') return '';
      var blocked = JRPublish.hisBlocked(ctx);
      if (blocked) return blocked;
      if (!form.hisCode.trim() || !form.hisName.trim()) return 'Enter the report code and name for HIS.';
      if (form.dup.exists && form.dup.asked) return 'Choose “Replace it” or another report code.';
      return '';
    },
    fields: function (form) {
      var out = { servers: form.servers.slice(), folder: form.folder, dataSource: form.dataSource };
      if (form.target === 'both') Object.assign(out, { toHis: true, hisCode: form.hisCode.trim(), hisName: form.hisName.trim(), locale: form.locale });
      return out;
    }
  };

  var css = [
    '.jrpt { font-size: .8rem; }',
    '.jrpt label { font-size: .72rem; font-weight: 600; color: var(--text-2); margin-bottom: 3px; }',
    '.jrpt .form-group { margin-bottom: 8px; }',
    '.jrpt .form-control-sm, .jrpt .custom-select-sm { height: 32px; font-size: .8rem; border-radius: 6px; }',
    '.jrpt .custom-select-sm { padding: 4px 28px 4px 10px; background-position: right 10px center; line-height: 1.5; }',
    '.jrpt-status { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; font-size: .74rem; color: var(--text-2); margin-bottom: 10px; }',
    '.jrpt-status span { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }',
    '.jrpt-status i.fa-circle { font-size: .45rem; }',
    '.jrpt-status .is-ok i.fa-circle { color: var(--success); }',
    '.jrpt-status .is-bad i.fa-circle { color: var(--danger); }',
    '.jrpt-status .is-warn i.fa-circle { color: var(--warning); }',
    '.jrpt-status a { margin-left: auto; font-weight: 600; white-space: nowrap; }',
    '.jrpt-seg { display: flex; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; margin-bottom: 10px; }',
    '.jrpt-seg button { flex: 1; border: 0; background: var(--surface); color: var(--text-2); font-size: .76rem; font-weight: 600; padding: 6px 8px; cursor: pointer; white-space: nowrap; }',
    '.jrpt-seg button + button { border-left: 1px solid var(--border-strong); }',
    '.jrpt-seg button.is-on { background: var(--primary); color: #fff; }',
    '.jrpt-seg button:disabled { cursor: default; opacity: .55; }',
    '.jrpt-seg button.is-on:disabled { opacity: .8; }',
    '.jrpt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0 10px; }',
    '.jrpt-route { font-size: .72rem; color: var(--muted); margin: -2px 0 8px; overflow-wrap: anywhere; }',
    '.jrpt-his { border: 1px solid var(--primary-ring); background: var(--primary-soft); border-radius: var(--radius-sm); padding: 8px 10px 2px; margin-bottom: 6px; }',
    '.jrpt-his-note { font-size: .74rem; color: var(--text-2); margin-bottom: 6px; }',
    '.jrpt-his-note i { color: var(--primary); margin-right: 4px; }',
    '.jrpt .is-warning { border-color: var(--warning); }',
    '.jrpt-dup { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: flex-start; font-size: .74rem; color: var(--warning); background: var(--warning-soft); border-radius: 6px; padding: 7px 9px; margin-bottom: 8px; }',
    '.jrpt-dup > span:first-of-type { flex: 1; min-width: 0; }',
    '.jrpt-dup-actions { display: flex; gap: 6px; width: 100%; }',
    '.jrpt-blocked { font-size: .72rem; color: var(--muted); margin: -4px 0 8px; }',
    '.jrpt-servers { margin-bottom: 10px; }',
    '.jrpt-servers-list { display: flex; flex-wrap: wrap; gap: 6px; }',
    '.jrpt-server { display: inline-flex; align-items: center; gap: 6px; margin: 0; padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: 999px; font-size: .76rem !important; font-weight: 600; color: var(--text-2) !important; text-transform: none !important; letter-spacing: 0 !important; cursor: pointer; background: var(--surface); }',
    '.jrpt-server.is-on { border-color: var(--primary); background: var(--primary-soft); color: var(--primary) !important; }',
    '.jrpt-server.is-off { opacity: .55; cursor: default; }',
    '.jrpt-server input { accent-color: var(--primary); margin: 0; }'
  ].join('\n');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  Vue.component('jr-publish-to', {
    props: {
      form: { type: Object, required: true },
      ctx: { type: Object, required: true },
      reportName: { type: String, default: '' },
      checkUrl: { type: String, default: '' },
      ownCode: { type: String, default: '' },
      uid: { type: String, default: 'jrpt' },
      disabled: { type: Boolean, default: false },
      showTarget: { type: Boolean, default: true },
      showStatus: { type: Boolean, default: true },
      showServers: { type: Boolean, default: true }
    },
    computed: {
      hisBlocked: function () { return JRPublish.hisBlocked(this.ctx); },
      route: function () { return JRPublish.route(this.form, this.ctx, this.reportName); },
      siteName: function () { var h = this.ctx.his || {}; return h.site || (h.org && h.org.name) || ''; },
      servers: function () { return (this.ctx.jasper && this.ctx.jasper.servers) || []; },
      readyServers: function () { return this.servers.filter(function (s) { return s.configured; }); },
      jasperTitle: function () { return this.readyServers.map(function (s) { return s.name + ': ' + s.url; }).join('\n'); },
      jasperText: function () {
        var n = this.readyServers.length;
        if (!n) return 'JasperServer not set up';
        return n === 1 ? 'JasperServer ' + this.readyServers[0].name : n + ' JasperServers';
      }
    },
    watch: {
      'form.hisCode': function () { this.checkCode(); },
      'form.target': function (t) {
        if (t === 'both' && !this.form.hisName.trim()) this.form.hisName = this.reportName;
        this.checkCode();
      }
    },
    mounted: function () { this.checkCode(); },
    beforeDestroy: function () { clearTimeout(this._timer); },
    methods: {
      setTarget: function (t) {
        if (this.disabled || (t === 'both' && this.hisBlocked)) return;
        this.form.target = t;
      },
      // Warns when the HIS code is already used by a report template (debounced).
      checkCode: function () {
        var vm = this, form = vm.form, code = form.hisCode.trim();
        clearTimeout(vm._timer);
        form.dup = { exists: false, name: '', asked: false };
        if (form.target !== 'both' || !code || !vm.checkUrl || !(vm.ctx.his && vm.ctx.his.connected)) return;
        var own = !!vm.ownCode && vm.ownCode === code;
        vm._timer = setTimeout(function () {
          fetch(vm.checkUrl + '?code=' + encodeURIComponent(code), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
              if (!d || code !== form.hisCode.trim() || form.target !== 'both') return;
              form.dup = { exists: !!d.exists, name: d.name || '', asked: !!d.exists && !own };
            })
            .catch(function () { /* the server checks again on publish */ });
        }, 500);
      },
      useOtherCode: function () { this.form.hisCode = ''; },
      toggleServer: function (s) {
        if (this.disabled || !s.configured) return;
        var i = this.form.servers.indexOf(s.id);
        if (i >= 0) this.form.servers.splice(i, 1);
        else this.form.servers.push(s.id);
      }
    },
    template: '\
<div class="jrpt">\
  <div v-if="showStatus" class="jrpt-status">\
    <span :class="ctx.jasper.configured ? \'is-ok\' : \'is-bad\'" :title="jasperTitle"><i class="fas fa-circle"></i> {{ jasperText }}</span>\
    <span :class="hisBlocked ? \'is-warn\' : \'is-ok\'" :title="hisBlocked"><i class="fas fa-circle"></i> Centrix HIS {{ hisBlocked ? \'not available\' : \'ready · \' + siteName }}</span>\
    <a v-if="ctx.isAdmin" href="/reports/settings" title="Reports > Settings"><i class="fas fa-sliders-h"></i> Settings</a>\
  </div>\
  <div v-if="showServers && servers.length > 1" class="jrpt-servers">\
    <label class="d-block">JasperServers</label>\
    <div class="jrpt-servers-list" role="group" aria-label="JasperServers to publish to">\
      <label v-for="s in servers" :key="s.id" class="jrpt-server" :class="{ \'is-on\': form.servers.indexOf(s.id) >= 0, \'is-off\': !s.configured }" :title="s.configured ? s.url : s.name + \' is not fully set up in Reports > Settings\'">\
        <input type="checkbox" :checked="form.servers.indexOf(s.id) >= 0" @change="toggleServer(s)" :disabled="disabled || !s.configured"> {{ s.name }}\
      </label>\
    </div>\
  </div>\
  <div v-if="showTarget" class="jrpt-seg" role="group" aria-label="Publish to">\
    <button type="button" :class="{ \'is-on\': form.target === \'jasper\' }" @click="setTarget(\'jasper\')" :disabled="disabled"><i class="fas fa-server"></i> JasperServer</button>\
    <button type="button" :class="{ \'is-on\': form.target === \'both\' }" @click="setTarget(\'both\')" :disabled="disabled || !!hisBlocked" :title="hisBlocked || \'Publish to JasperServer and save to Centrix HIS\'"><i class="fas fa-hospital"></i> JasperServer + Centrix</button>\
  </div>\
  <p v-if="showTarget && hisBlocked" class="jrpt-blocked">{{ hisBlocked }}</p>\
  <div class="jrpt-grid">\
    <div class="form-group">\
      <label :for="uid + \'-folder\'">JasperServer folder</label>\
      <input :id="uid + \'-folder\'" class="form-control form-control-sm" v-model.trim="form.folder" :placeholder="ctx.defaults.folder + \' (Settings)\'" :disabled="disabled">\
    </div>\
    <div class="form-group">\
      <label :for="uid + \'-ds\'">Data source</label>\
      <input :id="uid + \'-ds\'" class="form-control form-control-sm" v-model.trim="form.dataSource" :placeholder="ctx.defaults.dataSource + \' (Settings)\'" :disabled="disabled">\
    </div>\
  </div>\
  <p class="jrpt-route">Published as <code>{{ route }}</code>. A report already there is replaced.<template v-if="!form.folder || !form.dataSource"> Empty boxes use Reports &gt; Settings.</template></p>\
  <div v-if="form.target === \'both\'" class="jrpt-his">\
    <div class="jrpt-his-note"><i class="fas fa-hospital"></i> Saved as a Visit Slip in <b>{{ siteName }}</b>{{ ctx.his.org && ctx.his.org.code ? \' (\' + ctx.his.org.code + \')\' : \'\' }} with route <code>{{ route }}</code></div>\
    <div class="jrpt-grid">\
      <div class="form-group">\
        <label :for="uid + \'-code\'">Report code</label>\
        <input :id="uid + \'-code\'" class="form-control form-control-sm" v-model.trim="form.hisCode" :class="{ \'is-warning\': form.dup.exists }" maxlength="60" :disabled="disabled">\
      </div>\
      <div class="form-group">\
        <label :for="uid + \'-name\'">Name in HIS</label>\
        <input :id="uid + \'-name\'" class="form-control form-control-sm" v-model="form.hisName" maxlength="200" :disabled="disabled">\
      </div>\
      <div class="form-group">\
        <label :for="uid + \'-lang\'">Language</label>\
        <select :id="uid + \'-lang\'" class="custom-select custom-select-sm" v-model="form.locale" :disabled="disabled">\
          <option value="th">Thai (th)</option><option value="en">English (en)</option>\
        </select>\
      </div>\
    </div>\
    <div v-if="form.dup.exists" class="jrpt-dup" role="alert">\
      <i class="fas fa-exclamation-triangle"></i>\
      <span>Code <b>{{ form.hisCode }}</b> is already used{{ form.dup.name ? \' by “\' + form.dup.name + \'”\' : \'\' }}. Saving replaces that report template.</span>\
      <span v-if="form.dup.asked" class="jrpt-dup-actions">\
        <button type="button" class="btn btn-sm btn-warning" @click="form.dup.asked = false">Replace it</button>\
        <button type="button" class="btn btn-sm btn-light" @click="useOtherCode">Use another code</button>\
      </span>\
    </div>\
  </div>\
</div>'
  });
})();
