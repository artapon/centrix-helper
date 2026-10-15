// Basic Data popup: organisation, date, visit, patient and encounter-type ids in the forms people
// paste into MongoDB / Jasper queries. Used by Query Data, and by other pages as the Basic Data widget
// (addon.json "widgets"; served at /widgets/querystudio/basic-data/widget.js):
//
//   <qs-basic-data :open="basicOpen" base="/query-studio/basic-data" :db-name="dbName" @close="basicOpen = false"></qs-basic-data>
//
// `base` is the URL of the basic-data endpoints ({base}, {base}/visit, {base}/hn). The component keeps
// what it loaded between openings; it opens on the Visit tab with the cursor in the Visit ID box.
// Generated from the popup Query Data used to carry inline; the styles are scoped under .qs-bd.
(function () {
  if (!window.Vue || Vue.options.components['qs-basic-data']) return;

  var CSS = ".qs-bd .qd-ic { color: #2563eb; }\n.qs-bd .qd-icon-btn { background: none; border: 0; width: 28px; height: 28px; border-radius: 6px; color: #64748b; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }\n.qs-bd .qd-icon-btn:hover:not(:disabled), .qs-bd .qd-icon-btn:focus-visible { background: #eff6ff; color: #1d4ed8; outline: none; }\n.qs-bd .qd-icon-btn:disabled { opacity: 0.35; cursor: default; }\n.qs-bd .qd-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 4px; padding: 44px 16px; color: #64748b; }\n.qs-bd .qd-empty > i { width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #94a3b8; font-size: 1.05rem; margin-bottom: 6px; }\n.qs-bd .qd-empty-title { font-weight: 600; color: #0f172a; font-size: 0.9rem; }\n.qs-bd .qd-empty-sub { font-size: 0.8rem; max-width: 420px; }\n.qs-bd .qd-empty-sm { padding: 18px 12px; }\n.qs-bd .qd-empty-sm > i { width: 32px; height: 32px; font-size: 0.85rem; }\n.qs-bd .qd-empty.is-error > i { background: #fee2e2; color: #dc2626; }\n.qs-bd .qd-empty.is-error .qd-empty-sub { color: #991b1b; white-space: pre-wrap; }\n.qs-bd { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 1060; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 16px; }\n.qs-bd .qd-modal { background: #fff; border-radius: 12px; box-shadow: 0 20px 50px rgba(15, 23, 42, 0.35); width: 100%; max-width: 960px; max-height: calc(100vh - 32px); display: flex; flex-direction: column; overflow: hidden; }\n.qs-bd .qd-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }\n.qs-bd .qd-modal-title { display: flex; align-items: center; gap: 8px; min-width: 0; word-break: break-all; }\n.qs-bd .qd-modal-close { background: none; border: 0; font-size: 1.1rem; color: #64748b; width: 32px; height: 32px; border-radius: 8px; }\n.qs-bd .qd-modal-close:hover { background: #f1f5f9; color: #0f172a; }\n.qs-bd .qd-basic { max-width: 960px; max-height: min(760px, calc(100vh - 32px)); }\n.qs-bd .qd-basic-head-actions { display: flex; align-items: center; gap: 4px; }\n.qs-bd .qd-basic-tabs { display: flex; gap: 2px; padding: 0 12px; border-bottom: 1px solid #e2e8f0; overflow-x: auto; flex-shrink: 0; }\n.qs-bd .qd-basic-tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 10px 12px; font-size: 0.85rem; font-weight: 600; color: #64748b; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; }\n.qs-bd .qd-basic-tab:hover { color: #0f172a; }\n.qs-bd .qd-basic-tab.is-active { color: #2563eb; border-bottom-color: #2563eb; }\n.qs-bd .qd-basic-count { background: #eef2ff; color: #3730a3; border-radius: 9px; padding: 0 7px; font-size: 0.72rem; }\n.qs-bd .qd-basic-body { flex: 1 1 auto; min-height: 320px; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; background: #f8fafc; }\n.qs-bd .qd-basic-note { font-size: 0.78rem; color: #64748b; display: inline-flex; align-items: center; gap: 6px; }\n.qs-bd .qd-basic-find { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\n.qs-bd .qd-basic-find-input { position: relative; flex: 1 1 280px; max-width: 420px; }\n.qs-bd .qd-basic-find-input i { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 0.8rem; pointer-events: none; }\n.qs-bd .qd-basic-find-input input { height: 34px; padding-left: 32px; background: #fff; }\n.qs-bd .qd-basic-find .btn { height: 34px; display: inline-flex; align-items: center; gap: 6px; }\n.qs-bd .qd-basic-find .qd-basic-note { margin-left: auto; }\n.qs-bd .qd-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }\n.qs-bd .qd-fact { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 9px 8px 9px 14px; min-width: 0; }\n.qs-bd .qd-fact.is-wide { grid-column: 1 / -1; }\n.qs-bd .qd-fact-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }\n.qs-bd .qd-fact-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; }\n.qs-bd .qd-fact-value { font-size: 0.92rem; font-weight: 600; color: #0f172a; overflow-wrap: anywhere; }\n.qs-bd .qd-fact-value.is-empty { color: #cbd5e1; font-weight: 400; }\n.qs-bd .qd-id-groups { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }\n.qs-bd .qd-id-groups.is-pair { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n@media (max-width: 860px) { .qs-bd .qd-id-groups.is-pair { grid-template-columns: minmax(0, 1fr); } }\n.qs-bd .qd-id-group { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; min-width: 0; }\n.qs-bd .qd-id-group header { display: flex; align-items: center; gap: 8px; padding: 9px 14px; font-size: 0.85rem; font-weight: 700; color: #0f172a; border-bottom: 1px solid #eef2f7; }\n.qs-bd .qd-id-group header > i { color: #2563eb; width: 16px; text-align: center; }\n.qs-bd .qd-id-kind { margin-left: auto; font-size: 0.7rem; font-weight: 600; color: #94a3b8; }\n.qs-bd .qd-fmt-row { display: grid; grid-template-columns: 104px minmax(0, 1fr) 28px; align-items: center; gap: 12px; padding: 5px 8px 5px 14px; min-height: 38px; }\n.qs-bd .qd-fmt-row + .qd-fmt-row { border-top: 1px solid #f1f5f9; }\n.qs-bd .qd-fmt-row:hover { background: #f8fafc; }\n.qs-bd .qd-fmt { justify-self: start; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.03em; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: #475569; white-space: nowrap; }\n.qs-bd .qd-fmt.is-mongo { background: #dcfce7; color: #166534; }\n.qs-bd .qd-fmt.is-jasper { background: #ffedd5; color: #9a3412; }\n.qs-bd .qd-fmt.is-param { background: #ede9fe; color: #5b21b6; }\n.qs-bd .qd-fmt.is-local { background: #e0f2fe; color: #075985; }\n.qs-bd .qd-fmt-value { font-family: 'Cascadia Code', Consolas, 'Courier New', monospace; font-size: 0.8rem; color: #0f172a; background: none; padding: 0; white-space: nowrap; overflow-x: auto; scrollbar-width: thin; }\n.qs-bd .qd-fmt-value.is-empty { color: #cbd5e1; }\n.qs-bd .qd-basic-table { border: 1px solid #e2e8f0; border-radius: 10px; overflow: auto; background: #fff; }\n.qs-bd .qd-basic-table th { position: sticky; top: 0; background: #f8fafc; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; border-top: 0; white-space: nowrap; padding: 9px 12px; }\n.qs-bd .qd-basic-table td { font-size: 0.84rem; vertical-align: middle; padding: 7px 12px; }\n.qs-bd .qd-basic-warn { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; font-size: 0.8rem; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 8px 12px; }\n.qs-bd .qd-basic-warn > i { margin-top: 2px; }\n.qs-bd .qd-visits-copy { margin-left: 8px; height: 26px; padding: 0 8px; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 5px; }\n.qs-bd .qd-visits-wrap { max-height: 320px; overflow: auto; }\n.qs-bd .qd-visits th { position: sticky; top: 0; background: #f8fafc; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; border-top: 0; white-space: nowrap; padding: 8px 12px; z-index: 1; }\n.qs-bd .qd-visits td { font-size: 0.83rem; vertical-align: middle; padding: 5px 12px; }\n.qs-bd .qd-visits code { font-size: 0.78rem; color: #334155; }\n.qs-bd .qd-nowrap { white-space: nowrap; }\n.qs-bd .qd-link { background: none; border: 0; padding: 0; color: #2563eb; font-weight: 600; font-family: 'Cascadia Code', Consolas, 'Courier New', monospace; font-size: 0.82rem; }\n.qs-bd .qd-link:hover { text-decoration: underline; }\n.qs-bd .qd-row-copy { width: 24px; height: 24px; vertical-align: middle; }\n.qs-bd .qd-fmt-btn { border: 0; cursor: pointer; vertical-align: middle; }\n.qs-bd .qd-code-pill { display: inline-block; font-weight: 700; font-size: 0.78rem; background: #eef2ff; color: #3730a3; border-radius: 6px; padding: 1px 8px; }\n.qs-bd .qd-basic-uid { white-space: nowrap; }\n.qs-bd .qd-basic-uid code { font-size: 0.78rem; color: #334155; }";
  function injectCss() {
    if (document.getElementById('qs-basic-data-css')) return;
    var st = document.createElement('style');
    st.id = 'qs-basic-data-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (res) {
      return res.json().catch(function () { return { error: 'HTTP ' + res.status }; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  // An ObjectId in the forms pasted into queries: plain, mongo shell, Jasper, Jasper parameter.
  function idFormats(field, id, param) {
    id = id || '';
    return [
      { fmt: 'Value', tone: 'value', value: id },
      { fmt: 'MongoDB', tone: 'mongo', value: id && field + ': ObjectId("' + id + '")' },
      { fmt: 'Jasper', tone: 'jasper', value: id && field + ': {"$oid": "' + id + '"}' },
      { fmt: 'Jasper param', tone: 'param', value: field + ': {"$oid": ${' + param + '}}' }
    ];
  }

  Vue.component('qs-basic-data', {
    props: {
      open: { type: Boolean, default: false },
      base: { type: String, default: '/query-studio/basic-data' },
      dbName: { type: String, default: '' }
    },
    data: function () {
      return {
        basicTab: 'visit', basic: null, basicLoading: false, basicError: '',
        visitCode: '', visitLoading: false, basicVisitSearched: false,
        hnCode: '', hnLoading: false, hnResult: null,
        copiedKey: ''
      };
    },
    computed: {
      basicTabs: function () {
        var b = this.basic, entypes = b && Array.isArray(b.entypes) ? b.entypes.length : null;
        return [
          { key: 'visit', text: 'Visit', icon: 'fas fa-procedures' },
          { key: 'hn', text: 'HN', icon: 'fas fa-user' },
          { key: 'org', text: 'Organisation', icon: 'fas fa-building' },
          { key: 'date', text: 'Date & time', icon: 'fas fa-clock' },
          { key: 'entype', text: 'Encounter types', icon: 'fas fa-table', count: entypes }
        ];
      },
      orgFacts: function () {
        var o = (this.basic && this.basic.org) || {};
        return [
          { label: 'Code', value: o.code }, { label: 'Name', value: o.name },
          { label: 'Company name', value: o.companyname }, { label: 'Tax ID', value: o.gstregno },
          { label: 'Description', value: o.description, wide: true },
          { label: 'Address', value: o.address, wide: true },
          { label: 'Address (English)', value: o.addresseng, wide: true }
        ];
      },
      orgGroups: function () {
        var o = (this.basic && this.basic.org) || {};
        return [{ title: 'Organisation UID', icon: 'fas fa-building', rows: idFormats('orguid', o._id, 'organisationuid') }];
      },
      dateGroups: function () {
        var d = (this.basic && this.basic.dates) || {};
        var rows = function (iso, utc, local) {
          return [
            { fmt: 'ISO', tone: 'value', value: iso },
            { fmt: 'MongoDB', tone: 'mongo', value: utc && 'ISODate("' + utc + '")' },
            { fmt: 'Jasper', tone: 'jasper', value: iso && '{"$date": "' + iso + '"}' },
            { fmt: 'Bangkok', tone: 'local', value: local }
          ];
        };
        return [
          { title: 'Now', sub: 'UTC', icon: 'fas fa-clock', rows: rows(d.iso, d.utc, d.local) },
          { title: 'Midnight today', sub: 'UTC', icon: 'fas fa-moon', rows: rows(d.midnightIso, d.midnightUtc, d.midnightLocal) }
        ];
      },
      hnFacts: function () {
        var h = this.hnResult || {};
        return [
          { label: 'HN', value: h.mrn, copy: true },
          { label: 'Active visits', value: h.total == null ? '' : this.number(h.total) }
        ];
      },
      hnIdRows: function () { return idFormats('patientuid', this.hnResult && this.hnResult._id, 'patientuid'); },
      // Every listed visit as a ready-to-paste filter.
      visitsInText: function () {
        var v = (this.hnResult && this.hnResult.visits) || [];
        return 'patientvisituid: { $in: [' + v.map(function (x) { return 'ObjectId("' + x._id + '")'; }).join(', ') + '] }';
      },
      visitFacts: function () {
        var v = (this.basic && this.basic.visit) || {};
        return [{ label: 'Visit ID', value: v.visitid }, { label: 'HN', value: v.mrn }];
      },
      visitGroups: function () {
        var v = (this.basic && this.basic.visit) || {};
        return [
          { title: 'Patient visit UID', icon: 'fas fa-procedures', rows: idFormats('patientvisituid', v._id, 'patientvisituid') },
          { title: 'Patient UID', icon: 'fas fa-user', rows: idFormats('patientuid', v.patientuid, 'patientuid') }
        ];
      }
    },
    watch: {
      open: { immediate: true, handler: function (v) { if (v) this.onOpen(); } },
      basicTab: function (t) { this.focusTab(t); }
    },
    created: function () {
      var vm = this;
      injectCss();
      // Escape closes the popup (capture phase, so the host page's own Escape handling is skipped).
      vm._onKey = function (e) { if (vm.open && e.key === 'Escape') { e.stopPropagation(); vm.close(); } };
      document.addEventListener('keydown', vm._onKey, true);
    },
    beforeDestroy: function () { document.removeEventListener('keydown', this._onKey, true); },
    methods: {
      close: function () { this.$emit('close'); },
      onOpen: function () {
        var vm = this;
        vm.basicTab = 'visit';
        if (!vm.basic && !vm.basicLoading) vm.loadBasic().then(function () { vm.focusTab('visit'); });
        else vm.focusTab('visit');
      },
      focusTab: function (t) {
        var vm = this;
        vm.$nextTick(function () { var el = vm.$refs[t === 'hn' ? 'hnCode' : 'visitCode'] || vm.$refs.basicClose; if (el) el.focus(); });
      },
      number: function (v) { return Number(v || 0).toLocaleString('en-US'); },
      oidText: function (id) { return 'ObjectId("' + id + '")'; },
      copyText: function (text, key) {
        var vm = this;
        var done = function () { vm.copiedKey = key; setTimeout(function () { if (vm.copiedKey === key) vm.copiedKey = ''; }, 1500); };
        var fallback = function () {
          var ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          try { if (document.execCommand('copy')) done(); } catch (e) { /* left selected for a manual copy */ }
          document.body.removeChild(ta);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
      },
      loadBasic: function () {
        var vm = this;
        vm.basicLoading = true;
        vm.basicError = '';
        return getJson(vm.base)
          .then(function (data) {
            // keep a visit the user looked up; the reload is for fresh dates
            if (vm.basic && vm.basicVisitSearched) data.visit = vm.basic.visit;
            vm.basic = Object.freeze(data);
          })
          .catch(function (err) { vm.basicError = err.message; })
          .then(function () { vm.basicLoading = false; });
      },
      findHn: function () {
        var vm = this, code = vm.hnCode.trim();
        if (!code) return;
        vm.hnLoading = true;
        return getJson(vm.base + '/hn?hn=' + encodeURIComponent(code))
          .catch(function (err) { return { error: err.message }; })
          .then(function (r) { vm.hnResult = Object.freeze(r); vm.hnLoading = false; });
      },
      // A visit picked on the HN tab, shown on the Visit tab.
      openVisit: function (visitid) {
        if (!visitid) return;
        this.visitCode = visitid;
        this.basicTab = 'visit';
        this.findVisit();
      },
      findVisit: function () {
        var vm = this, code = vm.visitCode.trim();
        vm.visitLoading = true;
        return getJson(vm.base + '/visit?visitid=' + encodeURIComponent(code))
          .catch(function (err) { return { error: err.message }; })
          .then(function (visit) {
            vm.basic = Object.freeze(Object.assign({}, vm.basic, { visit: visit }));
            vm.basicVisitSearched = !!code;
            vm.visitLoading = false;
          });
      }
    },
    template: "<div v-if=\"open\" class=\"qd-modal-backdrop qs-bd\" @click.self=\"close\">\n<div class=\"qd-modal qd-basic\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"qdBasicTitle\">\n  <div class=\"qd-modal-head\">\n    <div class=\"qd-modal-title\" id=\"qdBasicTitle\"><i class=\"fas fa-id-card qd-ic\"></i> <b>Basic Data</b> <span v-if=\"dbName\" class=\"text-muted\">· {{ dbName }}</span></div>\n    <div class=\"qd-basic-head-actions\">\n      <button type=\"button\" class=\"qd-icon-btn\" @click=\"loadBasic\" :disabled=\"basicLoading\" title=\"Reload\" aria-label=\"Reload\"><i class=\"fas fa-sync-alt\" :class=\"{ 'fa-spin': basicLoading }\"></i></button>\n      <button type=\"button\" class=\"qd-modal-close\" @click=\"close\" aria-label=\"Close\" ref=\"basicClose\"><i class=\"fas fa-times\"></i></button>\n    </div>\n  </div>\n  <div class=\"qd-basic-tabs\" role=\"tablist\">\n    <button v-for=\"t in basicTabs\" :key=\"t.key\" type=\"button\" role=\"tab\" class=\"qd-basic-tab\" :class=\"{ 'is-active': basicTab === t.key }\"\n      :aria-selected=\"basicTab === t.key ? 'true' : 'false'\" @click=\"basicTab = t.key\">\n      <i :class=\"t.icon\"></i> {{ t.text }} <span v-if=\"t.count != null\" class=\"qd-basic-count\">{{ t.count }}</span>\n    </button>\n  </div>\n  <div class=\"qd-basic-body\">\n    <div v-if=\"basicError\" class=\"qd-empty is-error\"><i class=\"fas fa-exclamation-triangle\"></i><div class=\"qd-empty-title\">Could not load basic data</div><div class=\"qd-empty-sub\">{{ basicError }}</div></div>\n    <div v-else-if=\"!basic\" class=\"qd-empty\"><i class=\"fas fa-spinner fa-spin\"></i><div class=\"qd-empty-sub\">Loading…</div></div>\n    <template v-else>\n      <!-- Visit: search, the visit's facts, then its ids in every query format -->\n      <template v-if=\"basicTab === 'visit'\">\n        <form class=\"qd-basic-find\" @submit.prevent=\"findVisit\">\n          <div class=\"qd-basic-find-input\">\n            <i class=\"fas fa-search\"></i>\n            <input id=\"qdVisitCode\" ref=\"visitCode\" type=\"search\" class=\"form-control form-control-sm\" v-model=\"visitCode\" placeholder=\"Visit ID (empty = latest active visit)\" autocomplete=\"off\" aria-label=\"Visit ID\">\n          </div>\n          <button type=\"submit\" class=\"btn btn-sm btn-primary\" :disabled=\"visitLoading\"><i class=\"fas\" :class=\"visitLoading ? 'fa-spinner fa-spin' : 'fa-arrow-right'\"></i> Get visit data</button>\n          <span class=\"qd-basic-note\" v-if=\"!basicVisitSearched && !basic.visit.error && !basic.visit.notFound\"><i class=\"fas fa-info-circle\"></i> Showing the latest active visit</span>\n        </form>\n        <div v-if=\"basic.visit.error\" class=\"qd-empty is-error qd-empty-sm\"><i class=\"fas fa-exclamation-triangle\"></i><div class=\"qd-empty-sub\">{{ basic.visit.error }}</div></div>\n        <div v-else-if=\"basic.visit.notFound\" class=\"qd-empty qd-empty-sm\"><i class=\"fas fa-search\"></i><div class=\"qd-empty-title\">{{ basic.visit.visitid ? 'No active visit \"' + basic.visit.visitid + '\"' : 'No active visits' }}</div><div class=\"qd-empty-sub\">Check the Visit ID and try again.</div></div>\n        <template v-else>\n          <div class=\"qd-facts\">\n            <div v-for=\"f in visitFacts\" :key=\"f.label\" class=\"qd-fact\">\n              <div class=\"qd-fact-text\"><span class=\"qd-fact-label\">{{ f.label }}</span><span class=\"qd-fact-value\" :class=\"{ 'is-empty': !f.value }\">{{ f.value || '—' }}</span></div>\n              <button type=\"button\" class=\"qd-icon-btn\" v-if=\"f.value\" @click=\"copyText(f.value, 'f:' + f.label)\" :title=\"'Copy ' + f.label\" :aria-label=\"'Copy ' + f.label\"><i :class=\"copiedKey === 'f:' + f.label ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n            </div>\n          </div>\n          <div class=\"qd-id-groups\">\n            <section v-for=\"g in visitGroups\" :key=\"g.title\" class=\"qd-id-group\">\n              <header><i :class=\"g.icon\"></i> {{ g.title }} <span class=\"qd-id-kind\">ObjectId</span></header>\n              <div v-for=\"r in g.rows\" :key=\"r.fmt\" class=\"qd-fmt-row\">\n                <span class=\"qd-fmt\" :class=\"'is-' + r.tone\">{{ r.fmt }}</span>\n                <code class=\"qd-fmt-value\" :class=\"{ 'is-empty': !r.value }\" :title=\"r.value\">{{ r.value || '—' }}</code>\n                <button type=\"button\" class=\"qd-icon-btn\" v-if=\"r.value\" @click=\"copyText(r.value, 'g:' + g.title + r.fmt)\" :title=\"'Copy ' + g.title + ' (' + r.fmt + ')'\" :aria-label=\"'Copy ' + g.title + ' (' + r.fmt + ')'\"><i :class=\"copiedKey === 'g:' + g.title + r.fmt ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n              </div>\n            </section>\n          </div>\n        </template>\n      </template>\n      <!-- HN: the patient and their visits -->\n      <template v-else-if=\"basicTab === 'hn'\">\n        <form class=\"qd-basic-find\" @submit.prevent=\"findHn\">\n          <div class=\"qd-basic-find-input\">\n            <i class=\"fas fa-search\"></i>\n            <input id=\"qdHnCode\" ref=\"hnCode\" type=\"search\" class=\"form-control form-control-sm\" v-model=\"hnCode\" placeholder=\"HN\" autocomplete=\"off\" aria-label=\"HN\">\n          </div>\n          <button type=\"submit\" class=\"btn btn-sm btn-primary\" :disabled=\"hnLoading || !hnCode.trim()\"><i class=\"fas\" :class=\"hnLoading ? 'fa-spinner fa-spin' : 'fa-arrow-right'\"></i> Get patient visits</button>\n        </form>\n        <div v-if=\"!hnResult\" class=\"qd-empty qd-empty-sm\"><i class=\"fas fa-user\"></i><div class=\"qd-empty-title\">Look up a patient by HN</div><div class=\"qd-empty-sub\">Shows the patient's UID and their active visits with each visit's ObjectId.</div></div>\n        <div v-else-if=\"hnResult.error\" class=\"qd-empty is-error qd-empty-sm\"><i class=\"fas fa-exclamation-triangle\"></i><div class=\"qd-empty-sub\">{{ hnResult.error }}</div></div>\n        <div v-else-if=\"hnResult.notFound\" class=\"qd-empty qd-empty-sm\"><i class=\"fas fa-search\"></i><div class=\"qd-empty-title\">No patient with HN \"{{ hnResult.mrn }}\"</div><div class=\"qd-empty-sub\">Check the HN and try again.</div></div>\n        <template v-else>\n          <div class=\"qd-facts\">\n            <div v-for=\"f in hnFacts\" :key=\"f.label\" class=\"qd-fact\">\n              <div class=\"qd-fact-text\"><span class=\"qd-fact-label\">{{ f.label }}</span><span class=\"qd-fact-value\" :class=\"{ 'is-empty': !f.value }\">{{ f.value || '—' }}</span></div>\n              <button type=\"button\" class=\"qd-icon-btn\" v-if=\"f.value && f.copy\" @click=\"copyText(f.value, 'f:' + f.label)\" :title=\"'Copy ' + f.label\" :aria-label=\"'Copy ' + f.label\"><i :class=\"copiedKey === 'f:' + f.label ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n            </div>\n          </div>\n          <div v-if=\"hnResult.inactive || hnResult.duplicates\" class=\"qd-basic-warn\"><i class=\"fas fa-exclamation-triangle\"></i>\n            <span v-if=\"hnResult.inactive\">This patient record is not active (it may have been merged).</span>\n            <span v-if=\"hnResult.duplicates\">{{ hnResult.duplicates }} other patient record{{ hnResult.duplicates > 1 ? 's have' : ' has' }} the same HN.</span>\n          </div>\n          <section class=\"qd-id-group\">\n            <header><i class=\"fas fa-user\"></i> Patient UID <span class=\"qd-id-kind\">ObjectId</span></header>\n            <div v-for=\"r in hnIdRows\" :key=\"r.fmt\" class=\"qd-fmt-row\">\n              <span class=\"qd-fmt\" :class=\"'is-' + r.tone\">{{ r.fmt }}</span>\n              <code class=\"qd-fmt-value\" :class=\"{ 'is-empty': !r.value }\" :title=\"r.value\">{{ r.value || '—' }}</code>\n              <button type=\"button\" class=\"qd-icon-btn\" v-if=\"r.value\" @click=\"copyText(r.value, 'h:' + r.fmt)\" :title=\"'Copy Patient UID (' + r.fmt + ')'\" :aria-label=\"'Copy Patient UID (' + r.fmt + ')'\"><i :class=\"copiedKey === 'h:' + r.fmt ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n            </div>\n          </section>\n          <section class=\"qd-id-group\">\n            <header><i class=\"fas fa-procedures\"></i> Visits\n              <span class=\"qd-id-kind\">{{ hnResult.total > hnResult.visits.length ? 'latest ' + hnResult.visits.length + ' of ' + number(hnResult.total) : number(hnResult.total) + ' active' }}</span>\n              <button type=\"button\" class=\"btn btn-sm btn-outline-secondary qd-visits-copy\" v-if=\"hnResult.visits.length\" @click=\"copyText(visitsInText, 'h:in')\" title=\"Copy every listed visit as patientvisituid: { $in: [...] }\">\n                <i :class=\"copiedKey === 'h:in' ? 'fas fa-check text-success' : 'far fa-copy'\"></i> Copy as $in\n              </button>\n            </header>\n            <div v-if=\"!hnResult.visits.length\" class=\"qd-empty qd-empty-sm\"><i class=\"fas fa-procedures\"></i><div class=\"qd-empty-sub\">No active visits for this patient</div></div>\n            <div v-else class=\"qd-visits-wrap\">\n              <table class=\"table table-sm table-hover mb-0 qd-visits\">\n                <thead><tr><th>Visit ID</th><th>Start</th><th>Encounter</th><th>Status</th><th>Patientvisituid</th></tr></thead>\n                <tbody>\n                  <tr v-for=\"v in hnResult.visits\" :key=\"v._id\">\n                    <td class=\"qd-nowrap\">\n                      <button type=\"button\" class=\"qd-link\" @click=\"openVisit(v.visitid)\" :title=\"'Show ' + v.visitid + ' on the Visit tab'\">{{ v.visitid || '—' }}</button>\n                      <button type=\"button\" class=\"qd-icon-btn qd-row-copy\" v-if=\"v.visitid\" @click=\"copyText(v.visitid, 'v:' + v._id)\" :title=\"'Copy ' + v.visitid\" :aria-label=\"'Copy ' + v.visitid\"><i :class=\"copiedKey === 'v:' + v._id ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n                    </td>\n                    <td class=\"qd-nowrap\">{{ v.start }}</td>\n                    <td>{{ v.entype }}</td>\n                    <td>{{ v.status }}</td>\n                    <td class=\"qd-nowrap\">\n                      <code>{{ v._id }}</code>\n                      <button type=\"button\" class=\"qd-icon-btn qd-row-copy\" @click=\"copyText(v._id, 'i:' + v._id)\" title=\"Copy ObjectId value\" aria-label=\"Copy ObjectId value\"><i :class=\"copiedKey === 'i:' + v._id ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n                      <button type=\"button\" class=\"qd-fmt is-mongo qd-fmt-btn\" @click=\"copyText(oidText(v._id), 'o:' + v._id)\" :title=\"'Copy as ' + oidText(v._id)\">Copy as ObjectId</button>\n                    </td>\n                  </tr>\n                </tbody>\n              </table>\n            </div>\n          </section>\n        </template>\n      </template>\n      <!-- Encounter types -->\n      <template v-else-if=\"basicTab === 'entype'\">\n        <div v-if=\"basic.entypes.error\" class=\"qd-empty is-error qd-empty-sm\"><i class=\"fas fa-exclamation-triangle\"></i><div class=\"qd-empty-sub\">{{ basic.entypes.error }}</div></div>\n        <div v-else-if=\"!basic.entypes.length\" class=\"qd-empty qd-empty-sm\"><i class=\"fas fa-table\"></i><div class=\"qd-empty-sub\">No active ENTYPE reference values</div></div>\n        <div v-else class=\"qd-basic-table\">\n          <table class=\"table table-sm mb-0\">\n            <thead><tr><th>Code</th><th>Description</th><th>Local description</th><th>Related</th><th>UID</th></tr></thead>\n            <tbody>\n              <tr v-for=\"e in basic.entypes\" :key=\"e.uid\">\n                <td><span class=\"qd-code-pill\">{{ e.code }}</span></td><td>{{ e.description }}</td><td>{{ e.local }}</td><td>{{ e.related }}</td>\n                <td class=\"qd-basic-uid\"><code>{{ e.uid }}</code>\n                  <button type=\"button\" class=\"qd-icon-btn\" @click=\"copyText(e.uid, 'e:' + e.uid)\" :title=\"'Copy ' + e.code + ' UID'\" :aria-label=\"'Copy ' + e.code + ' UID'\"><i :class=\"copiedKey === 'e:' + e.uid ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button></td>\n              </tr>\n            </tbody>\n          </table>\n        </div>\n      </template>\n      <!-- Organisation -->\n      <template v-else-if=\"basicTab === 'org'\">\n        <div v-if=\"basic.org.error\" class=\"qd-empty is-error qd-empty-sm\"><i class=\"fas fa-exclamation-triangle\"></i><div class=\"qd-empty-sub\">{{ basic.org.error }}</div></div>\n        <template v-else>\n          <div class=\"qd-facts\">\n            <div v-for=\"f in orgFacts\" :key=\"f.label\" class=\"qd-fact\" :class=\"{ 'is-wide': f.wide }\">\n              <div class=\"qd-fact-text\"><span class=\"qd-fact-label\">{{ f.label }}</span><span class=\"qd-fact-value\" :class=\"{ 'is-empty': !f.value }\">{{ f.value || '—' }}</span></div>\n              <button type=\"button\" class=\"qd-icon-btn\" v-if=\"f.value\" @click=\"copyText(f.value, 'f:' + f.label)\" :title=\"'Copy ' + f.label\" :aria-label=\"'Copy ' + f.label\"><i :class=\"copiedKey === 'f:' + f.label ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n            </div>\n          </div>\n          <div class=\"qd-id-groups\">\n            <section v-for=\"g in orgGroups\" :key=\"g.title\" class=\"qd-id-group\">\n              <header><i :class=\"g.icon\"></i> {{ g.title }} <span class=\"qd-id-kind\">ObjectId</span></header>\n              <div v-for=\"r in g.rows\" :key=\"r.fmt\" class=\"qd-fmt-row\">\n                <span class=\"qd-fmt\" :class=\"'is-' + r.tone\">{{ r.fmt }}</span>\n                <code class=\"qd-fmt-value\" :class=\"{ 'is-empty': !r.value }\" :title=\"r.value\">{{ r.value || '—' }}</code>\n                <button type=\"button\" class=\"qd-icon-btn\" v-if=\"r.value\" @click=\"copyText(r.value, 'g:' + g.title + r.fmt)\" :title=\"'Copy ' + g.title + ' (' + r.fmt + ')'\" :aria-label=\"'Copy ' + g.title + ' (' + r.fmt + ')'\"><i :class=\"copiedKey === 'g:' + g.title + r.fmt ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n              </div>\n            </section>\n          </div>\n        </template>\n      </template>\n      <!-- Date & time: now and midnight side by side -->\n      <template v-else>\n        <div class=\"qd-id-groups is-pair\">\n          <section v-for=\"g in dateGroups\" :key=\"g.title\" class=\"qd-id-group\">\n            <header><i :class=\"g.icon\"></i> {{ g.title }} <span class=\"qd-id-kind\">{{ g.sub }}</span></header>\n            <div v-for=\"r in g.rows\" :key=\"r.fmt\" class=\"qd-fmt-row\">\n              <span class=\"qd-fmt\" :class=\"'is-' + r.tone\">{{ r.fmt }}</span>\n              <code class=\"qd-fmt-value\" :class=\"{ 'is-empty': !r.value }\" :title=\"r.value\">{{ r.value || '—' }}</code>\n              <button type=\"button\" class=\"qd-icon-btn\" v-if=\"r.value\" @click=\"copyText(r.value, 'g:' + g.title + r.fmt)\" :title=\"'Copy ' + g.title + ' (' + r.fmt + ')'\" :aria-label=\"'Copy ' + g.title + ' (' + r.fmt + ')'\"><i :class=\"copiedKey === 'g:' + g.title + r.fmt ? 'fas fa-check text-success' : 'far fa-copy'\"></i></button>\n            </div>\n          </section>\n        </div>\n        <div class=\"qd-basic-note\"><i class=\"fas fa-info-circle\"></i> Loaded {{ basic.dates.local }} Bangkok time. Midnight is the start of today in Bangkok (17:00 UTC the day before). Reload for fresh values.</div>\n      </template>\n    </template>\n  </div>\n</div>\n</div>"
  });
})();
