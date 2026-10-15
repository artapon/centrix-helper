// Saved Jasper queries widget: a button with a searchable list of the Jasper queries the signed-in
// user saved in Query Data (More → To Jasper → Save). Picking one emits it; deleting asks first.
//
//   <qs-jasper-queries base="/widgets/querystudio/jasper-queries" @pick="loadSavedQuery"></qs-jasper-queries>
//
// `base` is the widget's link (list: GET {base}, delete: POST {base}/<id>/delete). The picked query is
// { id, name, collection, query, meta: { method, params: [{ name, cls, def }] }, updated_at }.
(function () {
  if (!window.Vue || Vue.options.components['qs-jasper-queries']) return;

  var CSS = [
    '.qs-jq { position: relative; display: inline-block; }',
    '.qs-jq-backdrop { position: fixed; inset: 0; z-index: 5; }',
    '.qs-jq-pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 6; width: min(560px, 80vw); background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 10px; box-shadow: var(--shadow-lg, 0 12px 32px rgba(15,23,42,.18)); overflow: hidden; text-align: left; }',
    '.qs-jq-search { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border, #e2e8f0); }',
    '.qs-jq-search i { color: var(--muted, #64748b); font-size: .8rem; }',
    '.qs-jq-search input { flex: 1; border: 0; outline: none; font-size: .86rem; background: transparent; color: var(--text, #0f172a); }',
    '.qs-jq-empty { padding: 14px 12px; font-size: .82rem; color: var(--muted, #64748b); }',
    '.qs-jq-list { list-style: none; margin: 0; padding: 4px; max-height: 360px; overflow-y: auto; }',
    '.qs-jq-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }',
    '.qs-jq-item:hover, .qs-jq-item:focus-visible { background: var(--primary-soft, #eff6ff); outline: none; }',
    '.qs-jq-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }',
    '.qs-jq-main b { font-size: .86rem; color: var(--text, #0f172a); }',
    '.qs-jq-main small { font-size: .72rem; color: var(--muted, #64748b); }',
    '.qs-jq-main code { font-size: .7rem; color: var(--text-2, #334155); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: none; padding: 0; }',
    '.qs-jq-x { border: 0; background: none; color: var(--muted, #64748b); font-size: 1.1rem; line-height: 1; width: 24px; height: 24px; border-radius: 6px; }',
    '.qs-jq-x:hover { background: var(--danger-soft, #fdecec); color: var(--danger, #dc2626); }'
  ].join('\n');
  function injectCss() {
    if (document.getElementById('qs-jasper-queries-css')) return;
    var st = document.createElement('style');
    st.id = 'qs-jasper-queries-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function request(url, body) {
    var opts = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(url, opts).then(function (res) {
      return res.json().catch(function () { return { error: 'HTTP ' + res.status }; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  // "14/10/2026 13:45" in Bangkok time
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
  }

  Vue.component('qs-jasper-queries', {
    props: {
      base: { type: String, required: true },
      label: { type: String, default: 'Saved Jasper queries' }
    },
    data: function () {
      return { open: false, list: null, q: '', loading: false, error: '', confirmDel: null };
    },
    computed: {
      shown: function () {
        if (!this.list) return [];
        var t = this.q.trim().toLowerCase();
        return !t ? this.list : this.list.filter(function (x) { return (x.name + ' ' + x.collection + ' ' + x.query).toLowerCase().indexOf(t) >= 0; });
      }
    },
    created: injectCss,
    methods: {
      when: when,
      toggle: function () {
        var vm = this;
        vm.open = !vm.open;
        vm.confirmDel = null;
        if (!vm.open) return;
        vm.$nextTick(function () { if (vm.$refs.search) vm.$refs.search.focus(); });
        vm.loading = true; vm.error = '';
        request(vm.base)
          .then(function (d) { vm.list = d.queries || []; })
          .catch(function (err) { vm.error = err.message; })
          .then(function () { vm.loading = false; });
      },
      close: function () { this.open = false; this.confirmDel = null; },
      pick: function (sq) {
        this.close();
        this.$emit('pick', sq);
      },
      remove: function (sq) {
        var vm = this;
        request(vm.base + '/' + sq.id + '/delete', {})
          .then(function () { vm.list = vm.list.filter(function (x) { return x.id !== sq.id; }); vm.confirmDel = null; })
          .catch(function (err) { vm.error = err.message; });
      },
      snippet: function (text) { return String(text || '').replace(/\s+/g, ' ').slice(0, 110); }
    },
    template:
      '<div class="qs-jq">' +
        '<button type="button" class="btn btn-sm btn-light" @click="toggle" :aria-expanded="open ? \'true\' : \'false\'" aria-haspopup="listbox"' +
        ' title="Load a Jasper query you saved in Query Data (To Jasper → Save)">' +
          '<i class="fas fa-bookmark"></i> {{ label }} <i class="fas fa-chevron-down" style="font-size: .6rem"></i>' +
        '</button>' +
        '<div v-if="open" class="qs-jq-backdrop" @click="close"></div>' +
        '<div v-if="open" class="qs-jq-pop" role="dialog" :aria-label="label">' +
          '<div class="qs-jq-search">' +
            '<i class="fas fa-search"></i>' +
            '<input ref="search" v-model="q" placeholder="Search name, collection or query…" aria-label="Search saved Jasper queries"' +
            ' @keydown.esc.stop="close" @keydown.enter.prevent="shown.length && pick(shown[0])">' +
          '</div>' +
          '<div v-if="loading" class="qs-jq-empty"><i class="fas fa-spinner fa-spin"></i> Loading…</div>' +
          '<div v-else-if="error" class="qs-jq-empty text-danger">{{ error }}</div>' +
          '<div v-else-if="!shown.length" class="qs-jq-empty">{{ list && list.length ? \'No saved Jasper query matches.\' : \'No saved Jasper queries yet. In Query Data, use More → To Jasper, then Save.\' }}</div>' +
          '<ul v-else class="qs-jq-list" role="listbox">' +
            '<li v-for="sq in shown" :key="sq.id" class="qs-jq-item" role="option" tabindex="0" @click="pick(sq)" @keydown.enter="pick(sq)">' +
              '<span class="qs-jq-main">' +
                '<b>{{ sq.name }}</b>' +
                '<small>{{ sq.collection }}<template v-if="sq.meta && sq.meta.method"> · {{ sq.meta.method }}</template>' +
                '<template v-if="sq.meta && sq.meta.params && sq.meta.params.length"> · {{ sq.meta.params.length }} parameter{{ sq.meta.params.length > 1 ? \'s\' : \'\' }}</template> · {{ when(sq.updated_at) }}</small>' +
                '<code>{{ snippet(sq.query) }}</code>' +
              '</span>' +
              '<template v-if="confirmDel === sq.id">' +
                '<button type="button" class="btn btn-sm btn-danger" @click.stop="remove(sq)">Delete</button>' +
                '<button type="button" class="btn btn-sm btn-light" @click.stop="confirmDel = null">Keep</button>' +
              '</template>' +
              '<button v-else type="button" class="qs-jq-x" @click.stop="confirmDel = sq.id" :aria-label="\'Delete \' + sq.name" title="Delete">&times;</button>' +
            '</li>' +
          '</ul>' +
        '</div>' +
      '</div>'
  });
})();
