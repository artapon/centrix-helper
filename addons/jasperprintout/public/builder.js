// Jasper Print-Out Builder page (Vue 2 options for Page.setup).
// 1. load PDFs and crop pages or areas into the gallery (kept in this browser's localStorage),
//    or upload images; 2. pick and order the pages; 3. publish to one or more JasperServers
//    (optionally saving the report to Centrix HIS) with the shared "Publish to" panel
//    (publish-panel.js, defaults from Reports > Settings), or download the JRXML.
(function () {
  'use strict';

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  var GALLERY_KEY = 'jpb.cropGallery';
  var WIDTH_KEY = 'jpb.rightWidth';
  var FILES_KEY = 'jpb.filesOpen';     // '0' = PDF files panel hidden
  var PAGES_KEY = 'jpb.pagesOpen';     // '0' = Pages panel hidden
  var FM_SORT_KEY = 'jpb.fmSort';      // { by: 'name' | 'updated', dir: 'asc' | 'desc' } of the Open / Save dialog

  function savedFmSort() {
    var s = null;
    try { s = JSON.parse(store(FM_SORT_KEY) || 'null'); } catch (e) { s = null; }
    return { by: s && s.by === 'updated' ? 'updated' : 'name', dir: s && s.dir === 'desc' ? 'desc' : 'asc' };
  }
  var MIN_RIGHT = 340, MAX_RIGHT = 720;
  var BASE = '/reports/print-out-builder';

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
      return true;
    } catch (e) { return value === undefined ? null : false; }
  }

  function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function xmlAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // Stand-alone JRXML with the page images embedded (for Jaspersoft Studio).
  function localJrxml(items, reportName, version) {
    var bands = items.map(function (item, idx) {
      var parts = item.dataURL.split(',');
      var mime = parts[0].replace('data:', '').replace(';base64', '');
      return '\n    <band height="680" splitType="Stretch">' +
        '\n      <!-- Page ' + (idx + 1) + ' of ' + items.length + ': ' + xmlAttr(item.name).replace(/--/g, '- -') + ' -->' +
        '\n      <image scaleImage="FillFrame">' +
        '\n        <reportElement positionType="FixRelativeToBottom" x="-20" y="0" width="595" height="679" uuid="' + uuid() + '"/>' +
        '\n        <imageExpression><![CDATA["data:' + mime + ';base64,' + parts[1] + '"]]></imageExpression>' +
        '\n      </image>' +
        '\n    </band>';
    }).join('\n');
    var versionText = version ? '\n      <staticText>\n        <reportElement x="5" y="2" width="212" height="19" uuid="' + uuid() + '"/>\n        <textElement>\n          <font fontName="TH SarabunPSK" size="12"/>\n        </textElement>\n        <text><![CDATA[' + String(version).replace(/]]>/g, '') + ']]></text>\n      </staticText>' : '';
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<jasperReport xmlns="http://jasperreports.sourceforge.net/jasperreports" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://jasperreports.sourceforge.net/jasperreports http://jasperreports.sourceforge.net/xsd/jasperreport.xsd" name="' + xmlAttr(reportName) + '" pageWidth="595" pageHeight="842" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="12" uuid="' + uuid() + '">\n' +
      '  <property name="com.jaspersoft.studio.data.defaultdataadapter" value="One Empty Record"/>\n' +
      '  <parameter name="patientvisituid" class="java.lang.String">\n    <defaultValueExpression><![CDATA[""]]></defaultValueExpression>\n  </parameter>\n' +
      '  <parameter name="organisationuid" class="java.lang.String">\n    <defaultValueExpression><![CDATA[""]]></defaultValueExpression>\n  </parameter>\n' +
      '  <queryString language="MongoDbQuery">\n    <![CDATA[{\n    runCommand: {\n      aggregate : \'patientvisits\',\n      pipeline : [\n        { $match: { statusflag: \'A\', _id : {"$oid": $P{patientvisituid} } } },\n        { $project: { "_id": "$_id" } }\n      ]\n    }\n }]]>\n  </queryString>\n' +
      '  <field name="_id" class="org.bson.types.ObjectId"/>\n' +
      '  <background>\n    <band splitType="Stretch"/>\n  </background>\n' +
      '  <pageHeader>\n    <band height="105">\n      <subreport>\n        <reportElement x="0" y="0" width="575" height="105" uuid="' + uuid() + '"/>\n' +
      '        <subreportParameter name="organisationuid">\n          <subreportParameterExpression><![CDATA[$P{organisationuid}]]></subreportParameterExpression>\n        </subreportParameter>\n' +
      '        <subreportParameter name="patientvisituid">\n          <subreportParameterExpression><![CDATA[$P{patientvisituid}]]></subreportParameterExpression>\n        </subreportParameter>\n' +
      '        <connectionExpression><![CDATA[$P{REPORT_CONNECTION}]]></connectionExpression>\n' +
      '        <subreportExpression><![CDATA["/Centrixreports/SubReports/LayoutHeader.jrxml"]]></subreportExpression>\n      </subreport>\n    </band>\n  </pageHeader>\n' +
      '  <detail>' + bands + '\n  </detail>\n' +
      '  <pageFooter>\n    <band height="25" splitType="Stretch">' + versionText +
      '\n      <textField evaluationTime="Report">\n        <reportElement x="271" y="2" width="100" height="20" uuid="' + uuid() + '"/>\n        <textElement textAlignment="Left" verticalAlignment="Middle">\n          <font fontName="TH SarabunPSK" size="12"/>\n        </textElement>\n        <textFieldExpression><![CDATA[" of " + $V{PAGE_NUMBER}]]></textFieldExpression>\n      </textField>' +
      '\n      <textField>\n        <reportElement x="208" y="2" width="100" height="20" uuid="' + uuid() + '"/>\n        <textElement textAlignment="Center" verticalAlignment="Middle">\n          <font fontName="TH SarabunPSK" size="12"/>\n        </textElement>\n        <textFieldExpression><![CDATA["Page " + $V{PAGE_NUMBER}]]></textFieldExpression>\n      </textField>\n    </band>\n  </pageFooter>\n</jasperReport>\n';
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function dataURLtoBlob(dataURL) {
    var parts = dataURL.split(','), mime = parts[0].match(/data:([^;]+)/)[1];
    var bin = atob(parts[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(answer);
  }
  // Folder requests send one "payload" field, as Jasper Designer does (the handlers are shared).
  function postJson(url, data) {
    var fd = new FormData();
    fd.append('payload', JSON.stringify(data));
    return fetch(url, { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(answer);
  }
  function answer(r) {
    return r.json().catch(function () { return { error: 'The server answered ' + r.status + '.' }; })
      .then(function (d) { if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status)); return d; });
  }

  Page.setup({
    data: function () {
      var width = parseInt(store(WIDTH_KEY), 10);
      return {
        // step 1: PDFs
        pdfFiles: [], currentFileIdx: -1, numPages: 0, rendering: false, pdfDragOver: false,
        pageNo: 1, scale: '1', format: 'jpeg', quality: 100,
        loadingText: '',
        // crop
        currentPage: null, cropArea: null,
        info: 'Drag a rectangle on a page to crop it, or use "A4 page" / "Whole PDF".', infoOk: false,
        // step 2: gallery, uploads, page order
        cropItems: [], uploadedItems: [], selected: [], tab: 'gallery', imageDragOver: false, dragId: null,
        confirmClear: false, deleteTarget: null,
        // step 3: report
        form: { name: '', version: '', pub: JRPublish.form({}, Page.data) },
        publishing: false, result: null, toasts: [],
        // Save to the Jasper Designer library: the design last saved from here, and the file manager dialog
        savedId: null, savedPath: '', saving: false, fm: null, fmBusy: false, saved: null, fmSort: savedFmSort(),
        fullscreen: false,
        rightWidth: width >= MIN_RIGHT && width <= MAX_RIGHT ? width : 420,
        filesOpen: store(FILES_KEY) !== '0', pagesOpen: store(PAGES_KEY) !== '0'
      };
    },
    computed: {
      step1: function () { return this.numPages > 0 || this.uploadedItems.length ? 'done' : 'active'; },   // images skip the PDF
      step2: function () { return this.selected.length ? 'done' : (this.numPages > 0 || this.cropItems.length ? 'active' : ''); },
      step3: function () { return this.selected.length ? 'active' : ''; },
      currentFile: function () { return this.pdfFiles[this.currentFileIdx] || null; },
      reportNameClean: function () { return this.cleanName(this.form.name); },
      // Reports > Settings as the "Publish to" panel needs it.
      ctx: function () { return { defaults: this.defaults, jasper: this.jasper, his: this.his, isAdmin: this.isAdmin }; },
      // Role actions (Administration > Roles) and Reports > Settings: what this user may do here.
      canPublish: function () { return this.directPublish !== false && !!(this.can && this.can.builder && this.can.builder.publish); },
      canSave: function () { return !!(this.can && this.can.builder && this.can.builder.save); },
      canDelete: function () { return !!(this.can && this.can.builder && this.can.builder.delete); },
      // Page header: the JasperServers that are set up, and whether reports can be saved to HIS.
      hisBlocked: function () { return JRPublish.hisBlocked(this.ctx); },
      servers: function () { return (this.jasper && this.jasper.servers) || []; },
      readyServers: function () { return this.servers.filter(function (s) { return s.configured; }).length; },
      serversTitle: function () { return this.servers.map(function (s) { return s.name + ': ' + s.url; }).join('\n'); },
      publishBlocked: function () {
        if (!this.selected.length) return 'Pick at least one page in step 2.';
        if (!this.reportNameClean) return 'Enter a report name (English letters, numbers or _).';
        return JRPublish.issue(this.form.pub, this.ctx);
      },
      publishHint: function () {
        var names = JRPublish.serverNames(this.form.pub, this.ctx).join(', ');
        return 'Publishes to ' + names + (this.form.pub.target === 'both' ? ', then saves it to HIS.' : '. An existing report with the same name is replaced.');
      },
      publishLabel: function () {
        var n = this.selected.length;
        return n > 1 ? 'Publish ' + n + '-page report' : 'Publish 1-page report';
      },
      layoutStyle: function () { return { gridTemplateColumns: (this.filesOpen ? '280px ' : '') + 'minmax(0, 1fr) ' + this.rightWidth + 'px' }; }
    },
    watch: {
      'form.name': function (name, old) {
        // The HIS name follows the report name until it is changed by hand.
        var pub = this.form.pub;
        if (!pub.hisName || pub.hisName === this.cleanName(old)) pub.hisName = this.cleanName(name);
      }
    },
    created: function () {
      this._pdf = null;            // PDF.js document: kept out of Vue's reactivity
      this._canvas = null;         // canvas being cropped
      this._sel = null;            // { x0, y0, x1, y1, dragging } in canvas pixels
      this._cropSeq = 0;
    },
    mounted: function () {
      this.loadGallery();
      this._onMove = this.onMouseMove.bind(this);
      this._onUp = this.onMouseUp.bind(this);
      this._onKey = this.onKeyDown.bind(this);
      document.addEventListener('mousemove', this._onMove);
      document.addEventListener('mouseup', this._onUp);
      document.addEventListener('keydown', this._onKey);
      var vm = this;
      vm._onFullscreen = function () { vm.fullscreen = document.fullscreenElement === vm.$refs.root; };
      document.addEventListener('fullscreenchange', vm._onFullscreen);
      this._overlay = document.createElement('div');
      this._overlay.className = 'jpb-crop';
      if (!window.pdfjsLib) this.toast('PDF viewer could not be loaded (no internet access to cdnjs?). Image upload still works.', 'error');
    },
    beforeDestroy: function () {
      document.removeEventListener('mousemove', this._onMove);
      document.removeEventListener('mouseup', this._onUp);
      document.removeEventListener('keydown', this._onKey);
      document.removeEventListener('fullscreenchange', this._onFullscreen);
      if (document.fullscreenElement === this.$refs.root && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    },
    methods: {
      toast: function (msg, type) {
        var vm = this, id = uid('t');
        vm.toasts.push({ id: id, msg: msg, type: type || 'success' });
        setTimeout(function () { vm.toasts = vm.toasts.filter(function (t) { return t.id !== id; }); }, type === 'error' ? 6000 : 3200);
      },

      // ─── Step 1: PDFs ─────────────────────────────────────────────────────
      onPdfInput: function (e) { this.addPdfs(e.target.files); e.target.value = ''; },
      onPdfDrop: function (e) { this.pdfDragOver = false; this.addPdfs(e.dataTransfer.files); },
      addPdfs: function (list) {
        var vm = this;
        var files = Array.prototype.filter.call(list || [], function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); });
        if (!files.length) { vm.toast('Only PDF files can be added here.', 'error'); return; }
        files.forEach(function (f) {
          if (!vm.pdfFiles.some(function (p) { return p.name === f.name && p.size === f.size; })) {
            vm.pdfFiles.push({ file: Object.freeze({ blob: f }), name: f.name, size: f.size, status: 'pending' });
          }
        });
        if (vm.currentFileIdx === -1) vm.loadPdf(0);
      },
      removePdf: function (idx) {
        var wasCurrent = idx === this.currentFileIdx;
        this.pdfFiles.splice(idx, 1);
        if (!this.pdfFiles.length) {
          this.currentFileIdx = -1; this._pdf = null; this.numPages = 0;
          this.$refs.pages.innerHTML = '';
          this.resetCrop();
          return;
        }
        if (wasCurrent) { this.currentFileIdx = -1; this.loadPdf(Math.min(idx, this.pdfFiles.length - 1)); }
        else if (idx < this.currentFileIdx) this.currentFileIdx--;
      },
      fileBadge: function (pf, idx) {
        if (pf.status === 'done') return { cls: 'is-done', text: 'Cropped' };
        if (idx === this.currentFileIdx) return { cls: 'is-open', text: 'Open' };
        return { cls: 'is-wait', text: 'Queued' };
      },
      loadPdf: function (idx) {
        var vm = this;
        if (idx < 0 || idx >= vm.pdfFiles.length || !window.pdfjsLib) return;
        vm.currentFileIdx = idx;
        if (vm.pdfFiles[idx].status !== 'done') vm.pdfFiles[idx].status = 'active';
        vm.loadingText = 'Opening ' + vm.pdfFiles[idx].name + '…';
        vm.numPages = 0;
        vm.pdfFiles[idx].file.blob.arrayBuffer()
          .then(function (buf) { return pdfjsLib.getDocument({ data: buf }).promise; })
          .then(function (doc) {
            vm._pdf = doc;
            vm.numPages = doc.numPages;
            vm.pageNo = 1;
            return vm.renderPages();
          })
          .catch(function (err) {
            vm.toast('Could not open the PDF: ' + err.message, 'error');
            vm.loadingText = 'This PDF could not be opened.';
          });
      },
      renderPages: function () {
        var vm = this;
        if (vm.rendering || !vm._pdf) return Promise.resolve();
        vm.rendering = true;
        return vm.$nextTick().then(function () {
          var container = vm.$refs.pages;
          container.innerHTML = '';
          var scale = parseFloat(vm.scale) || 1;
          var doc = vm._pdf;
          var chain = Promise.resolve();
          for (var i = 1; i <= doc.numPages; i++) {
            (function (n) {
              chain = chain.then(function () {
                if (doc !== vm._pdf) return;
                var wrap = document.createElement('div');
                wrap.className = 'jpb-page';
                wrap.id = 'jpb-page-' + n;
                var canvas = document.createElement('canvas');
                canvas.id = 'jpb-canvas-' + n;
                wrap.appendChild(canvas);
                var label = document.createElement('div');
                label.className = 'jpb-page-label';
                label.textContent = 'Page ' + n;
                wrap.appendChild(label);
                container.appendChild(wrap);
                wrap.addEventListener('click', function () { vm.selectPage(n); });
                canvas.addEventListener('mousedown', function (e) { vm.onMouseDown(e, n, canvas); });
                return doc.getPage(n).then(function (page) {
                  var view = page.getViewport({ scale: scale });
                  var res = Math.max(window.devicePixelRatio || 1, 2);
                  var renderView = page.getViewport({ scale: scale * res });
                  canvas.width = renderView.width;
                  canvas.height = renderView.height;
                  canvas.style.maxWidth = view.width + 'px';
                  return page.render({ canvasContext: canvas.getContext('2d'), viewport: renderView }).promise;
                });
              });
            })(i);
          }
          return chain;
        }).then(function () {
          vm.resetCrop();
          vm.rendering = false;
        }, function (err) {
          vm.rendering = false;
          vm.toast('Could not draw the PDF: ' + err.message, 'error');
        });
      },
      selectPage: function (n) {
        this.pageNo = n;
        for (var i = 1; i <= this.numPages; i++) {
          var w = document.getElementById('jpb-page-' + i);
          if (w) w.classList.toggle('is-selected', i === n);
        }
      },
      goToPage: function () {
        var n = parseInt(this.pageNo, 10);
        var c = document.getElementById('jpb-canvas-' + n);
        if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
        this.selectPage(n);
      },

      // ─── Cropping ─────────────────────────────────────────────────────────
      coords: function (e, canvas) {
        var r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
      },
      onMouseDown: function (e, n, canvas) {
        if (!this._pdf || e.button !== 0) return;
        e.preventDefault();
        this._canvas = canvas;
        this.currentPage = n;
        this.selectPage(n);
        var c = this.coords(e, canvas);
        this._sel = { x0: c.x, y0: c.y, x1: c.x, y1: c.y, dragging: true };
        this.cropArea = null;
        this.infoOk = false;
        this.info = 'Cropping page ' + n + '…';
        this._overlay.style.display = 'none';
        canvas.parentNode.appendChild(this._overlay);
      },
      onMouseMove: function (e) {
        if (!this._sel || !this._sel.dragging) return;
        e.preventDefault();
        var c = this.coords(e, this._canvas);
        this._sel.x1 = c.x; this._sel.y1 = c.y;
        this.drawOverlay();
      },
      onMouseUp: function (e) {
        if (!this._sel || !this._sel.dragging) return;
        this._sel.dragging = false;
        var c = this.coords(e, this._canvas), s = this._sel;
        s.x1 = c.x; s.y1 = c.y;
        var w = Math.abs(s.x1 - s.x0), h = Math.abs(s.y1 - s.y0);
        if (w > 15 && h > 15) {
          this.drawOverlay();
          this.cropArea = { x: Math.min(s.x0, s.x1), y: Math.min(s.y0, s.y1), width: w, height: h };
          this.infoOk = true;
          this.info = 'Selected ' + Math.round(w) + ' × ' + Math.round(h) + ' px on page ' + this.currentPage + '. Press "Add crop" to keep it.';
        } else {
          this._overlay.style.display = 'none';
          this.info = 'That area is too small. Drag again.';
        }
      },
      drawOverlay: function () {
        var s = this._sel, cv = this._canvas, o = this._overlay;
        var r = cv.getBoundingClientRect(), sx = r.width / cv.width, sy = r.height / cv.height;
        o.style.left = Math.min(s.x0, s.x1) * sx + 'px';
        o.style.top = Math.min(s.y0, s.y1) * sy + 'px';
        o.style.width = Math.abs(s.x1 - s.x0) * sx + 'px';
        o.style.height = Math.abs(s.y1 - s.y0) * sy + 'px';
        o.style.display = 'block';
      },
      resetCrop: function () {
        this._sel = null; this._canvas = null; this.cropArea = null; this.currentPage = null;
        this.infoOk = false;
        this.info = 'Drag a rectangle on a page to crop it, or use "A4 page" / "Whole PDF".';
        if (this._overlay) this._overlay.style.display = 'none';
        for (var i = 1; i <= this.numPages; i++) {
          var w = document.getElementById('jpb-page-' + i);
          if (w) w.classList.remove('is-selected');
        }
      },
      mime: function () { return this.format === 'png' ? 'image/png' : this.format === 'webp' ? 'image/webp' : 'image/jpeg'; },
      capture: function (canvas, x, y, w, h, pageNo) {
        var tmp = document.createElement('canvas');
        tmp.width = Math.round(w); tmp.height = Math.round(h);
        tmp.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
        var dataURL = tmp.toDataURL(this.mime(), this.quality / 100);
        var pf = this.currentFile;
        var base = pf.name.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_\-ก-๙]/g, '_');
        var id = ++this._cropSeq;
        var item = { id: id, name: base + '_p' + pageNo + '_c' + id, dataURL: dataURL, sourceFile: pf.name, page: pageNo, width: tmp.width, height: tmp.height, format: this.format };
        this.cropItems.push(Object.freeze(item));
        this.selected.push({ id: 'g_' + id, name: item.name, dataURL: dataURL, source: 'gallery', format: this.format });
        pf.status = 'done';
        return item;
      },
      addCrop: function () {
        if (!this.cropArea || !this._canvas) return;
        var a = this.cropArea;
        var item = this.capture(this._canvas, a.x, a.y, a.width, a.height, this.currentPage);
        this.saveGallery();
        this.resetCrop();
        this.toast('Crop #' + item.id + ' added to the page order.');
      },
      cropPage: function () {
        var n = parseInt(this.pageNo, 10) || 1;
        var c = document.getElementById('jpb-canvas-' + n);
        if (!c) { this.toast('Open a PDF first.', 'error'); return; }
        this.capture(c, 0, 0, c.width, c.height, n);
        this.saveGallery();
        this.resetCrop();
        this.toast('Page ' + n + ' added as a full A4 page.');
      },
      cropAll: function () {
        var count = 0;
        for (var i = 1; i <= this.numPages; i++) {
          var c = document.getElementById('jpb-canvas-' + i);
          if (c) { this.capture(c, 0, 0, c.width, c.height, i); count++; }
        }
        if (!count) { this.toast('There are no pages to crop.', 'error'); return; }
        this.saveGallery();
        this.resetCrop();
        this.toast('All ' + count + ' pages added.');
      },

      // ─── Gallery (this browser only) ──────────────────────────────────────
      loadGallery: function () {
        var list = [];
        try { list = JSON.parse(store(GALLERY_KEY) || '[]'); } catch (e) { list = []; }
        if (!Array.isArray(list)) list = [];
        this._cropSeq = list.reduce(function (m, c) { return Math.max(m, c.id || 0); }, this._cropSeq);
        this.cropItems = list.map(Object.freeze);
      },
      saveGallery: function () {
        if (!store(GALLERY_KEY, JSON.stringify(this.cropItems))) {
          this.toast('The crop gallery is too large to keep in this browser. The new crops work now but will be gone after a reload. Delete some old crops.', 'error');
        }
      },
      isPicked: function (id) { return this.selected.some(function (s) { return s.id === id; }); },
      orderOf: function (id) {
        for (var i = 0; i < this.selected.length; i++) if (this.selected[i].id === id) return i + 1;
        return '';
      },
      togglePick: function (item) {
        var key = 'g_' + item.id;
        var idx = this.selected.findIndex(function (s) { return s.id === key; });
        if (idx >= 0) this.selected.splice(idx, 1);
        else this.selected.push({ id: key, name: item.name, dataURL: item.dataURL, source: 'gallery', format: item.format });
      },
      askDelete: function (item) { this.deleteTarget = { id: item.id, name: item.name }; },
      deleteCrop: function () {
        var id = this.deleteTarget.id;
        this.cropItems = this.cropItems.filter(function (c) { return c.id !== id; });
        this.selected = this.selected.filter(function (s) { return s.id !== 'g_' + id; });
        this.saveGallery();
        this.deleteTarget = null;
        this.toast('Crop deleted.');
      },
      clearGallery: function () {
        this.confirmClear = false;
        this.cropItems = [];
        this.selected = this.selected.filter(function (s) { return s.source !== 'gallery'; });
        this.saveGallery();
        this.toast('Crop gallery cleared.');
      },

      // ─── Uploaded images ──────────────────────────────────────────────────
      onImageInput: function (e) { this.addImages(e.target.files); e.target.value = ''; },
      onImageDrop: function (e) { this.imageDragOver = false; this.addImages(e.dataTransfer.files); },
      addImages: function (list) {
        var vm = this;
        Array.prototype.filter.call(list || [], function (f) { return /^image\//.test(f.type); }).forEach(function (f) {
          var reader = new FileReader();
          reader.onload = function (ev) {
            var item = { id: uid('u_'), name: f.name.replace(/\.[^.]+$/, ''), dataURL: ev.target.result, source: 'upload', format: (f.type.split('/')[1] || 'png') };
            vm.uploadedItems.push(item);
            vm.selected.push(item);
          };
          reader.readAsDataURL(f);
        });
      },
      removeUpload: function (id) {
        this.uploadedItems = this.uploadedItems.filter(function (i) { return i.id !== id; });
        this.selected = this.selected.filter(function (i) { return i.id !== id; });
      },

      // ─── Page order ───────────────────────────────────────────────────────
      onChipDragStart: function (e, id) { this.dragId = id; e.dataTransfer.effectAllowed = 'move'; },
      onChipDrop: function (targetId) {
        var from = this.selected.findIndex(function (i) { return i.id === this.dragId; }, this);
        var to = this.selected.findIndex(function (i) { return i.id === targetId; });
        this.dragId = null;
        if (from < 0 || to < 0 || from === to) return;
        var moved = this.selected.splice(from, 1)[0];
        this.selected.splice(to, 0, moved);
      },
      move: function (idx, delta) {
        var to = idx + delta;
        if (to < 0 || to >= this.selected.length) return;
        var moved = this.selected.splice(idx, 1)[0];
        this.selected.splice(to, 0, moved);
      },
      unpick: function (id) { this.selected = this.selected.filter(function (i) { return i.id !== id; }); },

      // ─── Step 3: publish / download ───────────────────────────────────────
      publish: function () {
        var vm = this;
        if (vm.publishBlocked || vm.publishing || !vm.canPublish) return;      // off in Reports > Settings, or not in the role
        vm.publishing = true;
        var fd = new FormData();
        fd.append('reportName', vm.form.name);
        fd.append('version', vm.form.version);
        var fields = JRPublish.fields(vm.form.pub);
        Object.keys(fields).forEach(function (k) {
          var v = fields[k];
          fd.append(k, Array.isArray(v) ? v.join(',') : v === true ? '1' : String(v == null ? '' : v));
        });
        vm.selected.forEach(function (item) {
          var blob = dataURLtoBlob(item.dataURL);
          var ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          fd.append('images', blob, item.name.replace(/\.[^.]+$/, '') + '.' + ext);
        });
        fetch(BASE + '/publish', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) {
            return r.json().catch(function () { return { error: 'The server answered ' + r.status + '.' }; })
              .then(function (d) { if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status)); return d; });
          })
          .then(function (d) {
            vm.result = d;
            var failed = (d.servers || []).filter(function (sv) { return !sv.ok; });
            if (failed.length) vm.toast('Not published to ' + failed.map(function (sv) { return sv.name; }).join(', ') + '.', 'error');
          })
          .catch(function (err) { vm.toast('Not published: ' + err.message, 'error'); })
          .then(function () { vm.publishing = false; });
      },
      startOver: function () {
        this.result = null;
        this.selected = [];
        this.uploadedItems = [];
        this.form.name = ''; this.form.version = '';
        this.savedId = null;
        this.form.pub = JRPublish.form({ servers: this.form.pub.servers, folder: this.form.pub.folder, dataSource: this.form.pub.dataSource }, this.ctx);
      },
      downloadJrxml: function () {
        if (!this.selected.length) { this.toast('Pick at least one page first.', 'error'); return; }
        var name = (this.reportNameClean || 'JasperReport_Export');
        var xml = localJrxml(this.selected, name, this.form.version);
        if (this.selected.length === 1 || !window.JSZip) {
          download(new Blob([xml], { type: 'application/xml' }), name + '.jrxml');
        } else {
          var zip = new JSZip();
          zip.file(name + '.jrxml', xml);
          this.selected.forEach(function (item, idx) {
            zip.file('images/' + item.name + '_p' + (idx + 1) + '.' + (item.format || 'jpg'), item.dataURL.split(',')[1], { base64: true });
          });
          zip.generateAsync({ type: 'blob' }).then(function (blob) { download(blob, name + '_local_pack.zip'); });
        }
        this.toast('JRXML downloaded for Jaspersoft Studio.');
      },

      // ─── Jasper Designer library (same file manager): Save / Open ───────────
      // The pages are saved as a design: one Detail band per page, opened and published from
      // Jasper Designer or Reports > Publish, or opened here again.
      openSave: function () {
        var vm = this;
        if (!vm.canSave) return;          // not in the role
        if (!vm.selected.length) { vm.toast('Pick at least one page first.', 'error'); return; }
        vm.openFiles('save');
        vm.$nextTick(function () { if (vm.$refs.fmName) vm.$refs.fmName.select(); });
      },
      openDesigns: function () { this.openFiles('open'); },
      openFiles: function (mode) {
        this.fm = { mode: mode, loading: true, designs: [], folders: [], path: this.savedPath, q: '', name: this.reportNameClean, newFolder: null, confirmDelete: null, confirmReplace: null, confirmOpen: null, opening: null, error: '' };
        this.loadFiles();
      },
      // A saved print-out back into the page order: every Detail band holds one page image.
      // Designs laid out any other way are edited in Jasper Designer.
      openDesign: function (d) {
        var vm = this, fm = vm.fm;
        if (fm.opening) return;
        if (vm.selected.length && d.id !== vm.savedId && fm.confirmOpen !== d.id) { fm.confirmOpen = d.id; fm.error = ''; return; }
        fm.opening = d.id;
        fm.error = '';
        getJson(BASE + '/designs/' + d.id)
          .then(function (row) {
            if (vm.fm !== fm) return;
            var design = row.design || {}, bands = design.bands || {}, imgs = row.images || {}, pages = [];
            var keys = Object.keys(bands).filter(function (k) { return /^detail\d*$/.test(k) && !bands[k].hidden; })
              .sort(function (a, b) { return (Number(a.slice(6)) || 1) - (Number(b.slice(6)) || 1); });
            var printout = keys.length > 0 && keys.every(function (k) {
              var els = bands[k].elements || [];
              if (!els.length) return true;
              var el = els[0];
              if (els.length !== 1 || el.type !== 'image' || el.source !== 'resource' || !imgs[el.resource]) return false;
              pages.push({ id: uid('u_'), name: el.resource.replace(/\.[^.]+$/, ''), dataURL: imgs[el.resource], source: 'upload', format: el.resource.split('.').pop() });
              return true;
            });
            if (!printout || !pages.length) throw new Error('"' + row.name + '" is not a print-out (one page image per Detail band). Open it in Jasper Designer instead.');
            var version = ((bands.pageFooter && bands.pageFooter.elements) || []).filter(function (el) { return el.type === 'staticText'; })[0];
            vm.uploadedItems = pages;
            vm.selected = pages.slice();
            vm.tab = 'upload';
            vm.form.name = row.name;
            vm.form.version = version ? version.text : '';
            vm.form.pub.folder = design.folder || '';
            vm.form.pub.dataSource = design.dataSource || '';
            vm.savedId = row.id;
            vm.savedPath = row.path || '';
            vm.result = null;
            vm.fm = null;
            vm.toast('Opened "' + (row.path ? row.path + '/' : '') + row.name + '" with ' + pages.length + ' page' + (pages.length > 1 ? 's' : '') + '.');
          })
          .catch(function (err) { if (vm.fm === fm) { fm.error = err.message; fm.confirmOpen = null; } })
          .then(function () { fm.opening = null; });
      },
      loadFiles: function () {
        var vm = this;
        return getJson(BASE + '/designs')
          .then(function (d) {
            var fm = vm.fm;
            if (!fm) return;
            fm.designs = d.designs || [];
            fm.folders = (d.folders || []).map(function (f) { return f.path; });
            if (fm.path && !vm.fmFolderExists(fm.path)) fm.path = '';
            fm.loading = false;
          })
          .catch(function (err) { vm.fm = null; vm.toast('Could not list designs: ' + err.message, 'error'); });
      },
      fmJoin: function (parent, name) { return parent ? parent + '/' + name : name; },
      // Every folder: the saved ones plus any parent a design path implies.
      fmAllFolders: function () {
        var fm = this.fm, seen = {};
        fm.folders.concat(fm.designs.map(function (d) { return d.path || ''; })).forEach(function (p) {
          var parts = p ? p.split('/') : [];
          for (var i = 1; i <= parts.length; i++) seen[parts.slice(0, i).join('/')] = true;
        });
        return Object.keys(seen);
      },
      fmFolderExists: function (path) { return !path || this.fmAllFolders().indexOf(path) >= 0; },
      fmSubfolders: function () {
        var fm = this.fm, prefix = fm.path ? fm.path + '/' : '';
        var list = this.fmAllFolders()
          .filter(function (p) { return p.indexOf(prefix) === 0 && p.length > prefix.length && p.slice(prefix.length).indexOf('/') < 0; })
          .map(function (p) {
            var inside = fm.designs.filter(function (d) { var dp = d.path || ''; return dp === p || dp.indexOf(p + '/') === 0; });
            var subs = fm.folders.some(function (f) { return f.indexOf(p + '/') === 0; });
            // Modified: the newest design inside it
            var updated = inside.reduce(function (m, d) { return String(d.updated_at || '') > m ? String(d.updated_at) : m; }, '');
            return { path: p, name: p.slice(prefix.length), count: inside.length, empty: !inside.length && !subs, updated: updated };
          });
        return this.fmSorted(list, function (f) { return f.name; }, function (f) { return f.updated; });
      },
      // Designs in the open folder, or matches in every folder while searching.
      fmDesigns: function () {
        var fm = this.fm, q = fm.q.trim().toLowerCase();
        return this.fmSorted(fm.designs
          .filter(function (d) { return q ? ((d.path ? d.path + '/' : '') + d.name).toLowerCase().indexOf(q) >= 0 : (d.path || '') === fm.path; }),
          function (d) { return d.name; }, function (d) { return d.updated_at; });
      },
      // ─── Sort (Name / Modified, ASC / DESC), as in the Jasper Designer ──
      // Picking the field again flips the direction; a new field starts A→Z, or newest first for the date.
      setFmSort: function (by) {
        var s = this.fmSort;
        this.fmSort = s.by === by ? { by: by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by: by, dir: by === 'updated' ? 'desc' : 'asc' };
        store(FM_SORT_KEY, JSON.stringify(this.fmSort));
      },
      // list in the chosen order; by date, ties (and items without one) go by name.
      fmSorted: function (list, nameOf, timeOf) {
        var by = this.fmSort.by, sign = this.fmSort.dir === 'desc' ? -1 : 1;
        var time = function (x) { return Date.parse(String(timeOf(x) || '').replace(' ', 'T')) || 0; };
        var byName = function (a, b) { return String(nameOf(a)).localeCompare(String(nameOf(b)), undefined, { numeric: true, sensitivity: 'base' }); };
        return list.slice().sort(function (a, b) {
          return by === 'updated' ? (time(a) - time(b)) * sign || byName(a, b) : byName(a, b) * sign;
        });
      },
      fmCrumbs: function () {
        var parts = this.fm.path ? this.fm.path.split('/') : [];
        return parts.map(function (name, i) { return { name: name, path: parts.slice(0, i + 1).join('/') }; });
      },
      fmGo: function (path) {
        var fm = this.fm;
        fm.path = path; fm.q = ''; fm.newFolder = null; fm.confirmDelete = null; fm.confirmReplace = null; fm.confirmOpen = null; fm.error = '';
      },
      fmPick: function (d) {
        if (this.fm.mode === 'open') return this.openDesign(d);
        if ((d.path || '') !== this.fm.path) this.fmGo(d.path || '');
        this.fm.name = d.name;
        this.fm.confirmReplace = null;
      },
      fmAskFolder: function () {
        var vm = this;
        vm.fm.newFolder = '';
        vm.fm.error = '';
        vm.$nextTick(function () { if (vm.$refs.fmFolderInput) vm.$refs.fmFolderInput.focus(); });
      },
      fmCreateFolder: function () {
        var vm = this, fm = vm.fm, name = (fm.newFolder || '').trim();
        if (!name || vm.fmBusy) return;
        vm.fmBusy = true;
        postJson(BASE + '/designs/folders', { path: vm.fmJoin(fm.path, name) })
          .then(function (d) {
            if (vm.fm !== fm) return;
            fm.folders.push(d.path);
            vm.fmGo(d.path);
            vm.toast('Folder "' + d.path + '" created.');
          })
          .catch(function (err) { if (vm.fm === fm) fm.error = err.message; })
          .then(function () { vm.fmBusy = false; });
      },
      fmDeleteFolder: function (path) {
        var vm = this, fm = vm.fm;
        postJson(BASE + '/designs/folders/delete', { path: path })
          .then(function () {
            fm.folders = fm.folders.filter(function (f) { return f !== path; });
            fm.confirmDelete = null;
            vm.toast('Folder deleted.');
          })
          .catch(function (err) { fm.confirmDelete = null; fm.error = err.message; });
      },
      fmDeleteDesign: function (id) {
        var vm = this, fm = vm.fm;
        postJson(BASE + '/designs/' + id + '/delete', {})
          .then(function () {
            fm.designs = fm.designs.filter(function (d) { return d.id !== id; });
            fm.confirmDelete = null;
            if (vm.savedId === id) vm.savedId = null;
            vm.toast('Design deleted.');
          })
          .catch(function (err) { fm.confirmDelete = null; fm.error = err.message; });
      },
      // Save into the open folder. A different design with the same name there is replaced after a second click;
      // the design last saved from this page is replaced without asking.
      fmSave: function () {
        var vm = this, fm = vm.fm, name = vm.cleanName(fm.name);
        if (!name) { fm.error = 'Enter a report name (English letters, numbers or _).'; return; }
        if (vm.saving) return;
        var here = fm.designs.filter(function (d) { return (d.path || '') === fm.path && d.name === name; });
        var same = here.filter(function (d) { return d.id !== vm.savedId; })[0];
        var mine = here.filter(function (d) { return d.id === vm.savedId; })[0];
        if (same && fm.confirmReplace !== same.id) { fm.name = name; fm.confirmReplace = same.id; return; }
        fm.error = '';
        vm.saving = true;
        var fd = new FormData();
        fd.append('reportName', name);
        fd.append('version', vm.form.version);
        fd.append('folder', vm.form.pub.folder || '');
        fd.append('dataSource', vm.form.pub.dataSource || '');
        fd.append('path', fm.path);
        fd.append('id', same ? same.id : (mine ? mine.id : ''));
        vm.selected.forEach(function (item) {
          var blob = dataURLtoBlob(item.dataURL);
          var ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
          fd.append('images', blob, item.name.replace(/\.[^.]+$/, '') + '.' + ext);
        });
        fetch(BASE + '/designs', { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(answer)
          .then(function (d) {
            vm.savedId = d.id;
            vm.savedPath = d.path || '';
            if (!vm.form.name) vm.form.name = d.name;
            vm.fm = null;
            vm.saved = d;
          })
          .catch(function (err) { if (vm.fm === fm) fm.error = err.message; else vm.toast('Not saved: ' + err.message, 'error'); })
          .then(function () { vm.saving = false; });
      },
      when: function (s) {
        if (!s) return '';
        var d = new Date(String(s).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
        return isNaN(d) ? s : d.toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      },
      fileSize: function (n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; },

      // ─── Layout and keys ──────────────────────────────────────────────────
      startResize: function (e) {
        var vm = this, startX = e.clientX, startW = vm.rightWidth;
        e.preventDefault();
        document.body.classList.add('jpb-resizing');
        function move(ev) { vm.rightWidth = Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, startW + (startX - ev.clientX))); }
        function up() {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
          document.body.classList.remove('jpb-resizing');
          store(WIDTH_KEY, String(vm.rightWidth));
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      },
      onKeyDown: function (e) {
        if (e.key !== 'Escape') return;
        if (this.fm) { if (!this.saving) this.fm = null; return; }
        if (this.saved) { this.saved = null; return; }
        if (this.result) return;
        if (this.deleteTarget) { this.deleteTarget = null; return; }
        if (this.confirmClear) { this.confirmClear = false; return; }
        var tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (this._sel || this.cropArea) { this.resetCrop(); return; }
        if (this.fullscreen && !document.fullscreenElement) this.fullscreen = false;   // window-filling fallback
      },
      // Show / hide the PDF files and Pages panels (remembered in this browser).
      toggleFiles: function () { this.filesOpen = !this.filesOpen; store(FILES_KEY, this.filesOpen ? '1' : '0'); },
      togglePages: function () { this.pagesOpen = !this.pagesOpen; store(PAGES_KEY, this.pagesOpen ? '1' : '0'); },
      // Full screen: the browser's when allowed, otherwise the page fills the window (Esc leaves both).
      toggleFullscreen: function () {
        var vm = this, el = vm.$refs.root;
        if (document.fullscreenElement) { document.exitFullscreen().catch(function () {}); return; }
        if (vm.fullscreen) { vm.fullscreen = false; return; }
        if (el && el.requestFullscreen) el.requestFullscreen().catch(function () { vm.fullscreen = true; });
        else vm.fullscreen = true;
      },
      cleanName: function (name) { return String(name || '').replace(/[^a-zA-Z0-9_\s]/g, '').trim().replace(/\s+/g, '_'); },
      sizeText: function (bytes) { return (bytes / 1024 / 1024).toFixed(1) + ' MB'; }
    }
  });
})();
