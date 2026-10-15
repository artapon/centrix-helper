// Mounts the current module view (rendered by res.renderPage) as a Vue 2 app.
//
//   Page.data          server locals (set by renderPage)
//   Page.setup(opts)   view scripts add Vue options: methods, computed, data, mounted, ...
//   Page.vm            the mounted Vue instance
(function () {
  var options = [];

  // Server data is display-only: freezing it skips Vue's deep reactivity walk, which keeps
  // large result tables fast. Top-level keys stay reactive, so pages can reassign them.
  function freezeValues(data) {
    Object.keys(data).forEach(function (key) {
      if (data[key] && typeof data[key] === 'object') data[key] = deepFreeze(data[key]);
    });
    return data;
  }
  function deepFreeze(value) {
    Object.keys(value).forEach(function (key) {
      if (value[key] && typeof value[key] === 'object') deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  window.Page = {
    data: {},
    vm: null,
    setup: function (opts) {
      options.push(opts);
    },
    mount: function () {
      var data = freezeValues(this.data);
      this.vm = new Vue({
        el: '#page-app',
        template: '#page-template',
        mixins: options,
        data: function () { return data; }
      });
      return this.vm;
    }
  };
})();

// <page-pager :paging="paging">: Previous / Next of a paged list (see app/core/http/paging.js).
// In a card header it sits right after the table filter app.js adds; anywhere else, on the right.
(function () {
  if (!window.Vue) return;
  Vue.component('page-pager', {
    props: { paging: { type: Object, default: null } },
    template:
      '<div v-if="paging" class="pg-tools">' +
        '<span v-if="paging.to" class="pg-range">Page {{ paging.page + 1 }} · rows {{ paging.from }}–{{ paging.to }}</span>' +
        '<a :href="paging.prev || null" class="btn btn-secondary btn-sm" :class="{ disabled: !paging.prev }" :aria-disabled="paging.prev ? \'false\' : \'true\'" :tabindex="paging.prev ? null : -1">' +
          '<i class="fas fa-chevron-left mr-1"></i> Previous</a>' +
        '<a :href="paging.next || null" class="btn btn-secondary btn-sm" :class="{ disabled: !paging.next }" :aria-disabled="paging.next ? \'false\' : \'true\'" :tabindex="paging.next ? null : -1">' +
          'Next <i class="fas fa-chevron-right ml-1"></i></a>' +
      '</div>'
  });
})();
