// Reports > Publish Report (Vue 2 options for Page.setup): tick one or more designs saved in the
// Jasper Designer, give each its own settings with the shared "Publish to" panel (publish-panel.js:
// JasperServers, folder, data source, Centrix HIS) and publish them one after another.
// "Deploy workflow" mode takes each report through three steps instead: deploy to the UAT zone's
// JasperServers, run the report on UAT and approve or reject it, then deploy the approved version
// to the Production zone (optionally saving it to Centrix HIS). Zones are set in Reports > Settings.
(function () {
  'use strict';

  var BASE = '/reports/publish';
  var MAX_JOBS = 50;
  var MODE_KEY = 'jrp.mode';
  var LIST_KEY = 'jrp.listOpen';
  var RID_KEY = 'jrp.reportId';      // '1': Deploy to UAT / Production print a Report ID in the page footer
  var FOLDER_RE = /^[A-Za-z0-9_\-/ ]+$/;
  var ZONE_LABEL = { uat: 'UAT', prod: 'Production' };

  function savedMode() {
    try { return localStorage.getItem(MODE_KEY) === 'workflow' ? 'workflow' : 'direct'; } catch (e) { return 'direct'; }
  }

  // Saved reports order: { by: 'name' | 'updated', dir: 'asc' | 'desc' }.
  var SORT_KEY = 'jrp.sort';
  function savedSort() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(SORT_KEY) || 'null'); } catch (e) { s = null; }
    return { by: s && s.by === 'updated' ? 'updated' : 'name', dir: s && s.dir === 'desc' ? 'desc' : 'asc' };
  }

  function savedListOpen() {
    try { return localStorage.getItem(LIST_KEY) !== '0'; } catch (e) { return true; }
  }

  function post(url, body) {
    return request(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }

  function request(url, options) {
    return fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }, options || {}))
      .then(function (r) {
        return r.json().catch(function () { return { error: 'The server answered ' + r.status + '.' }; })
          .then(function (d) { if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status)); return d; });
      });
  }

  // Role actions (Administration > Roles; administrators: all) for this page.
  // (read when used: Page.data is filled in by the page)
  var can = function (key) { var c = Page.data && Page.data.can && Page.data.can.publish; return !!(c && c[key]); };
  var directOk = function () { return !!Page.data && Page.data.directPublish !== false && can('direct-publish'); };

  var folderOf = function (uri) { return String(uri || '').replace(/^\/+/, '').replace(/\/[^/]*$/, ''); };

  Page.setup({
    data: function () {
      return {
        loading: true, loadError: '', designs: [], folders: [], q: '', folder: '*',
        jobs: [], focusedId: null,
        bulk: { target: '', folder: '', dataSource: '', locale: '', servers: [] },
        history: [], historyLoading: false, historyError: '',
        publishing: false, summary: null, toasts: [],
        // Direct publish turned off in Reports > Settings: the deploy workflow only.
        mode: directOk() ? savedMode() : 'workflow', samples: {}, listOpen: savedListOpen(), fullscreen: false,
        stage: '*', bulkOpen: false, historyOpen: true, reportIdOn: (function () { try { return localStorage.getItem(RID_KEY) === '1'; } catch (e) { return false; } })(), sort: savedSort(), checking: false, basicOpen: false,
        // "Replace the reports on JasperServer?" popup (askOverwrite)
        overwrite: { open: false, kind: 'publish', items: [], existing: 0 },
        viewer: { open: false, job: null, zone: 'uat', server: '', format: 'pdf', url: '', loading: false, error: '', servedBy: '' }
      };
    },
    computed: {
      // Direct publish: allowed in Reports > Settings and in the role.
      directOk: function () { return directOk(); },
      // Saved reports matching the search and folder (the stage pills count these).
      searched: function () {
        var q = this.q.toLowerCase(), folder = this.folder;
        return this.designs.filter(function (d) {
          if (folder !== '*' && (d.path || '') !== folder) return false;
          return !q || (d.name + ' ' + (d.path || '')).toLowerCase().indexOf(q) >= 0;
        });
      },
      // In the chosen order: by name, or by when it was last saved (ties by name).
      filtered: function () {
        var vm = this, stage = vm.stage, by = vm.sort.by, sign = vm.sort.dir === 'desc' ? -1 : 1;
        var list = stage === '*' ? vm.searched.slice() : vm.searched.filter(function (d) { return vm.stageOf(d) === stage; });
        var byName = function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || (a.path || '').localeCompare(b.path || ''); };
        return list.sort(function (a, b) {
          if (by === 'updated') {
            var ta = Date.parse(String(a.updated_at || '').replace(' ', 'T')) || 0, tb = Date.parse(String(b.updated_at || '').replace(' ', 'T')) || 0;
            return (ta - tb) * sign || byName(a, b);
          }
          return byName(a, b) * sign;
        });
      },
      // The stage pills above the saved reports, with how many of the searched ones are in each.
      stages: function () {
        var vm = this;
        var list = vm.mode === 'workflow'
          ? [['*', 'All'], ['none', 'Not deployed'], ['uat', 'On UAT'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['production', 'Production']]
          : [['*', 'All'], ['none', 'Not published'], ['published', 'Published']];
        var count = {};
        vm.searched.forEach(function (d) { var st = vm.stageOf(d); count[st] = (count[st] || 0) + 1; });
        return list.map(function (x) { return { id: x[0], name: x[1], n: x[0] === '*' ? vm.searched.length : count[x[0]] || 0 }; })
          .filter(function (x) { return x.id === '*' || x.id === 'none' || x.n || x.id === vm.stage; });
      },
      // Selected reports in each stage of the deploy workflow (the pipeline tiles).
      pipeline: function () {
        var vm = this, out = { ready: 0, uat: 0, approved: 0, production: 0, rejected: 0 };
        vm.jobs.forEach(function (j) {
          var d = j.deploy;
          if (!d || j.changed || d.status === 'superseded') out.ready++;
          else if (out[d.status] != null) out[d.status]++;
        });
        return out;
      },
      allOpen: function () { return this.jobs.length > 0 && this.jobs.every(function (j) { return j.open; }); },
      selectedIds: function () {
        var ids = {};
        this.jobs.forEach(function (j) { ids[j.id] = true; });
        return ids;
      },
      allShownSelected: function () {
        var ids = this.selectedIds;
        return this.filtered.length > 0 && this.filtered.every(function (d) { return ids[d.id]; });
      },
      focused: function () {
        var id = this.focusedId;
        return this.jobs.filter(function (j) { return j.id === id; })[0] || null;
      },
      // Reports > Settings as the shared "Publish to" panel needs it.
      ctx: function () { return { defaults: this.defaults, jasper: this.jasper, his: this.his, isAdmin: this.isAdmin }; },
      hisBlocked: function () { return JRPublish.hisBlocked(this.ctx); },
      servers: function () { return this.jasper.servers || []; },
      readyServers: function () { return this.servers.filter(function (s) { return s.configured; }).length; },
      serversTitle: function () { return this.servers.map(function (s) { return s.name + ': ' + s.url + (s.zone ? ' (' + ZONE_LABEL[s.zone] + ')' : ''); }).join('\n'); },
      // Problems that stop a report from being published, by design id ('' = ready).
      issues: function () {
        var vm = this, out = {}, routes = {}, codes = {};
        vm.jobs.forEach(function (j) {
          var r = vm.routeOf(j).toLowerCase();
          routes[r] = (routes[r] || 0) + 1;
          if (j.form.target === 'both' && j.form.hisCode) codes[j.form.hisCode.toLowerCase()] = (codes[j.form.hisCode.toLowerCase()] || 0) + 1;
        });
        vm.jobs.forEach(function (j) {
          var f = j.form;
          out[j.id] =
            j.loadError ? j.loadError
              : !j.detail ? 'Loading…'
                : j.detail.missingImages.length ? 'Upload the missing images in the Jasper Designer first.'
                : (j.detail.loops || []).length ? 'This report would make JasperServer loop. Fix it in the Jasper Designer first.'
                  : JRPublish.issue(f, vm.ctx)
                    || (routes[vm.routeOf(j).toLowerCase()] > 1 ? 'Another selected report publishes to the same JasperServer path.'
                      : f.target === 'both' && codes[f.hisCode.toLowerCase()] > 1 ? 'Another selected report uses the same HIS code.'
                        : '');
        });
        return out;
      },
      hasDone: function () {
        return this.jobs.some(function (j) { return j.status === 'done'; });
      },
      pending: function () {
        return this.jobs.filter(function (j) { return j.status !== 'done'; });
      },
      ready: function () {
        var issues = this.issues;
        return this.pending.filter(function (j) { return !issues[j.id]; });
      },
      publishLabel: function () {
        var n = this.ready.length, rest = this.pending.length - n;
        if (!this.jobs.length) return 'Publish';
        if (!this.pending.length) return 'All published';
        return 'Publish ' + n + ' report' + (n === 1 ? '' : 's') + (rest ? ' (' + rest + ' need' + (rest === 1 ? 's' : '') + ' attention)' : '');
      },

      // ─── Deploy workflow ──────────────────────────────────────────────────
      // Set-up servers of each zone.
      zones: function () {
        var by = function (z) { return this.servers.filter(function (s) { return s.zone === z && s.configured; }); }.bind(this);
        return { uat: by('uat'), prod: by('prod') };
      },
      // The "how this works" flow shown before any report is picked. A step that goes to several
      // JasperServers at once (a deploy zone, or the servers published to by default) lists each one.
      howSteps: function () {
        var vm = this, host = function (url) { try { return new URL(url).host; } catch (e) { return url || ''; } };
        var envs = function (list) { return list.map(function (s) { return { id: s.id, name: s.name, url: s.url, host: host(s.url) }; }); };
        var steps = [{ n: 1, title: 'Pick reports', text: 'Tick saved reports' + (vm.listOpen ? ' on the left' : '') + '.', envs: [] }];
        var zoneStep = function (n, zone, title) {
          var list = vm.zones[zone];
          return {
            n: n, title: title, zone: zone, envs: envs(list), missing: !list.length,
            text: !list.length ? 'Set a ' + ZONE_LABEL[zone] + ' server in Settings' : list.length === 1 ? list[0].name : list.length + ' servers, deployed together'
          };
        };
        if (vm.mode === 'workflow') {
          steps.push(zoneStep(2, 'uat', 'Deploy to UAT'));
          steps.push({ n: 3, title: 'Check & approve', text: 'Run the report on UAT and look at it.', envs: [], zone: 'check' });
          steps.push(zoneStep(4, 'prod', 'Deploy to Production'));
        } else {
          var targets = vm.servers.filter(function (s) { return s.configured && s.publishByDefault; });
          steps.push({ n: 2, title: 'Check the settings', text: 'Folder, data source, and HIS if you want it.', envs: [] });
          steps.push({ n: 3, title: 'Publish', text: targets.length > 1 ? targets.length + ' servers by default, at once' : 'One report, or all of them at once.', envs: envs(targets), zone: 'publish' });
        }
        return steps;
      },
      zoneNames: function () {
        var names = function (list) { return list.map(function (s) { return s.name; }).join(', '); };
        return { uat: names(this.zones.uat), prod: names(this.zones.prod) };
      },
      zoneProblem: function () {
        var missing = ['uat', 'prod'].filter(function (z) { return !this.zones[z].length; }, this).map(function (z) { return ZONE_LABEL[z]; });
        if (!missing.length) return '';
        return 'No JasperServer is set up in the ' + missing.join(' or ') + ' zone yet, so the deploy workflow cannot ' + (missing.length > 1 || missing[0] === 'UAT' ? 'start.' : 'finish.');
      },
      // Reports that go to UAT with "Deploy to UAT": not there yet, or changed since.
      uatReady: function () {
        var vm = this;
        return vm.jobs.filter(function (j) { return vm.needsUat(j) && !vm.uatIssue(j); });
      },
      prodReady: function () {
        var vm = this;
        return vm.jobs.filter(function (j) { return !vm.prodIssue(j); });
      },
      // The Report ID format, with the time now (DDMMYYYYHHMMSS).
      ridSample: function () {
        var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getDate()) + p(d.getMonth() + 1) + d.getFullYear() + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
      },
      workflowSummary: function () {
        var count = { uat: 0, approved: 0, rejected: 0, production: 0 };
        this.jobs.forEach(function (j) { if (j.deploy && count[j.deploy.status] != null) count[j.deploy.status]++; });
        var parts = [];
        if (count.uat) parts.push(count.uat + ' waiting for review on UAT');
        if (count.approved) parts.push(count.approved + ' approved');
        if (count.rejected) parts.push(count.rejected + ' rejected');
        if (count.production) parts.push(count.production + ' on Production');
        return parts.join(' · ');
      },
      // The servers of the viewer's zone the shown version went to.
      viewerServers: function () {
        var v = this.viewer;
        if (!v.open || !v.job || !v.job.deploy) return [];
        var stage = v.zone === 'prod' ? v.job.deploy.prod : v.job.deploy.uat;
        var ok = ((stage && stage.servers) || []).filter(function (s) { return s.ok; }).map(function (s) { return s.id; });
        return this.zones[v.zone].filter(function (s) { return ok.indexOf(s.id) >= 0; });
      }
    },
    watch: {
      reportIdOn: function (v) { try { localStorage.setItem(RID_KEY, v ? '1' : '0'); } catch (e) { /* not kept */ } },
      focusedId: function (id) {
        this.history = [];
        this.historyError = '';
        if (id) this.loadHistory(id);
      }
    },
    mounted: function () {
      var vm = this;
      vm.load();
      // Values for the report parameters when it is run on UAT (patientvisituid, loginuid, …).
      request(BASE + '/sample-params')
        .then(function (d) {
          vm.samples = d.values || {};
          vm.jobs.forEach(function (j) {
            Object.keys(j.params).forEach(function (k) { if (!j.params[k] && vm.samples[k]) j.params[k] = vm.samples[k]; });
          });
        })
        .catch(function () { /* not connected to a site: the parameters start empty */ });
      vm._onKey = function (e) {
        if (e.key !== 'Escape' || vm.basicOpen) return;      // Basic Data closes itself
        if (vm.overwrite.open) vm.closeOverwrite(false);
        else if (vm.viewer.open) vm.closeViewer();
        else if (vm.fullscreen && !document.fullscreenElement) vm.fullscreen = false;   // window-filling fallback
      };
      document.addEventListener('keydown', vm._onKey);
      // The browser leaves full screen on Esc (or F11) by itself.
      vm._onFullscreen = function () { vm.fullscreen = document.fullscreenElement === vm.$refs.root; };
      document.addEventListener('fullscreenchange', vm._onFullscreen);
    },
    beforeDestroy: function () {
      document.removeEventListener('keydown', this._onKey);
      document.removeEventListener('fullscreenchange', this._onFullscreen);
      if (document.fullscreenElement === this.$refs.root && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      this.closeViewer();
    },
    methods: {
      load: function () {
        var vm = this;
        vm.loading = true;
        vm.loadError = '';
        return request(BASE + '/designs')
          .then(function (d) {
            vm.designs = (d.designs || []).slice().sort(function (a, b) {
              return (a.path || '').localeCompare(b.path || '') || a.name.localeCompare(b.name);
            });
            vm.folders = d.folders || [];
            // Keep each queued report's "last published" in step with the list.
            vm.jobs.forEach(function (j) {
              var row = vm.designs.filter(function (d) { return d.id === j.id; })[0];
              if (row) j.design = row;
            });
          })
          .catch(function (err) { vm.loadError = 'Could not list saved reports: ' + err.message; })
          .then(function () { vm.loading = false; });
      },

      // ─── Selection ────────────────────────────────────────────────────────
      toggle: function (d) {
        if (this.publishing) return;
        if (this.selectedIds[d.id]) this.remove(d.id);
        else this.add(d);
      },
      toggleAllShown: function () {
        var vm = this;
        if (vm.publishing) return;
        if (vm.allShownSelected) {
          vm.filtered.forEach(function (d) { vm.remove(d.id); });
          return;
        }
        var added = 0;
        vm.filtered.some(function (d) {
          if (vm.selectedIds[d.id]) return false;
          if (vm.jobs.length >= MAX_JOBS) { vm.toast('At most ' + MAX_JOBS + ' reports can be published at once.', 'error'); return true; }
          vm.add(d, true);
          added++;
          return false;
        });
        if (added && !vm.focusedId && vm.jobs.length) vm.focusedId = vm.jobs[0].id;
      },
      add: function (d, quiet) {
        var vm = this;
        if (vm.selectedIds[d.id]) return;
        if (vm.jobs.length >= MAX_JOBS) { vm.toast('At most ' + MAX_JOBS + ' reports can be published at once.', 'error'); return; }
        var last = d.published && d.published.last, his = d.published && d.published.his;
        var job = {
          id: d.id, design: d, detail: null, loadError: '', open: true,
          form: JRPublish.form({
            target: his && !vm.hisBlocked ? 'both' : 'jasper',
            folder: last ? folderOf(last.uri) : '', dataSource: (last && last.dataSource) || '',
            hisCode: his ? his.hisCode : '', hisName: his ? his.hisName : d.name, locale: his && his.hisLocale === 'en' ? 'en' : 'th'
          }, vm.ctx),
          status: 'idle', message: '', result: null,
          // Deploy workflow: the latest deploy, whether the design changed since, the parameters
          // to run it on UAT with, the reason to reject it and the step running ('uat' | 'prod').
          deploy: d.deploy || null, changed: false, params: {}, note: '', wf: ''
        };
        vm.jobs.push(job);
        if (!quiet) vm.focusedId = d.id;
        request(BASE + '/designs/' + d.id)
          .then(function (detail) {
            job.params = vm.defaultParams(detail);
            job.detail = detail;
            // The design's own folder and data source come first, then its last publish, then the defaults.
            job.form.folder = detail.folder || job.form.folder || vm.defaults.folder;
            job.form.dataSource = detail.dataSource || job.form.dataSource || vm.defaults.dataSource;
            if (!his) job.form.hisName = detail.name;
          })
          .catch(function (err) { job.loadError = 'Could not open it: ' + err.message; });
        vm.loadDeploy(job);
      },
      // The values to run a report on UAT with: the JRXML's default value, else a record of the connected site.
      defaultParams: function (detail) {
        var vm = this, defs = detail.paramDefaults || {}, params = {};
        detail.params.forEach(function (p) { params[p] = defs[p] != null ? defs[p] : vm.samples[p] || ''; });
        return params;
      },
      resetParams: function (job) {
        if (job.detail) job.params = this.defaultParams(job.detail);
      },
      loadDeploy: function (job) {
        var vm = this;
        return request(BASE + '/designs/' + job.id + '/deploy')
          .then(function (d) { job.deploy = d.deploy; job.changed = d.changed; vm.syncListRow(job); })
          .catch(function () { /* the list's deploy stays */ });
      },
      remove: function (id) {
        if (this.publishing) return;
        if (this.viewer.open && this.viewer.job && this.viewer.job.id === id) this.closeViewer();
        this.jobs = this.jobs.filter(function (j) { return j.id !== id; });
        if (this.focusedId === id) this.focusedId = this.jobs.length ? this.jobs[0].id : null;
      },
      clearAll: function () {
        if (this.publishing) return;
        this.jobs = [];
        this.focusedId = null;
        this.summary = null;
      },
      clearPublished: function () {
        var vm = this;
        vm.jobs.filter(function (j) { return j.status === 'done'; }).forEach(function (j) { vm.remove(j.id); });
        vm.summary = null;
      },
      focus: function (job) { this.focusedId = job.id; },

      // ─── Per-report settings ──────────────────────────────────────────────
      routeOf: function (job) {
        return JRPublish.route(job.form, this.ctx, job.detail ? job.detail.name : job.design.name);
      },
      // The HIS code this report was last saved with: re-using it asks nothing.
      ownCode: function (job) {
        var his = job.design.published && job.design.published.his;
        return his ? his.hisCode : '';
      },
      setTarget: function (job, target) {
        if (this.publishing || job.status === 'done') return;
        if (target === 'both' && this.hisBlocked) { this.toast(this.hisBlocked, 'error'); return; }
        job.form.target = target;
      },
      applyBulk: function () {
        var vm = this, b = vm.bulk, n = 0;
        if (vm.publishing) return;
        if (b.target === 'both' && vm.hisBlocked) { vm.toast(vm.hisBlocked, 'error'); return; }
        vm.jobs.forEach(function (j) {
          if (j.status === 'done') return;
          if (b.target) j.form.target = b.target;
          if (b.folder.trim()) j.form.folder = b.folder.trim();
          if (b.dataSource.trim()) j.form.dataSource = b.dataSource.trim();
          if (b.locale) j.form.locale = b.locale;
          if (b.servers.length) j.form.servers = b.servers.slice();
          n++;
        });
        vm.bulk = { target: '', folder: '', dataSource: '', locale: '', servers: [] };
        vm.toast('Applied to ' + n + ' report' + (n === 1 ? '' : 's') + '.');
      },

      // ─── Publish ──────────────────────────────────────────────────────────
      publishAll: function () { this.publishJobs(this.ready.slice()); },
      publishOne: function (job) {
        if (this.issues[job.id] || job.status === 'done') return;
        this.focusedId = job.id;
        this.publishJobs([job]);
      },
      publishJobs: function (queue) {
        var vm = this;
        if (!vm.directOk || vm.publishing || vm.checking || !queue.length || !vm.jasper.configured) return;
        vm.askOverwrite('publish', queue).then(function (go) { if (go) vm.sendJobs(queue); });
      },

      // ─── Replace what is already on JasperServer? ─────────────────────────
      // Asks the target JasperServers which of the reports are there already. Publish and Deploy to UAT
      // go ahead without asking when none is; Deploy to Production always asks (it was a confirm before).
      // Resolves true to go ahead.
      askOverwrite: function (kind, jobs) {
        var vm = this;
        var checks = jobs.map(function (j) {
          if (kind === 'prod') return { key: String(j.id), kind: 'prod', id: j.deploy.id };
          var f = JRPublish.fields(j.form);
          return { key: String(j.id), kind: kind, id: j.id, folder: f.folder, servers: f.servers };
        });
        vm.checking = true;
        return post(BASE + '/existing', { checks: checks })
          .then(function (d) { return d.results || []; })
          .catch(function () { return []; })          // could not ask: the publish itself reports a server problem
          .then(function (results) {
            vm.checking = false;
            var byKey = {};
            results.forEach(function (r) { byKey[r.key] = r; });
            var items = jobs.map(function (j) {
              var r = byKey[String(j.id)] || {};
              return { name: j.design.name, uri: r.uri || (kind === 'prod' ? j.deploy.routepath : vm.routeOf(j)), servers: r.servers || [] };
            });
            var existing = items.filter(function (it) { return it.servers.length; }).length;
            if (!existing && kind !== 'prod') return true;
            return new Promise(function (resolve) {
              vm._owResolve = resolve;
              vm.overwrite = { open: true, kind: kind, items: items, existing: existing };
              vm.$nextTick(function () { var b = vm.$refs.owGo; if (b) b.focus(); });
            });
          });
      },
      owLabel: function () {
        var ow = this.overwrite;
        var act = { prod: 'Deploy to Production', uat: 'Deploy to UAT', publish: 'Publish' }[ow.kind];
        return ow.existing ? 'Replace and ' + act.charAt(0).toLowerCase() + act.slice(1) : act;
      },
      closeOverwrite: function (go) {
        var resolve = this._owResolve;
        this._owResolve = null;
        this.overwrite.open = false;
        if (resolve) resolve(!!go);
      },
      sendJobs: function (queue) {
        var vm = this;
        if (vm.publishing) return;
        vm.publishing = true;
        vm.summary = null;
        queue.forEach(function (j) { j.status = 'queued'; j.message = ''; });
        var ok = 0, failed = 0;
        var next = function (i) {
          if (i >= queue.length) return Promise.resolve();
          var j = queue[i];
          j.status = 'publishing';
          var body = Object.assign({ id: j.id }, JRPublish.fields(j.form));
          return request(BASE, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (d) {
              j.status = 'done'; j.result = d; ok++;
              // Published to some servers only: keep it open so the failures show.
              j.open = (d.servers || []).some(function (sv) { return !sv.ok; });
            })
            .catch(function (err) { j.status = 'failed'; j.message = err.message; j.open = true; failed++; })
            .then(function () { return next(i + 1); });
        };
        next(0).then(function () {
          vm.publishing = false;
          vm.summary = { ok: ok, failed: failed };
          vm.toast(failed ? ok + ' published, ' + failed + ' failed.' : (ok === 1 ? 'Report published.' : ok + ' reports published.'), failed ? 'error' : 'ok');
          vm.load();
          if (vm.focusedId) vm.loadHistory(vm.focusedId);
        });
      },

      // ─── History of the focused report ────────────────────────────────────
      loadHistory: function (id) {
        var vm = this;
        vm.historyLoading = true;
        vm.historyError = '';
        request(BASE + '/designs/' + id + '/history')
          .then(function (d) { if (vm.focusedId === id) vm.history = d.history || []; })
          .catch(function (err) { if (vm.focusedId === id) vm.historyError = 'Could not load the history: ' + err.message; })
          .then(function () { if (vm.focusedId === id) vm.historyLoading = false; });
      },
      // Fills the focused report's settings from an earlier publish.
      useHistory: function (h) {
        var job = this.focused;
        if (!job || this.publishing) return;
        var f = job.form;
        f.folder = folderOf(h.uri) || this.defaults.folder;
        f.dataSource = h.dataSource || f.dataSource;
        f.target = h.hisCode && !this.hisBlocked ? 'both' : 'jasper';
        var sv = this.servers.filter(function (s) { return s.name === h.server && s.configured; })[0];
        if (sv) f.servers = [sv.id];
        if (h.hisCode) { f.hisCode = h.hisCode; f.hisName = h.hisName || f.hisName; f.locale = h.hisLocale === 'en' ? 'en' : 'th'; }
        if (job.status === 'done') { job.status = 'idle'; job.result = null; }
        job.open = true;
        this.toast('Settings of ' + job.design.name + ' filled from the publish of ' + this.when(h.at) + '.');
      },
      // Lets a published report be changed and published again.
      reopen: function (job) {
        if (this.publishing) return;
        job.status = 'idle';
        job.result = null;
        job.open = true;
        this.focusedId = job.id;
      },

      // ─── Deploy workflow ──────────────────────────────────────────────────
      // Full screen: the browser's when it allows it, otherwise the page fills the window.
      // Problems other than the loop ones (those have their own red box).
      otherProblems: function (job) {
        var loops = (job.detail && job.detail.loops) || [];
        return ((job.detail && job.detail.problems) || []).filter(function (p) { return loops.indexOf(p) < 0; });
      },
      toggleFullscreen: function () {
        var vm = this, el = vm.$refs.root;
        if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
        if (vm.fullscreen) { vm.fullscreen = false; return; }
        if (el && el.requestFullscreen) el.requestFullscreen().catch(function () { vm.fullscreen = true; });
        else vm.fullscreen = true;
      },
      // The stage of a saved report for the pills: its latest deploy (workflow) or whether it was published.
      stageOf: function (d) {
        if (this.mode !== 'workflow') return d.published ? 'published' : 'none';
        if (!d.deploy) return 'none';
        return d.deploy.status === 'superseded' ? 'uat' : d.deploy.status;
      },
      setAllOpen: function (open) { this.jobs.forEach(function (j) { j.open = open; }); },
      // The one button each selected report shows for what to do next.
      nextAction: function (job) {
        var vm = this, d = job.deploy;
        if (vm.mode !== 'workflow') {
          if (job.status === 'publishing' || job.status === 'queued') return { text: job.status === 'queued' ? 'Waiting…' : 'Publishing…', icon: 'fa-spinner fa-spin', cls: 'btn-primary', off: true };
          if (job.status === 'done') return { text: 'Publish again', icon: 'fa-redo', cls: 'btn-outline-secondary', run: 'reopen', off: vm.publishing };
          return { text: 'Publish', icon: 'fa-paper-plane', cls: 'btn-primary', run: 'publishOne', off: vm.publishing || !!vm.issues[job.id], why: vm.issues[job.id] };
        }
        if (job.wf) return { text: job.wf === 'uat' ? 'Deploying to UAT…' : 'Deploying to Production…', icon: 'fa-spinner fa-spin', cls: 'btn-primary', off: true };
        if (!d || job.changed || d.status === 'superseded' || d.status === 'rejected') {
          return { text: d ? 'Deploy to UAT again' : 'Deploy to UAT', icon: 'fa-flask', cls: 'btn-primary', run: 'deployUat', off: vm.publishing || !!vm.uatIssue(job), why: vm.uatIssue(job) };
        }
        if (d.status === 'uat') return { text: 'Check on UAT', icon: 'fa-eye', cls: 'btn-warning', run: 'checkUat', off: vm.publishing || !vm.uatRunnable(job),
          why: vm.missingParams(job).length ? 'Fill in the required parameters first: ' + vm.missingParams(job).join(', ') : '' };
        if (d.status === 'approved') return { text: 'Deploy to Production', icon: 'fa-industry', cls: 'btn-success', run: 'deployProd', off: vm.publishing || !!vm.prodIssue(job), why: vm.prodIssue(job) };
        return { text: 'View on Production', icon: 'fa-eye', cls: 'btn-outline-secondary', run: 'checkProd', off: vm.publishing };
      },
      act: function (job) {
        var a = this.nextAction(job);
        if (a.off || !a.run) return;
        if (a.run === 'checkUat') this.openViewer(job, 'uat');
        else if (a.run === 'checkProd') this.openViewer(job, 'prod');
        else this[a.run](job);
      },
      // Short text under each step of a report's progress tracker.
      stepNote: function (job, step) {
        var d = job.deploy;
        if (step === 1) return !d ? 'Not yet' : job.changed ? 'Changed since' : this.when(d.uat.at);
        if (step === 2) return !d ? '—' : d.status === 'uat' ? 'Waiting for you' : d.review ? (d.status === 'rejected' ? 'Rejected' : 'Approved') + ' by ' + d.review.by : '—';
        return d && d.prod ? this.when(d.prod.at) : d && d.status === 'approved' ? 'Ready' : '—';
      },
      // Shows or hides the saved reports panel (remembered in this browser).
      toggleList: function () {
        this.listOpen = !this.listOpen;
        try { localStorage.setItem(LIST_KEY, this.listOpen ? '1' : '0'); } catch (e) { /* not kept */ }
      },
      // Picking the field again flips the direction; a new field starts A→Z, or newest first for the date.
      setSort: function (by) {
        if (this.sort.by === by) this.sort.dir = this.sort.dir === 'asc' ? 'desc' : 'asc';
        else this.sort = { by: by, dir: by === 'updated' ? 'desc' : 'asc' };
        try { localStorage.setItem(SORT_KEY, JSON.stringify(this.sort)); } catch (e) { /* not kept */ }
      },
      setMode: function (mode) {
        if (this.publishing || this.mode === mode || (mode === 'direct' && !this.directOk)) return;
        this.mode = mode;
        this.stage = '*';
        try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* not kept */ }
      },
      zoneTitle: function (zone) {
        return this.zones[zone].map(function (s) { return s.name + ': ' + s.url; }).join('\n') || 'Set the ' + ZONE_LABEL[zone] + ' zone of a JasperServer in Reports > Settings.';
      },
      deployBadge: function (d) {
        return { uat: 'On UAT', approved: 'UAT approved', rejected: 'UAT rejected', production: 'Production', superseded: 'UAT' }[d.status] || d.status;
      },
      deployTitle: function (d) {
        if (d.status === 'production') return 'On Production since ' + this.when(d.prod.at) + ' (' + d.routepath + ')';
        if (d.review) return (d.status === 'rejected' ? 'Rejected' : 'Approved') + ' on UAT by ' + d.review.by + ' ' + this.when(d.review.at);
        return 'Deployed to UAT ' + this.when(d.uat.at) + ' by ' + d.uat.by + ', waiting for review';
      },
      needsUat: function (job) { return !job.deploy || job.changed; },
      // Why the report cannot go to UAT now ('' = it can).
      uatIssue: function (job) {
        var vm = this;
        if (!vm.canAct('deploy-uat')) return "Your role can't deploy to UAT.";
        if (job.loadError) return job.loadError;
        if (!job.detail) return 'Loading…';
        if (job.detail.missingImages.length) return 'Upload the missing images in the Jasper Designer first.';
        if ((job.detail.loops || []).length) return 'This report would make JasperServer loop. Fix it in the Jasper Designer first.';
        if (!vm.zones.uat.length) return 'No UAT JasperServer (Reports > Settings).';
        var folder = String(job.form.folder || vm.defaults.folder).trim().replace(/^\/+|\/+$/g, '');
        if (!folder || !FOLDER_RE.test(folder) || folder.indexOf('..') >= 0) return 'Folder may contain English letters, numbers, spaces, _ - and /.';
        var route = vm.routeOf(job).toLowerCase();
        if (vm.jobs.some(function (j) { return j !== job && vm.routeOf(j).toLowerCase() === route; })) return 'Another selected report deploys to the same JasperServer path.';
        return '';
      },
      // Why the report cannot go to Production now ('' = it can).
      prodIssue: function (job) {
        var vm = this, d = job.deploy, f = job.form;
        if (!d) return 'Deploy to UAT first.';
        if (!vm.canAct('deploy-prod') && d.status === 'approved') return "Your role can't deploy to Production.";
        if (d.status !== 'approved') {
          return {
            uat: 'Check the report on UAT and approve it first.',
            rejected: 'Rejected on UAT. Fix the design and deploy it to UAT again.',
            production: 'Already on Production.',
            superseded: 'A newer version is on UAT.'
          }[d.status] || 'Not ready for Production.';
        }
        if (!vm.zones.prod.length) return 'No Production JasperServer (Reports > Settings).';
        if (f.target !== 'both') return '';
        var blocked = vm.hisBlocked;
        if (blocked) return blocked;
        if (!f.hisCode.trim() || !f.hisName.trim()) return 'Enter the report code and name for HIS.';
        if (f.dup.exists && f.dup.asked) return 'Choose “Replace it” or another HIS report code.';
        var code = f.hisCode.trim().toLowerCase();
        if (vm.jobs.some(function (j) { return j !== job && j.form.target === 'both' && j.form.hisCode.trim().toLowerCase() === code; })) return 'Another selected report uses the same HIS code.';
        return '';
      },
      // Whether the role may do an action of this page.
      canAct: function (key) { return can(key); },
      uatRunnable: function (job) {
        return !!job.deploy && job.deploy.status !== 'superseded' && job.deploy.uat.servers.some(function (s) { return s.ok; }) && !this.missingParams(job).length;
      },
      // Required parameters (no usable default in the JRXML) that are still empty.
      isRequired: function (job, p) { return !!job.detail && (job.detail.paramRequired || []).indexOf(p) >= 0; },
      missingParams: function (job) {
        if (!job.detail) return [];
        return (job.detail.paramRequired || []).filter(function (p) { return !String(job.params[p] == null ? '' : job.params[p]).trim(); });
      },
      // Step state for the stepper: is-done, is-current, is-bad or is-locked.
      stepClass: function (job, step) {
        var d = job.deploy, st = d ? d.status : '';
        if (step === 1) return d && !job.changed ? 'is-done' : 'is-current';
        if (step === 2) {
          if (!d) return 'is-locked';
          if (st === 'rejected') return 'is-bad';
          return st === 'uat' ? 'is-current' : 'is-done';
        }
        if (st === 'production') return 'is-done';
        return st === 'approved' ? 'is-current' : 'is-locked';
      },

      // Runs fn(job) for each job one after another, with the page busy.
      // The report's row in Saved reports (and its stage pill) with the deploy the server just returned.
      syncListRow: function (job) {
        var row = this.designs.filter(function (d) { return d.id === job.id; })[0];
        if (row && job.deploy) this.$set(row, 'deploy', job.deploy);
      },
      runJobs: function (list, fn) {
        var vm = this;
        if (vm.publishing || !list.length) return Promise.resolve();
        vm.publishing = true;
        var res = { ok: 0, failed: 0 };
        var next = function (i) {
          if (i >= list.length) return Promise.resolve();
          return fn(list[i]).then(function () { res.ok++; }, function () { res.failed++; }).then(function () { return next(i + 1); });
        };
        return next(0).then(function () {
          vm.publishing = false;
          vm.load();
          if (vm.focusedId) vm.loadHistory(vm.focusedId);
          return res;
        });
      },
      // Toasts each server that failed when the others worked.
      partly: function (job, servers, zone) {
        var bad = (servers || []).filter(function (s) { return !s.ok; });
        if (bad.length) this.toast(job.design.name + ': ' + ZONE_LABEL[zone] + ' ' + bad.map(function (s) { return s.name + ' failed (' + s.error + ')'; }).join(', '), 'error');
      },
      uatOne: function (job) {
        var vm = this;
        job.wf = 'uat';
        return post(BASE + '/deploys/uat', { id: job.id, folder: job.form.folder, dataSource: job.form.dataSource, reportId: vm.reportIdOn })
          .then(function (d) {
            job.deploy = d.deploy;
            vm.syncListRow(job);      // Saved reports shows it now, not after the whole batch
            job.changed = false;
            job.note = '';
            vm.partly(job, d.deploy.uat.servers, 'uat');
          })
          .catch(function (err) { vm.toast(job.design.name + ': ' + err.message, 'error'); throw err; })
          .then(function (x) { job.wf = ''; return x; }, function (err) { job.wf = ''; throw err; });
      },
      prodOne: function (job) {
        var vm = this;
        job.wf = 'prod';
        var f = JRPublish.fields(job.form);
        var body = f.toHis ? { toHis: true, hisCode: f.hisCode, hisName: f.hisName, locale: f.locale } : {};
        body.reportId = vm.reportIdOn;      // used when the UAT version has no Report ID
        return post(BASE + '/deploys/' + job.deploy.id + '/production', body)
          .then(function (d) {
            job.deploy = d.deploy;
            vm.syncListRow(job);      // Saved reports shows it now, not after the whole batch
            vm.partly(job, d.servers, 'prod');
          })
          .catch(function (err) {
            vm.toast(job.design.name + ': ' + err.message, 'error');
            vm.loadDeploy(job);
            throw err;
          })
          .then(function (x) { job.wf = ''; return x; }, function (err) { job.wf = ''; throw err; });
      },
      deployUat: function (job) {
        var vm = this;
        if (vm.uatIssue(job) || vm.publishing || vm.checking) return;
        vm.focusedId = job.id;
        vm.askOverwrite('uat', [job]).then(function (go) {
          if (!go) return;
          vm.runJobs([job], vm.uatOne).then(function (r) {
            if (r && r.ok) vm.toast(job.design.name + ' is on UAT. Check the report there, then approve it.');
          });
        });
      },
      deployAllUat: function () {
        var vm = this, list = vm.uatReady.slice();
        if (!list.length || vm.publishing || vm.checking) return;
        vm.askOverwrite('uat', list).then(function (go) {
          if (!go) return;
          vm.runJobs(list, vm.uatOne).then(function (r) {
            if (r && !r.failed) vm.toast(r.ok === 1 ? '1 report is on UAT.' : r.ok + ' reports are on UAT.');
          });
        });
      },
      deployProd: function (job) {
        var vm = this;
        if (vm.prodIssue(job) || vm.publishing || vm.checking) return;
        vm.askOverwrite('prod', [job]).then(function (go) {
          if (!go) return;
          vm.focusedId = job.id;
          vm.runJobs([job], vm.prodOne).then(function (r) {
            if (r && r.ok) vm.toast(job.design.name + ' is on Production.');
          });
        });
      },
      deployAllProd: function () {
        var vm = this, list = vm.prodReady.slice();
        if (!list.length || vm.publishing || vm.checking) return;
        vm.askOverwrite('prod', list).then(function (go) {
          if (!go) return;
          vm.runJobs(list, vm.prodOne).then(function (r) {
            if (r && !r.failed) vm.toast(r.ok === 1 ? '1 report is on Production.' : r.ok + ' reports are on Production.');
          });
        });
      },
      review: function (job, approved) {
        var vm = this;
        if (vm.publishing || !job.deploy || !vm.canAct('review')) return;
        if (!approved && !job.note.trim()) { vm.toast('Say what is wrong with the report to reject it.', 'error'); return; }
        vm.publishing = true;
        post(BASE + '/deploys/' + job.deploy.id + '/review', { approved: approved, note: job.note.trim() })
          .then(function (d) {
            job.deploy = d.deploy;
            vm.syncListRow(job);      // Saved reports shows it now, not after the whole batch
            job.note = '';
            vm.toast(approved ? job.design.name + ' approved. It can go to Production now.' : job.design.name + ' rejected on UAT.', approved ? 'ok' : 'error');
          })
          .catch(function (err) { vm.toast(err.message, 'error'); vm.loadDeploy(job); })
          .then(function () { vm.publishing = false; vm.load(); });
      },

      // ─── Report viewer: the deployed report run on JasperServer ───────────
      openViewer: function (job, zone) {
        var missing = this.missingParams(job);
        if (missing.length) { this.focusedId = job.id; this.toast('Fill in the required parameters first: ' + missing.join(', ') + '.', 'error'); return; }
        this.closeViewer();
        this.viewer = { open: true, job: job, zone: zone, server: '', format: 'pdf', url: '', loading: false, error: '', servedBy: '' };
        var list = this.viewerServers;
        this.viewer.server = list.length ? list[0].id : '';
        this.runViewer();
      },
      runViewer: function () {
        var vm = this, v = vm.viewer, job = v.job;
        if (!v.open || !job || !job.deploy) return;
        if (v.url) { URL.revokeObjectURL(v.url); v.url = ''; }
        v.loading = true;
        v.error = '';
        var params = {};
        Object.keys(job.params).forEach(function (k) { if (job.params[k]) params[k] = job.params[k]; });
        var q = 'zone=' + v.zone + '&format=' + v.format + '&params=' + encodeURIComponent(JSON.stringify(params)) + (v.server ? '&server=' + encodeURIComponent(v.server) : '');
        var token = vm._run = {};
        fetch(BASE + '/deploys/' + job.deploy.id + '/run?' + q, { credentials: 'same-origin' })
          .then(function (r) {
            if (!r.ok) {
              return r.json().catch(function () { return { error: 'The server answered ' + r.status + '.' }; })
                .then(function (d) { throw new Error(d.error || ('HTTP ' + r.status)); });
            }
            var by = r.headers.get('X-Jasper-Server');
            return r.blob().then(function (blob) { return { blob: blob, by: by ? decodeURIComponent(by) : '' }; });
          })
          .then(function (out) {
            if (token !== vm._run || !vm.viewer.open) return;
            v.servedBy = out.by;
            v.url = URL.createObjectURL(out.blob);
            if (v.format === 'xlsx') {
              var a = document.createElement('a');
              a.href = v.url;
              a.download = job.design.name + '.xlsx';
              document.body.appendChild(a);
              a.click();
              a.remove();
            }
          })
          .catch(function (err) { if (token === vm._run) v.error = err.message; })
          .then(function () { if (token === vm._run) v.loading = false; });
      },
      closeViewer: function () {
        var v = this.viewer;
        if (v.url) URL.revokeObjectURL(v.url);
        this._run = null;
        this.viewer = { open: false, job: null, zone: 'uat', server: '', format: 'pdf', url: '', loading: false, error: '', servedBy: '' };
      },
      deployFromViewer: function () {
        var job = this.viewer.job;
        this.closeViewer();
        this.deployProd(job);
      },

      serverNames: function (job) { return JRPublish.serverNames(job.form, this.ctx).join(', ') || 'no JasperServer'; },
      statusOf: function (job) {
        if (this.mode === 'workflow') return this.workflowStatus(job);
        if (job.status === 'publishing') return { cls: 'is-run', icon: 'fa-spinner fa-spin', text: 'Publishing…' };
        if (job.status === 'queued') return { cls: 'is-wait', icon: 'fa-clock', text: 'Waiting' };
        if (job.status === 'done') {
          var partly = job.result && (job.result.servers || []).some(function (sv) { return !sv.ok; });
          if (partly) return { cls: 'is-warn', icon: 'fa-exclamation-circle', text: 'Partly published' };
          return { cls: 'is-ok', icon: 'fa-check-circle', text: job.result && job.result.registered ? 'Published + HIS' : 'Published' };
        }
        if (job.status === 'failed') return { cls: 'is-bad', icon: 'fa-times-circle', text: 'Failed' };
        if (!job.detail && !job.loadError) return { cls: 'is-wait', icon: 'fa-spinner fa-spin', text: 'Loading' };
        return this.issues[job.id] ? { cls: 'is-warn', icon: 'fa-exclamation-triangle', text: 'Needs attention' } : { cls: 'is-ready', icon: 'fa-circle', text: 'Ready' };
      },
      workflowStatus: function (job) {
        var d = job.deploy;
        if (job.wf === 'uat') return { cls: 'is-run', icon: 'fa-spinner fa-spin', text: 'Deploying to UAT…' };
        if (job.wf === 'prod') return { cls: 'is-run', icon: 'fa-spinner fa-spin', text: 'To Production…' };
        if (!job.detail && !job.loadError) return { cls: 'is-wait', icon: 'fa-spinner fa-spin', text: 'Loading' };
        if (!d || d.status === 'superseded') return this.uatIssue(job) ? { cls: 'is-warn', icon: 'fa-exclamation-triangle', text: 'Needs attention' } : { cls: 'is-ready', icon: 'fa-circle', text: 'Ready for UAT' };
        if (job.changed && d.status !== 'production') return { cls: 'is-warn', icon: 'fa-pen', text: 'Changed since UAT' };
        if (d.status === 'uat') return { cls: 'is-warn', icon: 'fa-hourglass-half', text: 'Waiting for review' };
        if (d.status === 'approved') return { cls: 'is-ready', icon: 'fa-check', text: 'UAT approved' };
        if (d.status === 'rejected') return { cls: 'is-bad', icon: 'fa-times-circle', text: 'UAT rejected' };
        if (d.status === 'production') return { cls: 'is-ok', icon: 'fa-check-circle', text: job.changed ? 'Prod · changed' : 'On Production' };
        return { cls: 'is-wait', icon: 'fa-circle', text: d.status };
      },
      when: function (s) {
        if (!s) return '';
        // SQLite datetime('now') is UTC without a zone.
        var d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
        return isNaN(d) ? s : d.toLocaleString();
      },
      toast: function (msg, type) {
        var vm = this, t = { id: Date.now() + Math.random(), msg: msg, type: type || 'ok' };
        vm.toasts.push(t);
        setTimeout(function () { vm.toasts = vm.toasts.filter(function (x) { return x !== t; }); }, type === 'error' ? 7000 : 3500);
      }
    }
  });
})();
