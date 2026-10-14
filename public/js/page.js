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
