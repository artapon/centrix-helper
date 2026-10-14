// Jasper Designer page (Vue 2 options for Page.setup). Works on a design (see jrxml-design.js):
// drag elements from the palette onto bands, move/resize them on a grid, edit their properties,
// and save, import, download, publish or run the report on JasperServer.
(function () {
  'use strict';

  var JD = window.JrxmlDesign;
  var BASE = '/reports/jasper-designer';
  var DRAFT_KEY = 'jd.draft';
  var OUTLINE_KEY = 'jd.outline';
  var PROPS_KEY = 'jd.props';         // { open, x, y } of the Properties popup
  var PVSET_KEY = 'jd.pvset';        // { x, y } of the Live Preview settings popup
  var PROBS_KEY = 'jd.problems';      // { open, height } of the Problems panel under the design
  var LIVE_KEY = 'jd.live';           // { open, width } of the Live Preview pane; only width is restored (it starts closed)
  var PALETTE_KEY = 'jd.palette';     // '0' = Palette panel hidden
  var FM_SORT_KEY = 'jd.fmSort';      // { by: 'name' | 'updated', dir: 'asc' | 'desc' } of Open a design / Save
  var AUTOSAVE_KEY = 'jd.autosave';   // '1' = save to the server by itself after each change
  var AUTOSAVE_DELAY = 30000;        // ms without changes before an auto save
  // Built-in parameters and variables every report has (shown greyed in the Outline, like Jaspersoft Studio).
  var BUILTIN_PARAMS = ['REPORT_CONTEXT', 'REPORT_PARAMETERS_MAP', 'JASPER_REPORTS_CONTEXT', 'JASPER_REPORT', 'REPORT_CONNECTION', 'REPORT_MAX_COUNT',
    'REPORT_DATA_SOURCE', 'REPORT_SCRIPTLET', 'REPORT_LOCALE', 'REPORT_RESOURCE_BUNDLE', 'REPORT_TIME_ZONE', 'REPORT_FORMAT_FACTORY',
    'REPORT_CLASS_LOADER', 'REPORT_TEMPLATES', 'SORT_FIELDS', 'FILTER', 'REPORT_VIRTUALIZER', 'IS_IGNORE_PAGINATION'];
  var BUILTIN_VARS = ['PAGE_NUMBER', 'COLUMN_NUMBER', 'REPORT_COUNT', 'PAGE_COUNT', 'COLUMN_COUNT'];
  var CM = 28.3465;                       // report pixels (points) per centimetre
  var HISTORY_MAX = 100;
  var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var FONT_CSS = {
    'TH SarabunPSK': 'Sarabun, sans-serif',
    'TH Sarabun New': 'Sarabun, sans-serif',
    SansSerif: 'Arial, Helvetica, sans-serif', Serif: "'Times New Roman', serif", Monospaced: "'Courier New', monospace",
    Tahoma: 'Tahoma, sans-serif', Arial: 'Arial, sans-serif'
  };
  // TH Sarabun's glyphs are 0.67× Sarabun's (the web font shown here; advance widths and cap height
  // 476 vs 700, measured from a JasperServer PDF), and Jasper spaces its lines at ascent + descent +
  // gap = 1.13× the font size. Fonts not listed use 1 and line-height 1.15.
  var FONT_SCALE = { 'TH SarabunPSK': 0.67, 'TH Sarabun New': 0.67 };
  var FONT_LINE = { 'TH SarabunPSK': 1.13, 'TH Sarabun New': 1.13 };

  function savedFmSort() {
    var s = null;
    try { s = JSON.parse(store(FM_SORT_KEY) || 'null'); } catch (e) { s = null; }
    return { by: s && s.by === 'updated' ? 'updated' : 'name', dir: s && s.dir === 'desc' ? 'desc' : 'asc' };
  }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
      return true;
    } catch (e) { return value === undefined ? null : false; }
  }
  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  var round = function (v) { return Math.round(v); };
  var PROBS_MIN = 72;
  // Problems panel as last left: open and 150 px high the first time.
  function savedProbs() {
    var s = null;
    try { s = JSON.parse(store(PROBS_KEY) || 'null'); } catch (e) { s = null; }
    var h = s && Number(s.height);
    return { open: !s || s.open !== false, height: h >= PROBS_MIN && h <= 1200 ? Math.round(h) : 150 };
  }

  function post(url, data, asBlob) {
    var fd = new FormData();
    fd.append('payload', JSON.stringify(data));
    return fetch(url, { method: 'POST', body: fd, credentials: 'same-origin', headers: { Accept: asBlob ? 'application/pdf, application/json' : 'application/json' } })
      .then(function (r) {
        var type = r.headers.get('content-type') || '';
        if (r.ok && asBlob && type.indexOf('pdf') >= 0) return r.blob();
        return r.json().catch(function () { return { error: 'The server answered ' + r.status + '.' }; })
          .then(function (d) { if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status)); return d; });
      });
  }
  function getJson(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return { error: 'HTTP ' + r.status }; })
        .then(function (d) { if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status)); return d; });
    });
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // JRXML → design lives in jrxml-import.js.
  function importJrxml(text) { return window.JrxmlImport.parse(text); }

  // Effective border of one side of a box: its own pen, else the box pen.
  function sidePen(box, side) { return box ? (box.sides[side] || box.pen || null) : null; }

  // How an element looks at zoom z (w × h report px): the canvas and the local preview share it.
  function elementLook(el, d, z, w, h) {
    var style = { color: el.forecolor || '#000' }, look = { style: style };
    if (el.opaque && el.type !== 'line') style.background = el.backcolor;
    if (el.type === 'staticText' || el.type === 'textField') {
      var font = el.fontName || d.font.name, pt = el.fontSize || d.font.size, size = pt * (FONT_SCALE[font] || 1);
      ['top', 'right', 'bottom', 'left'].forEach(function (sd) {
        var pn = sidePen(el.box, sd);
        if (pn && pn.w > 0) style['border' + sd.charAt(0).toUpperCase() + sd.slice(1)] = Math.max(pn.w * z, 1) + 'px ' + (pn.s === 'Double' ? 'double' : pn.s.toLowerCase()) + ' ' + pn.c;
      });
      style.boxSizing = 'border-box';
      look.textStyle = {
        fontFamily: FONT_CSS[font] || font, fontSize: size * z + 'px',
        lineHeight: FONT_LINE[font] ? pt * FONT_LINE[font] * z + 'px' : null,
        fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : 'normal',
        textDecoration: [el.underline ? 'underline' : '', el.strike ? 'line-through' : ''].join(' ').trim() || 'none',
        textAlign: el.hAlign === 'Justified' ? 'justify' : el.hAlign.toLowerCase(),
        justifyContent: el.vAlign === 'Middle' ? 'center' : el.vAlign === 'Bottom' ? 'flex-end' : 'flex-start',
        padding: ['top', 'right', 'bottom', 'left'].map(function (sd) { return (el.box ? el.box.pad[sd] : 0) * z + 'px'; }).join(' ')
      };
    } else if (el.type === 'image') {
      look.imgStyle = { objectFit: el.scale === 'FillFrame' ? 'fill' : el.scale === 'RetainShape' ? 'contain' : 'none',
        objectPosition: el.hAlign.toLowerCase() + ' ' + (el.vAlign === 'Middle' ? 'center' : el.vAlign.toLowerCase()) };
    } else if (el.type === 'rectangle' || el.type === 'ellipse') {
      style.border = Math.max(el.lineWidth * z, el.lineWidth > 0 ? 1 : 0) + 'px ' + el.lineStyle.toLowerCase() + ' ' + el.lineColor;
      style.borderRadius = el.type === 'ellipse' ? '50%' : el.radius * z + 'px';
      style.boxSizing = 'border-box';
    } else if (el.type === 'line') {
      var W = Math.max(w, 1), H = Math.max(h, 1);
      look.line = h <= 1 ? { x1: 0, y1: H / 2, x2: W, y2: H / 2 } : w <= 1 ? { x1: W / 2, y1: 0, x2: W / 2, y2: H }
        : el.direction === 'BottomUp' ? { x1: 0, y1: H, x2: W, y2: 0 } : { x1: 0, y1: 0, x2: W, y2: H };
      look.dash = el.lineStyle === 'Dashed' ? '6 4' : el.lineStyle === 'Dotted' ? '1 3' : null;
    }
    return look;
  }
  // Lines of a text as the Live Preview draws it (same font, size and wrapping as elementLook /
  // .jd-text: breaks at spaces, a word wider than the box breaks between letters), in report px.
  // Used by jrxml-fill for Text adjust (CutText, ScaleFont, StretchHeight). Returns { lines, lineHeight }.
  var measureCtx = null;
  function layoutText(el, text, width, pt, reportFont) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    var font = el.fontName || reportFont || 'SansSerif', size = pt * (FONT_SCALE[font] || 1);
    measureCtx.font = (el.italic ? 'italic ' : '') + (el.bold ? '700 ' : '400 ') + size + 'px ' + (FONT_CSS[font] || font);
    var wOf = function (s) { return measureCtx.measureText(s).width; };
    var lines = [];
    String(text).split(/\r?\n/).forEach(function (para) {
      var line = '';
      para.split(/(\s+)/).forEach(function (tok) {
        if (!tok) return;
        if (wOf(line + tok) <= width || (!line && /^\s+$/.test(tok))) { line += tok; return; }
        if (/^\s+$/.test(tok)) { lines.push(line); line = ''; return; }       // the space ends the line
        if (line) { lines.push(line.replace(/\s+$/, '')); line = ''; }
        if (wOf(tok) <= width) { line = tok; return; }
        // A word wider than the box: letter by letter
        tok.split('').forEach(function (ch) {
          if (line && wOf(line + ch) > width) { lines.push(line); line = ''; }
          line += ch;
        });
      });
      lines.push(line.replace(/\s+$/, ''));
    });
    return { lines: lines, lineHeight: FONT_LINE[font] ? pt * FONT_LINE[font] : size * 1.15 };
  }

  var escHtml = function (v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  Page.setup({
    data: function () {
      var design = JD.newDesign('New_Report');
      design.font.name = 'TH SarabunPSK';
      return {
        JD: Object.freeze(JD),
        design: design,
        images: {},                 // name -> data URL (outside undo history)
        wmSrc: '',                  // the watermark image drawn for the design (also images['watermark.png'])
        currentId: null,
        currentPath: '',            // library folder of the saved design ('' = top level)
        savedJson: '',
        selection: [],              // element ids
        selectedBand: null,
        clipboard: null,
        zoom: 1, snap: true, gridSize: 10, showGrid: true,
        tab: 'design',
        drag: null,                 // move / resize / band in progress
        dropHint: null, paletteDrag: null,
        cursor: null,
        history: [], future: [],
        dialog: null,
        busy: { save: false, dialog: false, preview: false, docx: false },
        sourceEdit: false, sourceText: '', copied: false,
        previewParams: {}, previewUrl: '', previewError: '',
        // Local preview (filled in the browser); view: which result the Preview tab shows.
        pv: { source: '', locale: 'en_US', limit: 200, busy: false, error: '', result: null, zoom: 0, notesOpen: false, view: 'local', dataKey: null },
        showProblems: savedProbs().open, probsHeight: savedProbs().height,
        qd: null,                   // Dataset and Query dialog (working copy); null when closed
        cmAvailable: !!window.CodeMirror,
        layoutOpen: false, layoutScale: true, sectionsOpen: false,
        importOpen: false,          // Import menu (JRXML / Word / HTML)
        outlineOpen: store(OUTLINE_KEY) !== '0',
        fullscreen: false,
        basicOpen: false,
        fmSort: savedFmSort(),      // order of Open a design / Save (Local and JasperServer tabs)
        pvSettingsOpen: false, pvSetPos: null,  // pvSetPos: null until first opened (placed by its button)
        liveOpen: false, liveWidth: 520,  // Live Preview starts inactive; the toolbar button turns it on
        paletteOpen: store(PALETTE_KEY) !== '0',
        autoSave: store(AUTOSAVE_KEY) === '1',
        autoSavedAt: null,          // Date of the last auto save (shown next to the name)
        outlineExp: {},
        propsOpen: true, propsPos: { x: 0, y: 0 }, propsBase: null,
        // Page layouts offered in Page setup; w/h draw the paper card to scale.
        layouts: [
          { key: 'A4P', size: 'A4', orientation: 'portrait', mm: '210 × 297', w: 34, h: 48 },
          { key: 'A4L', size: 'A4', orientation: 'landscape', mm: '297 × 210', w: 48, h: 34 },
          { key: 'A5P', size: 'A5', orientation: 'portrait', mm: '148 × 210', w: 24, h: 34 },
          { key: 'A5L', size: 'A5', orientation: 'landscape', mm: '210 × 148', w: 34, h: 24 }
        ],
        // Text Field "Text Adjust" (textAdjust): what happens when the text does not fit the box.
        textAdjusts: [
          { v: 'CutText', icon: 'fas fa-cut', tip: 'CutText: keep the height and cut the text that does not fit' },
          { v: 'StretchHeight', icon: 'fas fa-arrows-alt-v', tip: 'StretchHeight: grow the box downwards to show all the text' },
          { v: 'ScaleFont', icon: 'fas fa-text-height', tip: 'ScaleFont: shrink the font so the text fits the box' }
        ],
        toasts: [],
        // Line "Direction": horizontal / vertical are a height / width of 1 (as Jasper draws them), the diagonals use direction.
        lineDirs: [
          { v: 'h', label: 'Horizontal', tip: 'Horizontal line (height 1)', xy: { x1: 2, y1: 8, x2: 14, y2: 8 } },
          { v: 'v', label: 'Vertical', tip: 'Vertical line (width 1)', xy: { x1: 8, y1: 2, x2: 8, y2: 14 } },
          { v: 'TopDown', label: 'Diagonal ╲', tip: 'From the top-left corner to the bottom-right (TopDown)', xy: { x1: 2, y1: 2, x2: 14, y2: 14 } },
          { v: 'BottomUp', label: 'Diagonal ╱', tip: 'From the bottom-left corner to the top-right (BottomUp)', xy: { x1: 2, y1: 14, x2: 14, y2: 2 } }
        ],
        handles: HANDLES,
        palette: [
          { key: 'textField', label: 'Text Field', icon: 'fas fa-i-cursor' },
          { key: 'staticText', label: 'Static Text', icon: 'fas fa-font' },
          { key: 'image', label: 'Image', icon: 'far fa-image' },
          { key: 'barcode', label: 'Barcode', icon: 'fas fa-barcode' },
          { key: 'qrcode', label: 'QR Code', icon: 'fas fa-qrcode' },
          { key: 'rectangle', label: 'Rectangle', icon: 'far fa-square' },
          { key: 'ellipse', label: 'Ellipse', icon: 'far fa-circle' },
          { key: 'line', label: 'Line', icon: 'fas fa-slash' },
          { key: 'checkbox', label: 'Checkbox', icon: 'far fa-check-square' },
          { key: 'radio', label: 'Radio', icon: 'far fa-dot-circle' },
          { key: 'table', label: 'Table', icon: 'fas fa-table' }
        ],
        composites: [
          { key: 'pageNumber', label: 'Page Number', icon: 'fas fa-hashtag' },
          { key: 'pageXofY', label: 'Page X of Y', icon: 'fas fa-copy' },
          { key: 'totalPages', label: 'Total Pages', icon: 'fas fa-calculator' },
          { key: 'currentDate', label: 'Current Date', icon: 'far fa-calendar-alt' },
          { key: 'break', label: 'Page Break', icon: 'fas fa-cut' },
          { key: 'subreport', label: 'Subreport', icon: 'fas fa-file-import' }
        ]
      };
    },
    computed: {
      pageW: function () { return this.design.page.width; },
      colW: function () { return JD.columnWidth(this.design); },
      bandLayout: function () {
        var d = this.design, top = d.page.margins.top;
        return JD.bandList(d).map(function (b) {
          var band = d.bands[b[0]], hidden = !!band.hidden;
          var item = { key: b[0], label: b[1], top: top, height: hidden ? 0 : band.height, hidden: hidden };
          top += item.height;
          return item;
        });
      },
      visibleBands: function () { return this.bandLayout.filter(function (b) { return !b.hidden; }); },
      sectionList: function () {
        var d = this.design;
        return JD.bandList(d).map(function (b) { var band = d.bands[b[0]]; return { key: b[0], label: b[1], hidden: !!band.hidden, height: band.height, count: band.elements.length, extra: JD.DETAIL_RE.test(b[0]) }; });
      },
      // Outline tree data
      outline: function () {
        var d = this.design, raw = d.raw || {};
        var names = function (list) { return (list || []).map(function (x) { var m = /\bname="([^"]+)"/.exec(x); return m ? m[1] : null; }).filter(Boolean); };
        var head = raw.head || [];
        var sections = JD.bandList(d).map(function (b) { return b[0] === 'detail' && !d.bands.detail2 ? ['detail', 'Detail'] : b; }).concat([
          ['noData', 'No Data', true], ['background', 'Background', true]
        ]).map(function (x) {
          if (x[2]) return { key: x[0], label: x[1], editable: false, active: !!raw[x[0]], count: 0, height: 0 };
          if (x[0] === 'lastPageFooter' && raw.lastPageFooter && d.bands.lastPageFooter.hidden) return { key: x[0], label: x[1], editable: false, active: true, count: 0, height: 0 };
          var band = d.bands[x[0]];
          return { key: x[0], label: x[1], editable: true, active: !band.hidden, count: band.elements.length, height: band.height };
        });
        return {
          styles: head.filter(function (x) { return /^<style\b/.test(x); }).length,
          scriptlets: head.filter(function (x) { return /^<scriptlet\b/.test(x); }).length,
          builtinParams: BUILTIN_PARAMS, builtinVars: BUILTIN_VARS,
          variables: names(raw.variables),
          sections: sections
        };
      },
      hiddenCount: function () { return this.sectionList.filter(function (x) { return x.hidden; }).length; },
      bandTop: function () {
        var map = {};
        this.bandLayout.forEach(function (b) { map[b.key] = b.top; });
        return map;
      },
      pageH: function () {
        var last = this.bandLayout[this.bandLayout.length - 1];
        return Math.max(this.design.page.height, last.top + last.height + this.design.page.margins.bottom);
      },
      rulerX: function () { return this.ruler(this.pageW); },
      rulerY: function () { return this.ruler(this.pageH); },
      renderList: function () {
        var vm = this, d = vm.design, z = vm.zoom, list = [];
        var off = vm.drag && vm.drag.mode === 'move' ? vm.drag.offset : null;
        JD.bandList(d).forEach(function (b) {
          if (d.bands[b[0]].hidden) return;
          d.bands[b[0]].elements.forEach(function (el) {
            var x = el.x, y = el.y, w = el.width, h = el.height;
            if (off && vm.isSelected(el.id)) { x += off.x; y += off.y; }
            if (vm.drag && vm.drag.mode === 'resize' && vm.drag.id === el.id) { x = vm.drag.box.x; y = vm.drag.box.y; w = vm.drag.box.w; h = vm.drag.box.h; }
            var look = elementLook(el, d, z, w, h);
            var style = Object.assign({
              left: (d.page.margins.left + x) * z + 'px', top: (vm.bandTop[b[0]] + y) * z + 'px',
              width: Math.max(w * z, 1) + 'px', height: Math.max(h * z, 1) + 'px'
            }, look.style);
            list.push({ el: el, band: b[0], style: style, textStyle: look.textStyle, imgStyle: look.imgStyle, line: look.line, dash: look.dash });
          });
        });
        return list;
      },
      pvSource: {
        get: function () { return this.pv.source || (this.design.query.trim() ? 'query' : 'empty'); },
        set: function (v) { this.pv.source = v; }
      },
      // Filled pages drawn at the preview zoom.
      liveShown: function () { return this.liveOpen && this.tab === 'design'; },
      // What the loaded rows depend on: a change reloads them (design edits only redraw).
      liveKey: function () {
        var d = this.design;
        return JSON.stringify([this.pvSource, d.language, d.query, d.params.map(function (x) { return [x.name, x.def]; }),
          d.fields.map(function (f) { return f.name; }), this.previewParams, this.pv.limit]);
      },
      pvStale: function () { return this.pvSource === 'query' && this.pv.dataKey !== null && this.pv.dataKey !== this.liveKey; },
      // 0 = fit the page to the pane's width.
      pvZoom: function () {
        if (this.pv.zoom) return this.pv.zoom;
        var res = this.pv.result, w = res && res.pages.length ? res.pages[0].width : this.pageW;
        return Math.max(0.2, Math.min(2, (this.liveWidth - 40) / Math.max(w, 1)));
      },
      pvPages: function () {
        var vm = this, res = this.pv.result, z = this.pvZoom;
        if (!res) return [];
        var d = res.design;
        // The watermark, behind each page's content (the Background band)
        var box = JD.watermarkBox(d);
        var wm = JD.hasWatermark(d) && this.wmSrc
          ? { src: this.wmSrc, style: { left: d.page.margins.left * z + 'px', top: d.page.margins.top * z + 'px', width: box.width * z + 'px', height: box.height * z + 'px' } }
          : null;
        return res.pages.map(function (pg) {
          return {
            num: pg.num, style: { width: pg.width * z + 'px', height: pg.height * z + 'px' }, wm: wm,
            items: pg.items.map(function (it, i) {
              // ScaleFont: the text field drawn with the smaller size the fill found
              var look = elementLook(it.fontSize ? Object.assign({}, it.el, { fontSize: it.fontSize }) : it.el, d, z, it.w, it.h);
              return {
                tbl: it.el.type === 'table' ? vm.tableLook(it.el, z, d, it.table || { rows: [], heights: [] }) : null,
                key: i, el: it.el, text: it.text, src: it.src, textStyle: look.textStyle, imgStyle: look.imgStyle, line: look.line, dash: look.dash,
                style: Object.assign({ left: it.x * z + 'px', top: it.y * z + 'px', width: Math.max(it.w * z, 1) + 'px', height: Math.max(it.h * z, 1) + 'px' }, look.style)
              };
            })
          };
        });
      },
      // What the watermark image depends on (see renderWatermark).
      wmKey: function () {
        var d = this.design;
        return JSON.stringify([d.watermark || null, d.page.width, d.page.height, d.page.margins]);
      },
      // The watermark over the page inside the margins (designer canvas, at its zoom).
      wmStyle: function () {
        var d = this.design, box = JD.watermarkBox(d), z = this.zoom;
        return { left: d.page.margins.left * z + 'px', top: d.page.margins.top * z + 'px', width: box.width * z + 'px', height: box.height * z + 'px' };
      },
      propsSubject: function () { return this.selection.length ? 'els:' + this.selection.join() : this.selectedBand ? 'band:' + this.selectedBand : 'report'; },
      sel: function () {
        if (this.selection.length !== 1) return null;
        var f = this.find(this.selection[0]);
        return f ? f.el : null;
      },
      // What the expression editors suggest: the report's fields, parameters and variables, then the built-in ones.
      exprCatalog: function () {
        var d = this.design, user = {};
        var vars = d.raw.variables.map(function (x) {
          var n = /name="([^"]+)"/.exec(x), c = /class="([^"]+)"/.exec(x);
          return n ? { name: n[1], cls: c ? c[1] : 'java.lang.Object' } : null;
        }).filter(Boolean);
        vars.forEach(function (v) { user[v.name] = 1; });
        d.params.forEach(function (p) { user['P' + p.name] = 1; });
        return {
          fields: d.fields,
          params: d.params.concat(BUILTIN_PARAMS.filter(function (n) { return !user['P' + n]; }).map(function (n) {
            return { name: n, cls: n === 'REPORT_MAX_COUNT' ? 'java.lang.Integer' : n === 'IS_IGNORE_PAGINATION' ? 'java.lang.Boolean' : n === 'REPORT_LOCALE' ? 'java.util.Locale' : 'java.lang.Object', builtin: true };
          })),
          vars: vars.concat(BUILTIN_VARS.filter(function (n) { return !user[n]; }).map(function (n) { return { name: n, cls: 'java.lang.Integer', builtin: true }; }))
        };
      },
      propsTitle: function () {
        if (this.sel) {
          var type = this.sel.type === 'check' ? this.sel.kind : this.sel.type;
          return (this.palette.concat(this.composites, [{ key: 'raw', label: 'Imported element' }]).filter(function (p) { return p.key === type; })[0] || {}).label;
        }
        if (this.selection.length > 1) return this.selection.length + ' elements';
        if (this.selectedBand) return this.bandName(this.selectedBand);
        return 'Report';
      },
      designJson: function () { return JSON.stringify(this.design); },
      // Reports > Settings as the shared "Publish to" panel needs it.
      ctx: function () { return { defaults: this.defaults, jasper: this.jasper, his: this.his, isAdmin: this.isAdmin }; },
      // Role actions (Administration > Roles) and Reports > Settings: what this user may do here.
      canPublish: function () { return this.directPublish !== false && !!(this.can && this.can.designer && this.can.designer.publish); },
      canDelete: function () { return !!(this.can && this.can.designer && this.can.designer.delete); },
      dialogIssue: function () {
        var dl = this.dialog;
        return dl && dl.kind === 'publish' && dl.form ? JRPublish.issue(dl.form, this.ctx) : '';
      },
      dirty: function () { return this.designJson + JSON.stringify(Object.keys(this.images)) !== this.savedJson; },
      jrxml: function () { return JD.toJrxml(this.design); },
      checked: function () { return JD.check(this.design); },
      problems: function () { return this.checked.errors; },
      warnings: function () { return this.checked.warnings; },
      // The Problems panel's rows: { t: message, l: 'error' | 'note' }, problems first.
      problemItems: function () {
        var loops = this.checked.loops || [];
        return this.problems.map(function (t) { return { t: t, l: loops.indexOf(t) >= 0 ? 'loop' : 'error' }; })
          .concat(this.warnings.map(function (t) { return { t: t, l: 'note' }; }));
      },
      cleanName: function () { return JD.sanitize({ name: this.design.name }).name; },
      layoutLabel: function () {
        var p = this.design.page;
        return p.size === 'Custom' ? 'Custom ' + p.width + '×' + p.height : p.size + ' ' + (p.orientation === 'landscape' ? 'Landscape' : 'Portrait');
      },
      hasElements: function () {
        var bands = this.design.bands;
        return JD.bandList(this.design).some(function (b) { return bands[b[0]].elements.length > 0; });
      },
      // Saved Jasper queries matching the search box.
      savedShown: function () {
        var q = this.qd;
        if (!q || !q.saved) return [];
        var t = q.savedQ.trim().toLowerCase();
        return !t ? q.saved : q.saved.filter(function (x) { return (x.name + ' ' + x.collection + ' ' + x.query).toLowerCase().indexOf(t) >= 0; });
      },
      canUndo: function () { return this.history.length > 1; },
      canRedo: function () { return this.future.length > 0; }
    },
    watch: {
      // Properties baseline for Cancel: when the popup opens, its subject changes, or another design
      // (open, undo, redo, restore) replaces this one.
      propsOpen: { handler: function () { this.takePropsBase(); }, immediate: true },
      propsSubject: function () { this.takePropsBase(); },
      design: {
        handler: function (d) {
          // Designs from before the watermark (drafts, undo history) get its defaults (off).
          if (d && !d.watermark) this.$set(d, 'watermark', JD.defaultWatermark());
          this.takePropsBase();
        },
        immediate: true
      },
      // Redraw the watermark image when it, the page size or the margins change.
      wmKey: {
        handler: function () {
          var vm = this;
          clearTimeout(vm._wmTimer);
          vm._wmTimer = setTimeout(function () { vm.renderWatermark(); }, 120);
        },
        immediate: true
      },
      designJson: function () { this.saveDraft(); this.scheduleLive(false); this.scheduleAutoSave(); },
      dirty: function () { this.scheduleAutoSave(); },
      liveKey: function () { this.scheduleLive(true); },
      'pv.locale': function () { this.scheduleLive(false); },
      'design.params': {
        deep: true,
        handler: function (list) {
          var vm = this;
          list.forEach(function (p) { if (!(p.name in vm.previewParams)) vm.$set(vm.previewParams, p.name, ''); });
        }
      }
    },
    created: function () {
      this.design.folder = '';
      this.design.dataSource = '';
      var draft = null;
      try { draft = JSON.parse(store(DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
      if (draft && draft.design) {
        this.design = JD.sanitize(draft.design);
        this.images = draft.images || {};
        this.currentId = draft.id || null;
        this.currentPath = draft.path || '';
        this.savedJson = draft.savedJson || '';
      } else {
        this.markSaved();
      }
      this.history = [JSON.stringify(this.design)];
    },
    mounted: function () {
      // An error while drawing the page stops parts of it from updating (a popup that won't move, a canvas
      // that doesn't follow): say so once, with the error, instead of failing silently.
      var page = this;
      Vue.config.errorHandler = function (err, where, info) {
        console.error('Jasper Designer:', info, err);
        if (page._errShown === err.message) return;
        page._errShown = err.message;
        try { page.toast('Something went wrong drawing the designer (' + info + '): ' + err.message + '. Reload the page (Ctrl+F5); if it stays, send this message.', 'error'); } catch (e) { /* the toast itself failed */ }
      };
      var vm = this;
      vm._onMove = function (e) { vm.onPointerMove(e); };
      vm._onUp = function (e) { vm.onPointerUp(e); };
      vm._onKey = function (e) { vm.onKeyDown(e); };
      vm._onUnload = function (e) { if (vm.dirty) { e.preventDefault(); e.returnValue = ''; } };
      document.addEventListener('pointermove', vm._onMove);
      document.addEventListener('pointerup', vm._onUp);
      document.addEventListener('keydown', vm._onKey);
      vm.initProps();
      window.addEventListener('beforeunload', vm._onUnload);
      try { var lv = JSON.parse(store(LIVE_KEY) || 'null'); if (lv) vm.liveWidth = lv.width || vm.liveWidth; } catch (e) { /* defaults */ }
      if (vm.liveOpen) vm.startLive();
      vm._onFull = function () { vm.fullscreen = document.fullscreenElement === vm.$refs.root; };
      document.addEventListener('fullscreenchange', vm._onFull);
      if (!JD) vm.toast('The designer library did not load.', 'error');
      // Reports > Publish links here with #design=<id> to open a saved design.
      var linked = /^#design=(\d+)$/.exec(location.hash);
      if (linked) {
        history.replaceState(null, '', location.pathname + location.search);
        // Already open (maybe with unsaved changes): keep it. Never replace unsaved changes.
        if (+linked[1] !== vm.currentId) {
          if (vm.dirty) vm.toast('The design open here has unsaved changes. Save it, then open the linked one from Open.', 'error');
          else vm.openDesign(+linked[1]);
        }
      }
    },
    beforeDestroy: function () {
      document.removeEventListener('pointermove', this._onMove);
      document.removeEventListener('pointerup', this._onUp);
      document.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onPropsResize);
      window.removeEventListener('beforeunload', this._onUnload);
      clearTimeout(this._autoTimer);
      document.removeEventListener('fullscreenchange', this._onFull);
      document.body.style.overflow = '';
    },
    methods: {
      toast: function (msg, type) {
        var vm = this, id = Math.random().toString(36).slice(2);
        vm.toasts.push({ id: id, msg: msg, type: type || 'success' });
        setTimeout(function () { vm.toasts = vm.toasts.filter(function (t) { return t.id !== id; }); }, type === 'error' ? 6000 : 2800);
      },
      bandName: function (key) { var b = JD.bandList(this.design).filter(function (x) { return x[0] === key; })[0]; return b ? b[1] : key; },
      ruler: function (len) {
        var z = this.zoom, ticks = [], step = CM / 4, n = Math.ceil(len / step);
        for (var i = 0; i <= n; i++) {
          var major = i % 4 === 0;
          ticks.push({ i: i, pos: i * step * z, cls: major ? 'is-major' : i % 2 === 0 ? 'is-half' : '', label: major ? i / 4 : null });
        }
        return ticks;
      },
      when: function (s) {
        if (!s) return '';
        var d = new Date(String(s).replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
        if (isNaN(d)) return s;
        var p = {};
        new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
          .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
        return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
      },
      sizeText: function (n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; },

      // ─── model helpers ──────────────────────────────────────────────────
      find: function (id) {
        var bands = this.design.bands, list = JD.bandList(this.design);
        for (var i = 0; i < list.length; i++) {
          var key = list[i][0], els = bands[key].elements;
          for (var j = 0; j < els.length; j++) if (els[j].id === id) return { el: els[j], band: key, index: j };
        }
        return null;
      },
      isSelected: function (id) { return this.selection.indexOf(id) >= 0; },
      selectedItems: function () { var vm = this; return vm.selection.map(function (id) { return vm.find(id); }).filter(Boolean); },
      snapTo: function (v, free) { var g = this.gridSize; return this.snap && !free ? Math.round(v / g) * g : Math.round(v); },
      // Which band holds a page y (report px); the last band catches anything below.
      bandAt: function (y) {
        var list = this.visibleBands.filter(function (b) { return b.height > 0; });
        for (var i = 0; i < list.length; i++) if (y < list[i].top + list[i].height) return list[i];
        return list[list.length - 1] || this.visibleBands[0] || this.bandLayout[3];
      },
      pagePoint: function (e) {
        var r = this.$refs.page.getBoundingClientRect();
        return { x: (e.clientX - r.left) / this.zoom - this.design.page.margins.left, y: (e.clientY - r.top) / this.zoom };
      },

      // ─── history ────────────────────────────────────────────────────────
      commit: function () {
        var d = this.design;
        JD.bandList(d).forEach(function (b) { d.bands[b[0]].elements.forEach(function (el) { if (el.type === 'table') JD.normalizeTable(el); }); });
        var json = JSON.stringify(this.design);
        if (this.history[this.history.length - 1] === json) return;
        this.history.push(json);
        if (this.history.length > HISTORY_MAX) this.history.shift();
        this.future = [];
      },
      undo: function () {
        if (!this.canUndo) return;
        this.future.push(this.history.pop());
        this.design = JSON.parse(this.history[this.history.length - 1]);
        this.dropMissingSelection();
      },
      redo: function () {
        if (!this.canRedo) return;
        var json = this.future.pop();
        this.history.push(json);
        this.design = JSON.parse(json);
        this.dropMissingSelection();
      },
      dropMissingSelection: function () { var vm = this; vm.selection = vm.selection.filter(function (id) { return !!vm.find(id); }); },
      resetHistory: function () { this.history = [JSON.stringify(this.design)]; this.future = []; },
      markSaved: function () { this.savedJson = JSON.stringify(this.design) + JSON.stringify(Object.keys(this.images)); },
      saveDraft: function () {
        var vm = this;
        clearTimeout(vm._draftTimer);
        vm._draftTimer = setTimeout(function () {
          store(DRAFT_KEY, JSON.stringify({ id: vm.currentId, path: vm.currentPath, design: vm.design, images: vm.images, savedJson: vm.savedJson }));
        }, 400);
      },

      // ─── palette ────────────────────────────────────────────────────────
      makeElements: function (key) {
        var d = this.design, cw = JD.columnWidth(d);
        var ref = /^(field|param|var):(.+)$/.exec(key);
        if (ref) {
          var expr = '$' + { field: 'F', param: 'P', var: 'V' }[ref[1]] + '{' + ref[2] + '}';
          return [JD.newElement('textField', { width: 120, height: 20, expression: expr })];
        }
        switch (key) {
          case 'pageNumber': return [JD.newElement('textField', { width: 100, expression: '"Page " + $V{PAGE_NUMBER}', hAlign: 'Right' })];
          case 'totalPages': return [JD.newElement('textField', { width: 100, expression: '$V{PAGE_NUMBER}', evaluationTime: 'Report' })];
          case 'currentDate': return [JD.newElement('textField', { width: 120, expression: 'new java.util.Date()', pattern: 'dd/MM/yyyy' })];
          case 'pageXofY': return [
            JD.newElement('textField', { width: 70, expression: '"Page " + $V{PAGE_NUMBER}', hAlign: 'Right' }),
            JD.newElement('textField', { x: 70, width: 50, expression: '" of " + $V{PAGE_NUMBER}', evaluationTime: 'Report' })
          ];
          case 'qrcode': return [JD.newElement('barcode', { kind: 'QRCode', width: 60, height: 60 })];
          case 'line': return [JD.newElement('line', { width: Math.min(200, cw) })];
          case 'break': return [JD.newElement('break', { width: cw })];       // what is below it in the band starts on a new page
          // Passes on every report parameter by default (e.g. patientvisituid, organisationuid), as the Centrix subreports expect.
          case 'checkbox': case 'radio': return [JD.newElement('check', { kind: key })];
          // Table: the full printable width, a column for each of the first fields (or three empty ones).
          case 'table': {
            var picks = d.fields.slice(0, 4);
            var n = picks.length || 3, each = Math.floor(cw / n);
            var cols = (picks.length ? picks : [null, null, null]).map(function (f, i) {
              var c = JD.newColumn(f ? f.name : 'Column ' + (i + 1), i === n - 1 ? cw - each * (n - 1) : each);
              if (f) c.expression = '$F{' + f.name + '}';
              return c;
            });
            return [JD.fitTable(JD.newElement('table', { columns: cols }))];
          }
          case 'subreport': return [JD.newElement('subreport', {
            width: cw, height: 100,
            params: d.params.map(function (p) { return { name: p.name, expression: '$P{' + p.name + '}' }; })
          })];
          default: return [JD.newElement(key)];
        }
      },
      onPaletteDragStart: function (e, p) {
        this.paletteDrag = p.key;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', 'jd:' + p.key);
      },
      onDragOver: function (e) {
        if (!this.paletteDrag) return;
        e.dataTransfer.dropEffect = 'copy';
        var pt = this.pagePoint(e), band = this.bandAt(pt.y), els = this.makeElements(this.paletteDrag);
        var w = 0, h = 0;
        els.forEach(function (el) { w = Math.max(w, el.x + el.width); h = Math.max(h, el.y + el.height); });
        var x = this.snapTo(pt.x, e.altKey), y = this.snapTo(pt.y - band.top, e.altKey);
        var z = this.zoom;
        this.dropHint = { band: band.key, style: { left: (this.design.page.margins.left + x) * z + 'px', top: (band.top + y) * z + 'px', width: w * z + 'px', height: Math.max(h * z, 2) + 'px' } };
      },
      onDrop: function (e) {
        var key = this.paletteDrag || String(e.dataTransfer.getData('text/plain') || '').replace(/^jd:/, '');
        this.dropHint = null;
        this.paletteDrag = null;
        if (!key) return;
        var pt = this.pagePoint(e), band = this.bandAt(pt.y);
        this.place(key, band.key, this.snapTo(pt.x, e.altKey), this.snapTo(pt.y - band.top, e.altKey));
      },
      addFromPalette: function (p) {
        var band = this.selectedBand || (this.sel ? this.find(this.sel.id).band : 'detail');
        var usable = function (k) { return this.design.bands[k] && !this.design.bands[k].hidden; }.bind(this);
        if (!usable(band) || !this.design.bands[band].height) band = usable('detail') ? 'detail' : (this.visibleBands[0] || {}).key;
        if (!band) { this.toast('Activate a section first (Sections menu).', 'error'); return; }
        this.place(p.key, band, 0, 0);
      },
      place: function (key, bandKey, x, y) {
        var vm = this, band = vm.design.bands[bandKey], cw = JD.columnWidth(vm.design);
        var els = vm.makeElements(key);
        var maxW = 0;
        els.forEach(function (el) { maxW = Math.max(maxW, el.x + el.width); });
        x = Math.max(0, Math.min(x, cw - maxW));
        y = Math.max(0, y);
        var ids = [];
        els.forEach(function (el) {
          el.x += x; el.y += y;
          // Taller than the band: the band grows to fit, as in Jaspersoft Studio.
          if (el.y + el.height > band.height) band.height = el.y + el.height;
          if (el.type === 'table') vm.tableHeaderRoom(el);          // its header goes in Column Header
          band.elements.push(el);
          ids.push(el.id);
        });
        vm.selection = ids;
        vm.selectedBand = null;
        vm.commit();
      },

      // ─── selecting, moving, resizing ────────────────────────────────────
      onPagePointerDown: function (e) {
        if (e.button !== 0) return;
        var pt = this.pagePoint(e);
        var inBand = pt.x >= 0 && pt.x <= this.colW;
        this.selection = [];
        this.selectedBand = inBand ? this.bandAt(pt.y).key : null;
      },
      onElementPointerDown: function (e, el, band) {
        if (e.button !== 0) return;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          var i = this.selection.indexOf(el.id);
          if (i >= 0) this.selection.splice(i, 1); else this.selection.push(el.id);
          return;
        }
        if (!this.isSelected(el.id)) this.selection = [el.id];
        this.selectedBand = null;
        this.drag = { mode: 'move', startX: e.clientX, startY: e.clientY, anchor: { x: el.x, y: el.y, band: band }, offset: { x: 0, y: 0 }, moved: false };
      },
      startResize: function (e, el, band, handle) {
        if (e.button !== 0) return;
        this.drag = { mode: 'resize', id: el.id, band: band, handle: handle, startX: e.clientX, startY: e.clientY,
          orig: { x: el.x, y: el.y, w: el.width, h: el.height }, box: { x: el.x, y: el.y, w: el.width, h: el.height } };
      },
      // Dragging a table's column border: the column and the one to its right share their width (the table
      // keeps its width); the right edge, or Shift: only that column changes, and the table with it.
      startColResize: function (e, el, i) {
        if (e.button !== 0) return;
        this.selection = [el.id];
        this.selectedBand = null;
        this.drag = { mode: 'col', id: el.id, col: i, startX: e.clientX, orig: el.columns.map(function (c) { return c.width; }), label: '' };
      },
      // Where a table's column borders are, in px from its left edge (for the grips).
      tableGrips: function (el) {
        var x = 0;
        return el.columns.map(function (c, i) { x += c.width; return { i: i, x: x }; });
      },
      startBandResize: function (e, key) {
        if (e.button !== 0) return;
        this.selection = [];
        this.selectedBand = key;
        this.drag = { mode: 'band', key: key, startY: e.clientY, orig: this.design.bands[key].height };
      },
      onPointerMove: function (e) {
        var g = this.drag;
        if (!g) return;
        var dx = (e.clientX - g.startX) / this.zoom, dy = (e.clientY - g.startY) / this.zoom;
        if (g.mode === 'move') {
          if (!g.moved && Math.abs(dx) < 2 / this.zoom && Math.abs(dy) < 2 / this.zoom) return;
          g.moved = true;
          // Snap the grabbed element; the others keep their distance to it.
          var nx = this.snapTo(g.anchor.x + dx, e.altKey), ny = this.snapTo(g.anchor.y + dy, e.altKey);
          g.offset = { x: nx - g.anchor.x, y: ny - g.anchor.y };
        } else if (g.mode === 'resize') {
          var o = g.orig, b = { x: o.x, y: o.y, w: o.w, h: o.h }, h = g.handle, free = e.altKey;
          if (h.indexOf('e') >= 0) b.w = Math.max(1, this.snapTo(o.x + o.w + dx, free) - o.x);
          if (h.indexOf('s') >= 0) b.h = Math.max(1, this.snapTo(o.y + o.h + dy, free) - o.y);
          if (h.indexOf('w') >= 0) { var nx2 = Math.min(this.snapTo(o.x + dx, free), o.x + o.w - 1); b.w = o.x + o.w - nx2; b.x = nx2; }
          if (h.indexOf('n') >= 0) { var ny2 = Math.min(this.snapTo(o.y + dy, free), o.y + o.h - 1); b.h = o.y + o.h - ny2; b.y = ny2; }
          g.box = b;
        } else if (g.mode === 'col') {
          var tf = this.find(g.id);
          if (!tf) return;
          var t = tf.el, o = g.orig, i = g.col, MIN = 8;
          var left = o.slice(0, i).reduce(function (s, w) { return s + w; }, 0);
          var edge = this.snapTo(left + o[i] + dx, e.altKey) - left;       // the border, snapped like other edges
          var alone = e.shiftKey || i === o.length - 1;
          var w = Math.max(MIN, Math.round(edge));
          if (!alone) w = Math.min(w, o[i] + o[i + 1] - MIN);            // the neighbour keeps at least MIN
          t.columns.forEach(function (c, k) { c.width = o[k]; });
          t.columns[i].width = w;
          if (!alone) t.columns[i + 1].width = o[i] + o[i + 1] - w;
          t.width = t.columns.reduce(function (s, c) { return s + c.width; }, 0);
          g.label = (t.columns[i].header || 'Column ' + (i + 1)) + ' ' + w + ' px' + (alone ? ' · table ' + t.width + ' px' : ' · ' + (t.columns[i + 1].header || 'Column ' + (i + 2)) + ' ' + t.columns[i + 1].width + ' px');
        } else if (g.mode === 'band') {
          var band = this.design.bands[g.key];
          var lowest = band.elements.reduce(function (m, el) { return Math.max(m, el.y + el.height); }, 0);
          band.height = Math.max(lowest, this.snapTo(g.orig + dy, e.altKey), 0);
        }
      },
      onPointerUp: function () {
        var vm = this, g = vm.drag;
        if (!g) return;
        vm.drag = null;
        if (g.mode === 'move' && g.moved) {
          vm.selectedItems().forEach(function (f) {
            var el = f.el, nx = el.x + g.offset.x, ny = el.y + g.offset.y;
            // Dropped into another band: move it there.
            var absTop = vm.bandTop[f.band] + ny;
            var target = vm.bandAt(absTop + Math.min(el.height, 4) / 2);
            if (target.key !== f.band) {
              vm.design.bands[f.band].elements.splice(vm.design.bands[f.band].elements.indexOf(el), 1);
              vm.design.bands[target.key].elements.push(el);
              ny = absTop - target.top;
            }
            el.x = round(nx); el.y = round(Math.max(0, ny));
          });
          vm.commit();
        } else if (g.mode === 'resize') {
          var f = vm.find(g.id);
          if (f) { f.el.x = g.box.x; f.el.y = Math.max(0, g.box.y); f.el.width = g.box.w; f.el.height = g.box.h; }
          vm.commit();
        } else if (g.mode === 'col') {
          vm.commit();
        } else if (g.mode === 'band') {
          vm.commit();
        }
      },
      trackCursor: function (e) {
        var pt = this.pagePoint(e);
        var b = this.bandAt(pt.y);
        this.cursor = { x: round(pt.x), y: round(pt.y - b.top), band: b.label };
      },

      // ─── edit commands ──────────────────────────────────────────────────
      removeSelected: function () {
        var vm = this;
        if (!vm.selection.length) return;
        vm.selectedItems().forEach(function (f) { var els = vm.design.bands[f.band].elements; els.splice(els.indexOf(f.el), 1); });
        vm.selection = [];
        vm.commit();
      },
      copy: function (cut) {
        var items = this.selectedItems();
        if (!items.length) return;
        this.clipboard = items.map(function (f) { return { band: f.band, el: clone(f.el) }; });
        if (cut) this.removeSelected();
        else this.toast('Copied ' + items.length + ' element' + (items.length > 1 ? 's' : '') + '.');
      },
      paste: function () {
        var vm = this;
        if (!vm.clipboard) return;
        var ids = [];
        vm.clipboard.forEach(function (c) {
          var el = clone(c.el);
          el.id = JD.uuid(); el.x += 10; el.y += 10;
          vm.design.bands[c.band].elements.push(el);
          ids.push(el.id);
        });
        vm.clipboard = vm.clipboard.map(function (c) { var n = clone(c); n.el.x += 10; n.el.y += 10; return n; });
        vm.selection = ids;
        vm.commit();
      },
      duplicate: function () { this.copy(false); this.paste(); },
      nudge: function (dx, dy) {
        this.selectedItems().forEach(function (f) { f.el.x += dx; f.el.y = Math.max(0, f.el.y + dy); });
        this.commit();
      },
      align: function (how) {
        var items = this.selectedItems();
        if (items.length < 2) return;
        var ref = items[0].el;
        items.forEach(function (f) {
          var el = f.el;
          if (how === 'left') el.x = ref.x;
          if (how === 'right') el.x = ref.x + ref.width - el.width;
          if (how === 'center') el.x = round(ref.x + ref.width / 2 - el.width / 2);
          if (how === 'top') el.y = ref.y;
          if (how === 'bottom') el.y = Math.max(0, ref.y + ref.height - el.height);
          if (how === 'width') el.width = ref.width;
          if (how === 'height') el.height = ref.height;
        });
        this.commit();
      },
      // Stacking order: an element later in its band's list prints over the ones before it (as in the JRXML).
      // where: 'front' | 'forward' (one step up) | 'backward' (one step down) | 'back'. Selected elements keep
      // their order among themselves; each band is arranged on its own.
      order: function (where) {
        var vm = this, picked = {}, changed = false;
        vm.selection.forEach(function (id) { picked[id] = true; });
        var bands = {};
        vm.selectedItems().forEach(function (f) { bands[f.band] = true; });
        Object.keys(bands).forEach(function (key) {
          var els = vm.design.bands[key].elements.slice(), before = els.map(function (el) { return el.id; }).join();
          var isPicked = function (el) { return picked[el.id]; };
          var swap = function (i, j) { var t = els[i]; els[i] = els[j]; els[j] = t; };
          if (where === 'front') els = els.filter(function (el) { return !isPicked(el); }).concat(els.filter(isPicked));
          else if (where === 'back') els = els.filter(isPicked).concat(els.filter(function (el) { return !isPicked(el); }));
          else if (where === 'forward') { for (var i = els.length - 2; i >= 0; i--) if (isPicked(els[i]) && !isPicked(els[i + 1])) swap(i, i + 1); }
          else if (where === 'backward') { for (var j = 1; j < els.length; j++) if (isPicked(els[j]) && !isPicked(els[j - 1])) swap(j, j - 1); }
          if (els.map(function (el) { return el.id; }).join() !== before) { vm.design.bands[key].elements = els; changed = true; }
        });
        if (changed) vm.commit();
      },
      // Where the selection sits in its band's stack, for the Arrange buttons: { index, count, top, bottom }
      // (index 1 = backmost). top / bottom: nothing can move further that way.
      stackInfo: function () {
        var vm = this, items = vm.selectedItems();
        var top = true, bottom = true;
        if (!items.length) return { index: 0, count: 0, top: top, bottom: bottom };
        items.forEach(function (f) {
          var els = vm.design.bands[f.band].elements, i = els.indexOf(f.el);
          if (els.slice(i + 1).some(function (el) { return !vm.isSelected(el.id); })) top = false;
          if (els.slice(0, i).some(function (el) { return !vm.isSelected(el.id); })) bottom = false;
        });
        var one = items.length === 1 ? vm.design.bands[items[0].band].elements : null;
        return { index: one ? one.indexOf(items[0].el) + 1 : 0, count: one ? one.length : 0, top: top, bottom: bottom };
      },
      // ─── line direction ─────────────────────────────────────────────────
      lineDir: function () {
        var el = this.sel;
        return el.height <= 1 ? 'h' : el.width <= 1 ? 'v' : el.direction === 'BottomUp' ? 'BottomUp' : 'TopDown';
      },
      // Turns the line, keeping its length where it can: a vertical or diagonal line stays inside its band
      // (from its y down) and the page's printable width.
      setLineDir: function (dir) {
        var el = this.sel, from = this.lineDir();
        if (dir === from) return;
        var bandH = this.design.bands[this.find(el.id).band].height;
        var roomDown = Math.max(2, bandH - el.y), roomRight = Math.max(2, JD.columnWidth(this.design) - el.x);
        var len = from === 'h' ? el.width : from === 'v' ? el.height : Math.max(el.width, el.height);
        if (dir === 'h') { el.width = Math.max(2, Math.min(len, roomRight)); el.height = 1; }
        else if (dir === 'v') { el.height = Math.max(2, Math.min(len, roomDown)); el.width = 1; }
        else {
          // From a straight line: a square box as long as the line (fitted to the band); a diagonal keeps its box.
          if (from === 'h' || from === 'v') { var side = Math.max(2, Math.min(len, roomDown, roomRight)); el.width = side; el.height = side; }
          el.direction = dir;
        }
        this.commit();
      },
      toggle: function (prop) { this.sel[prop] = !this.sel[prop]; this.commit(); },
      setProp: function (prop, value) { this.sel[prop] = value; this.commit(); },
      // ─── Properties popup ──────────────────────────────────────────────
      initProps: function () {
        var vm = this, saved = null;
        try { saved = JSON.parse(store(PROPS_KEY) || 'null'); } catch (e) { saved = null; }
        if (saved && saved.open === false) vm.propsOpen = false;
        if (saved && isFinite(saved.x) && isFinite(saved.y)) vm.propsPos = { x: saved.x, y: saved.y };
        else {
          // First time: over the right edge of the canvas, below the toolbar; placed once the page is laid out.
          var place = function () {
            var work = vm.$el.querySelector('.jd-work'), tb = vm.$el.querySelector('.jd-toolbar');
            if (!work) return;
            var rc = work.getBoundingClientRect(), top = tb ? tb.getBoundingClientRect().bottom : rc.top + 40;
            var pop = vm.$refs.propsPop, w = pop && pop.offsetWidth ? pop.offsetWidth : 660;
            vm.propsPos = { x: Math.round(rc.right - w - 28), y: Math.round(top + 12) };
            vm.clampProps();
          };
          window.addEventListener('load', place);
          setTimeout(place, 0);
        }
        vm.clampProps();
        try { var ps = JSON.parse(store(PVSET_KEY) || 'null'); if (ps && isFinite(ps.x) && isFinite(ps.y)) vm.pvSetPos = { x: ps.x, y: ps.y }; } catch (e) { /* placed on open */ }
        vm._onPropsResize = function () { vm.clampProps(); vm.clampPvSet(); };
        window.addEventListener('resize', vm._onPropsResize);
      },
      clampProps: function () {
        var w = 660, el = this.$refs.propsPop;
        if (el && el.offsetWidth) w = el.offsetWidth;
        this.propsPos = {
          x: Math.max(8, Math.min(this.propsPos.x, window.innerWidth - Math.min(w, 120) - 8)),
          y: Math.max(8, Math.min(this.propsPos.y, window.innerHeight - 208))
        };
      },
      saveProps: function () { store(PROPS_KEY, JSON.stringify({ open: this.propsOpen, x: this.propsPos.x, y: this.propsPos.y })); },
      toggleProps: function () { this.propsOpen = !this.propsOpen; if (this.propsOpen) this.clampProps(); this.saveProps(); },
      openProps: function (focus) {
        if (!this.propsOpen) { this.propsOpen = true; this.clampProps(); this.saveProps(); }
        if (focus) this.focusMainProp();
      },
      closeProps: function () { this.propsOpen = false; this.saveProps(); },

      // ─── Properties OK / Cancel ─────────────────────────────────────────
      // Edits show at once (canvas, preview). The popup keeps what its subject (the selected elements, the
      // selected band or the report settings) was when it opened or the subject changed: Cancel puts that
      // back as one undo step, OK keeps the edits. Picking another subject keeps the edits too.
      propsSnapshot: function () {
        var vm = this, d = vm.design;
        if (vm.selection.length) {
          return { kind: 'els', items: vm.selectedItems().map(function (f) { return { id: f.el.id, json: JSON.stringify(f.el) }; }) };
        }
        if (vm.selectedBand && d.bands[vm.selectedBand]) {
          var b = Object.assign({}, d.bands[vm.selectedBand]);
          delete b.elements;
          return { kind: 'band', band: vm.selectedBand, json: JSON.stringify(b) };
        }
        var r = Object.assign({}, d);
        delete r.bands;
        return { kind: 'report', json: JSON.stringify(r) };
      },
      takePropsBase: function () { this.propsBase = this.propsOpen ? this.propsSnapshot() : null; },
      propsChanged: function () {
        var base = this.propsBase;
        if (!base) return false;
        var now = this.propsSnapshot();
        if (now.kind !== base.kind) return false;
        if (base.kind !== 'els') return now.json !== base.json;
        return base.items.some(function (it) { var n = now.items.filter(function (x) { return x.id === it.id; })[0]; return n && n.json !== it.json; });
      },
      propsOk: function () { this.commit(); this.closeProps(); },
      propsCancel: function () {
        var vm = this, base = vm.propsBase, d = vm.design;
        if (base && vm.propsChanged()) {
          if (base.kind === 'els') {
            base.items.forEach(function (it) {
              var f = vm.find(it.id);
              if (!f) return;                            // deleted meanwhile: Undo brings it back
              var els = d.bands[f.band].elements;
              els.splice(els.indexOf(f.el), 1, JSON.parse(it.json));
            });
          } else {
            var old = JSON.parse(base.json), target = base.kind === 'band' ? d.bands[base.band] : d;
            if (target) Object.keys(old).forEach(function (k) { vm.$set(target, k, old[k]); });
          }
          vm.commit();
          vm.toast('Changes cancelled.');
        }
        vm.closeProps();
      },
      startPropsDrag: function (e) { this.dragPopup(e, 'propsPos', this.clampProps, this.saveProps); },
      // Moves a floating popup by its header: pos is the data key of its { x, y }.
      dragPopup: function (e, pos, clamp, save) {
        if (e.button !== 0 || e.target.closest('button, input, select')) return;
        var vm = this, head = e.currentTarget, sx = e.clientX - vm[pos].x, sy = e.clientY - vm[pos].y;
        var box = head.closest('.jd-props-pop, .jd-live-pop') || head.parentNode;
        e.preventDefault();
        try { head.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
        var move = function (ev) {
          vm[pos] = { x: ev.clientX - sx, y: ev.clientY - sy };
          clamp.call(vm);
          // Moved on the screen at once too, so it follows the pointer even while the page is busy redrawing.
          if (box && box.style) {
            box.style.left = vm[pos].x + 'px';
            box.style.top = vm[pos].y + 'px';
            box.style.maxHeight = 'calc(100vh - ' + (vm[pos].y + 8) + 'px)';
          }
        };
        var up = function () {
          head.removeEventListener('pointermove', move);
          head.removeEventListener('pointerup', up);
          head.removeEventListener('pointercancel', up);
          save.call(vm);
        };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
        head.addEventListener('pointercancel', up);
      },
      // ─── Live Preview settings popup (floating like Properties) ───────
      togglePvSettings: function (e) {
        var vm = this;
        vm.pvSettingsOpen = !vm.pvSettingsOpen;
        if (!vm.pvSettingsOpen) return;
        if (!vm.pvSetPos) {
          // First time: below the settings button, right-aligned to it.
          var r = e.currentTarget.getBoundingClientRect();
          vm.pvSetPos = { x: Math.round(r.right - 340), y: Math.round(r.bottom + 6) };
        }
        vm.$nextTick(function () { vm.clampPvSet(); });
      },
      clampPvSet: function () {
        if (!this.pvSetPos) return;
        var el = this.$refs.pvSetPop, w = el && el.offsetWidth ? el.offsetWidth : 340;
        this.pvSetPos = {
          x: Math.max(8, Math.min(this.pvSetPos.x, window.innerWidth - Math.min(w, 120) - 8)),
          y: Math.max(8, Math.min(this.pvSetPos.y, window.innerHeight - 160))
        };
      },
      savePvSet: function () { if (this.pvSetPos) store(PVSET_KEY, JSON.stringify(this.pvSetPos)); },
      startPvSetDrag: function (e) { this.dragPopup(e, 'pvSetPos', this.clampPvSet, this.savePvSet); },
      focusMainProp: function () {
        var vm = this;
        vm.$nextTick(function () { var r = vm.$refs.mainProp; if (r) (Array.isArray(r) ? r[0] : r).focus(); });
      },
      pageChanged: function () {
        var p = this.design.page;
        if (p.size !== 'Custom') {
          var wh = JD.PAGES[p.size];
          p.width = p.orientation === 'landscape' ? wh[1] : wh[0];
          p.height = p.orientation === 'landscape' ? wh[0] : wh[1];
        }
        this.commit();
      },
      // Sections: an inactive band is left out of the canvas and the JRXML; its elements and height are kept.
      // Detail bands: Detail 1, Detail 2, … are renumbered in order after adding or removing one.
      setDetailBands: function (list) {
        var vm = this, bands = vm.design.bands;
        Object.keys(bands).forEach(function (k) { if (JD.DETAIL_RE.test(k)) vm.$delete(bands, k); });
        list.forEach(function (band, i) { vm.$set(bands, i ? 'detail' + (i + 1) : 'detail', band); });
      },
      addDetailBand: function (afterKey) {
        var vm = this, d = vm.design, keys = JD.detailKeys(d);
        if (keys.length >= JD.MAX_DETAIL) { vm.toast('A report can have at most ' + JD.MAX_DETAIL + ' detail bands.', 'error'); return; }
        var list = keys.map(function (k) { return d.bands[k]; }), at = keys.indexOf(afterKey) + 1;
        list.splice(at, 0, { height: 125, elements: [], props: [], splitType: 'Stretch', printWhen: '', hidden: false });
        vm.setDetailBands(list);
        vm.selection = []; vm.selectedBand = at ? 'detail' + (at + 1) : 'detail';
        vm.commit();
        vm.toast('Added ' + vm.bandName(vm.selectedBand) + '.');
      },
      removeDetailBand: function (key) {
        var vm = this, d = vm.design, keys = JD.detailKeys(d), band = d.bands[key];
        if (!JD.DETAIL_RE.test(key)) return;
        var n = band.elements.length;
        if (n && vm._confirmDelBand !== key) {
          vm._confirmDelBand = key;
          vm.toast('Click × again to delete ' + vm.bandName(key) + ' and its ' + n + ' element' + (n > 1 ? 's' : '') + '.', 'error');
          setTimeout(function () { if (vm._confirmDelBand === key) vm._confirmDelBand = null; }, 5000);
          return;
        }
        vm._confirmDelBand = null;
        var gone = {};
        band.elements.forEach(function (el) { gone[el.id] = 1; });
        vm.selection = vm.selection.filter(function (id) { return !gone[id]; });
        vm.selectedBand = null;
        vm.setDetailBands(keys.filter(function (k) { return k !== key; }).map(function (k) { return d.bands[k]; }));
        vm.commit();
      },
      toggleSection: function (key) {
        var band = this.design.bands[key], vm = this;
        if (!band.hidden && this.visibleBands.length <= 1) { this.toast('At least one section has to stay active.', 'error'); return; }
        band.hidden = !band.hidden;
        if (band.hidden) {
          vm.selection = vm.selection.filter(function (id) { var f = vm.find(id); return f && f.band !== key; });
          if (vm.selectedBand === key) vm.selectedBand = null;
        } else if (!band.height) {
          band.height = key.indexOf('detail') === 0 ? 125 : key === 'title' ? 79 : 40;     // a shown section gets room to drop into
        }
        this.commit();
      },
      showAllSections: function () {
        var d = this.design;
        JD.bandList(d).forEach(function (b) { var band = d.bands[b[0]]; if (band.hidden) { band.hidden = false; if (!band.height) band.height = b[0].indexOf('detail') === 0 ? 125 : 40; } });
        this.commit();
      },
      // ─── Outline ──────────────────────────────────────────────────────
      // Full screen: the browser's Fullscreen API on the designer, else the designer fills the window.
      toggleFullscreen: function () {
        var vm = this, el = vm.$refs.root;
        if (document.fullscreenElement) { document.exitFullscreen(); return; }
        if (vm.fullscreen) { vm.fullscreen = false; document.body.style.overflow = ''; return; }
        if (el.requestFullscreen) {
          el.requestFullscreen().catch(function () { vm.fullscreen = true; document.body.style.overflow = 'hidden'; });
        } else { vm.fullscreen = true; document.body.style.overflow = 'hidden'; }
      },
      toggleOutline: function () { this.outlineOpen = !this.outlineOpen; store(OUTLINE_KEY, this.outlineOpen ? '1' : '0'); },
      ox: function (key) { return !!this.outlineExp[key]; },
      oxToggle: function (key) { this.$set(this.outlineExp, key, !this.outlineExp[key]); },
      oxSelectBand: function (key) { this.selection = []; this.selectedBand = key; this.tab = 'design'; },
      oxSelectEl: function (el, bandKey) {
        if (this.design.bands[bandKey].hidden) { this.toast('This section is inactive. Make it active to edit its elements.', 'error'); return; }
        this.selection = [el.id];
        this.selectedBand = null;
        this.tab = 'design';
        var vm = this;
        vm.$nextTick(function () {
          var node = vm.$el.querySelector('[data-el="' + el.id + '"]');
          if (node) node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        });
      },
      oxOpen: function (kind, index) {
        this.openQuery(kind);
        var q = this.qd;
        if (q) q.sel[kind] = index;
      },
      // ─── Table ──────────────────────────────────────────────────────────
      // Border buttons (like a spreadsheet's border menu): the lines each draws, and whether it is on now.
      tableBorderOptions: function () {
        var seg = { top: [1, 1, 15, 1], bottom: [1, 15, 15, 15], left: [1, 1, 1, 15], right: [15, 1, 15, 15], innerH: [1, 8, 15, 8], innerV: [8, 1, 8, 15] };
        var opts = [
          { key: 'all', label: 'All borders', lines: ['top', 'bottom', 'left', 'right', 'innerH', 'innerV'] },
          { key: 'inner', label: 'Inner borders', lines: ['innerH', 'innerV'] },
          { key: 'innerH', label: 'Horizontal inner borders', lines: ['innerH'] },
          { key: 'innerV', label: 'Vertical inner borders', lines: ['innerV'] },
          { key: 'outer', label: 'Outer borders', lines: ['top', 'bottom', 'left', 'right'] },
          { key: 'left', label: 'Left border', lines: ['left'], side: true },
          { key: 'top', label: 'Top border', lines: ['top'], side: true },
          { key: 'right', label: 'Right border', lines: ['right'], side: true },
          { key: 'bottom', label: 'Bottom border', lines: ['bottom'], side: true },
          { key: 'none', label: 'Clear borders', lines: [] }
        ];
        return opts.map(function (o) { return Object.assign(o, { segs: o.lines.map(function (k) { return seg[k]; }) }); });
      },
      tableBorderOn: function (el, o) {
        var b = el.borders || {};
        if (!(el.borderWidth > 0)) return o.key === 'none';
        if (o.side) return !!b[o.key];
        return JD.BORDER_KEYS.every(function (k) { return !!b[k] === (o.lines.indexOf(k) >= 0); });
      },
      setTableBorders: function (el, key) { JD.applyBorders(el, key); this.commit(); },
      // How a table is drawn (canvas; the Live Preview passes rows): a CSS grid of its cells.
      // rows: [[text, …], …] (the preview's data); without them, one row with each column's value expression,
      // or the blank rows.
      // How a table part is drawn: a CSS grid of cells at zoom z.
      // part (from the Live Preview fill): { rows: [[{ text, size }]], heights: [px], header }. Without it, on the
      // design canvas: the rows (one with each column's value expression, or the blank rows); with
      // header: true and no rows, the header row (drawn in the Column Header band).
      tableLook: function (el, z, d, part) {
        part = part || {};
        var font = el.fontName || d.font.name, pt = el.fontSize || d.font.size, scale = FONT_SCALE[font] || 1;
        var header = !!part.header, live = !!part.rows;
        var rows = part.rows || (header ? [el.columns.map(function (c) { return c.header; })]
          : el.rowSource === 'fixed' ? Array.apply(null, Array(el.rowCount)).map(function () { return el.columns.map(function () { return ''; }); })
            : [el.columns.map(function (c) { return c.expression; })]);
        var heights = part.heights || rows.map(function () { return header ? el.headerHeight : el.rowHeight; });
        var total = el.columns.reduce(function (s, c) { return s + c.width; }, 0) || 1;
        var bw = el.borderWidth > 0 ? Math.max(el.borderWidth * z, 1) : 0;
        var line = bw + 'px ' + (el.borderStyle || 'Solid').toLowerCase() + ' ' + el.borderColor;
        var base = { fontFamily: FONT_CSS[font] || font, padding: el.padding * z + 'px' };
        // The lines each cell draws (JD.tableCellSides, as in the JRXML)
        var sidesStyle = function (ci, ri) {
          var sd = JD.tableCellSides(el, header ? 'header' : 'row', ci, el.columns.length, ri, rows.length), st = {};
          ['top', 'right', 'bottom', 'left'].forEach(function (k) { st['border' + k.charAt(0).toUpperCase() + k.slice(1)] = sd[k] ? line : '0'; });
          return st;
        };
        var adjust = header ? el.headerAdjust : el.textAdjust;
        var align = function (a) { return { justifyContent: a === 'Center' ? 'center' : a === 'Right' ? 'flex-end' : 'flex-start', textAlign: a === 'Justified' ? 'justify' : a.toLowerCase() }; };
        var cells = [];
        rows.forEach(function (r, ri) {
          var bg = header ? el.headerBg : (el.altRowBg && ri % 2 === 1 ? el.altRowBg : el.rowBg);
          el.columns.forEach(function (c, ci) {
            var cell = r[ci], text = cell && typeof cell === 'object' ? cell.text : cell, size = cell && typeof cell === 'object' && cell.size ? cell.size : pt;
            cells.push({
              text: text == null ? '' : text,
              style: Object.assign({}, base, sidesStyle(ci, ri), align(header ? el.headerAlign : c.hAlign), {
                background: bg, color: header ? el.headerColor : (!live && el.rowSource === 'query' ? '#6366f1' : el.rowColor),
                fontWeight: header && el.headerBold ? 700 : 400, fontSize: size * scale * z + 'px',
                // CutText / ScaleFont: one line on the canvas; the preview has the text already cut to fit
                whiteSpace: live || adjust === 'StretchHeight' ? 'pre-wrap' : 'nowrap'
              })
            });
          });
        });
        return {
          grid: { gridTemplateColumns: el.columns.map(function (c) { return (c.width / total * 100) + '%'; }).join(' '), gridTemplateRows: heights.map(function (h) { return h * z + 'px'; }).join(' ') },
          cells: cells
        };
      },
      // Each table's header on the design canvas: in the Column Header band at headerY (moves with the table's x).
      tableHeads: function () {
        var vm = this, d = vm.design, ch = d.bands.columnHeader, z = vm.zoom, out = [];
        if (!ch || ch.hidden || vm.bandTop.columnHeader == null) return out;
        var off = vm.drag && vm.drag.mode === 'move' ? vm.drag.offset : null;
        vm.visibleBands.forEach(function (b) {
          d.bands[b.key].elements.forEach(function (el) {
            if (el.type !== 'table' || !el.headerShow) return;
            var dx = off && vm.isSelected(el.id) ? off.x : 0;
            out.push({ el: el, band: b.key, look: vm.tableLook(el, z, d, { header: true }),
              style: { left: (d.page.margins.left + el.x + dx) * z + 'px', top: (vm.bandTop.columnHeader + el.headerY) * z + 'px', width: el.width * z + 'px', height: el.headerHeight * z + 'px' } });
          });
        });
        return out;
      },
      // A new table: Column Header on and tall enough for its header, which goes at the bottom of it.
      tableHeaderRoom: function (el) {
        var ch = this.design.bands.columnHeader;
        if (!el.headerShow || !ch) return;
        if (ch.hidden) { ch.hidden = false; ch.height = 0; }
        if (ch.height < el.headerHeight) ch.height = el.headerHeight;
        el.headerY = Math.max(0, ch.height - el.headerHeight);
      },
      // After a setting that changes its size (columns, row heights, rows): the table is resized to it.
      tableChanged: function (el) {
        JD.fitTable(el);
        var ch = this.design.bands.columnHeader;
        if (el.headerShow && ch && !ch.hidden && el.headerY + el.headerHeight > ch.height) ch.height = el.headerY + el.headerHeight;
        this.commit();
      },
      tableAddColumn: function (el) {
        var last = el.columns[el.columns.length - 1];
        el.columns.push(JD.newColumn('Column ' + (el.columns.length + 1), last ? last.width : 100));
        this.tableChanged(el);
      },
      tableRemoveColumn: function (el, i) {
        if (el.columns.length <= 1) { this.toast('A table needs at least one column.', 'error'); return; }
        el.columns.splice(i, 1);
        this.tableChanged(el);
      },
      tableMoveColumn: function (el, i, by) {
        var j = i + by;
        if (j < 0 || j >= el.columns.length) return;
        var c = el.columns.splice(i, 1)[0];
        el.columns.splice(j, 0, c);
        this.commit();
      },
      // Picking a field fills the column's value (and its header, while that is still a default one).
      tableColumnField: function (c, name) {
        if (!name) return;
        c.expression = '$F{' + name + '}';
        if (!c.header || /^Column \d+$/.test(c.header)) c.header = name;
        this.commit();
      },
      tableFieldOf: function (c) { var m = /^\s*\$F\{([^}]+)\}\s*$/.exec(c.expression || ''); return m ? m[1] : ''; },
      // Spread the columns over the width from the table's left edge to the printable width, keeping their proportions.
      tableFitWidth: function (el) {
        var room = Math.max(el.columns.length, JD.columnWidth(this.design) - el.x);
        el.width = room;
        JD.normalizeTable(el);
        this.commit();
      },
      elLabel: function (el) {
        switch (el.type) {
          case 'staticText': return el.text.replace(/\s+/g, ' ').trim() || 'Static Text';
          case 'textField': return el.expression.replace(/\s+/g, ' ').trim() || 'Text Field';
          case 'image': return el.source === 'resource' ? (el.resource || 'Image') : (el.expression || 'Image');
          case 'barcode': return el.kind + (el.expression ? ' ' + el.expression : '');
          case 'rectangle': return 'Rectangle';
          case 'ellipse': return 'Ellipse';
          case 'line': return 'Line';
          case 'break': return el.breakType === 'Column' ? 'Column Break' : 'Page Break';
          case 'subreport': return 'Subreport ' + (el.expression.trim() || '(no report)');
          case 'check': return (el.kind === 'radio' ? 'Radio' : 'Checkbox') + ' · ' + (el.state === 'expression' ? (el.checkedWhen.trim() || 'expression') : el.state);
          case 'table': return 'Table · ' + el.columns.length + ' column' + (el.columns.length === 1 ? '' : 's') + (el.rowSource === 'fixed' ? ' · ' + el.rowCount + ' blank rows' : ' · rows from the query');
          default: return el.tag || el.type;
        }
      },
      elIcon: function (el) {
        return { staticText: 'fa-font', textField: 'fa-i-cursor', image: 'fa-image', barcode: el.kind === 'QRCode' || el.kind === 'DataMatrix' ? 'fa-qrcode' : 'fa-barcode', rectangle: 'fa-square', ellipse: 'fa-circle', line: 'fa-slash', break: 'fa-cut', subreport: 'fa-file-import', check: el.kind === 'radio' ? 'fa-dot-circle' : 'fa-check-square', table: 'fa-table', raw: 'fa-puzzle-piece' }[el.type] || 'fa-cube';
      },
      openLayout: function () { this.layoutScale = this.hasElements; this.layoutOpen = !this.layoutOpen; },
      // Even scale a layout would apply to the design (1 = same paper size).
      layoutRatio: function (l) {
        var p = this.design.page, wh = JD.PAGES[l.size];
        return Math.min(wh[0], wh[1]) / Math.min(p.width, p.height);
      },
      isLayout: function (l) { return this.design.page.size === l.size && this.design.page.orientation === l.orientation; },
      // Page setup: switch to A4/A5 portrait/landscape; optionally scale what is on the page to fit.
      applyLayout: function (l) {
        var d = this.design, p = d.page, m = p.margins;
        if (this.isLayout(l)) { this.layoutOpen = false; return; }
        // Scale evenly by the ratio of the paper sizes (short sides: A4 → A5 is 71%), so shapes and
        // text keep their proportions; turning the page alone does not scale anything.
        var oldShort = Math.min(p.width, p.height);
        var wh = JD.PAGES[l.size];
        p.size = l.size;
        p.orientation = l.orientation;
        p.width = l.orientation === 'landscape' ? wh[1] : wh[0];
        p.height = l.orientation === 'landscape' ? wh[0] : wh[1];
        var scaled = false;
        var k = Math.min(p.width, p.height) / oldShort;
        if (this.layoutScale && this.hasElements && Math.abs(k - 1) > 0.01) {
          var rx = k, ry = k, rf = k;
          var sc = function (v, r, min) { return Math.max(min || 0, Math.round(v * r)); };
          JD.bandList(this.design).forEach(function (b) {
            var band = d.bands[b[0]];
            band.height = sc(band.height, ry);
            band.elements.forEach(function (el) {
              el.x = sc(el.x, rx); el.width = sc(el.width, rx, 1);
              el.y = sc(el.y, ry);
              // A 1-px line stays a line; everything else scales.
              el.height = el.type === 'line' && el.height <= 1 ? el.height : sc(el.height, ry, 1);
              if ((el.type === 'staticText' || el.type === 'textField') && el.fontSize) el.fontSize = sc(el.fontSize, rf, 4);
              if (el.box) ['top', 'left', 'bottom', 'right'].forEach(function (sd) { el.box.pad[sd] = sc(el.box.pad[sd], rf); });
              if (el.type === 'rectangle') el.radius = sc(el.radius, rf);
            });
          });
          if (rf !== 1) d.font.size = Math.max(4, Math.round(d.font.size * rf));
          ['top', 'right', 'bottom', 'left'].forEach(function (side) { m[side] = sc(m[side], k); });
          scaled = true;
        }
        this.commit();
        this.layoutOpen = false;
        this.toast('Page set to ' + this.layoutLabel + (scaled ? '; the design was scaled to ' + Math.round(k * 100) + '%.' : '.') + (this.problems.length ? ' Check the problems list.' : ''));
      },
      renameDesign: function () { this.design.name = this.cleanName; this.commit(); },
      addRow: function (kind) {
        var list = this.design[kind], n = list.length + 1, base = kind === 'params' ? 'param' : 'field';
        while (list.some(function (x) { return x.name === base + n; })) n++;
        list.push(kind === 'params' ? { name: base + n, cls: 'java.lang.String', def: '' } : { name: base + n, cls: 'java.lang.String' });
        this.commit();
      },
      removeRow: function (kind, i) { this.design[kind].splice(i, 1); this.commit(); },
      setZoom: function (z) { this.zoom = Math.max(0.25, Math.min(3, Math.round(z * 100) / 100)); },
      uploadImage: function (e) {
        var vm = this, file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file || !vm.sel) return;
        if (file.size > 5 * 1024 * 1024) { vm.toast('Images must be 5 MB or smaller.', 'error'); return; }
        var target = vm.sel;
        var reader = new FileReader();
        reader.onload = function () {
          var url = String(reader.result);
          var finish = function (dataUrl, ext) {
            var base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'image';
            var name = base + '.' + ext, n = 2;
            // (watermark.png is the report watermark's own image)
            while ((vm.images[name] && vm.images[name] !== dataUrl) || name === JD.WATERMARK_IMAGE) name = base + '_' + (n++) + '.' + ext;
            vm.$set(vm.images, name, dataUrl);
            target.source = 'resource';
            target.resource = name;
            vm.commit();
          };
          var m = /^data:image\/(png|jpeg|gif);/.exec(url);
          if (m) return finish(url, m[1] === 'jpeg' ? 'jpg' : m[1]);
          // Other formats (WebP, SVG, …) become PNG, which JasperReports reads.
          var img = new Image();
          img.onload = function () {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth || 300; c.height = img.naturalHeight || 150;
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            finish(c.toDataURL('image/png'), 'png');
          };
          img.onerror = function () { vm.toast('That file is not an image the browser can read.', 'error'); };
          img.src = url;
        };
        reader.readAsDataURL(file);
      },

      // ─── keyboard ───────────────────────────────────────────────────────
      onKeyDown: function (e) {
        var tag = document.activeElement && document.activeElement.tagName;
        var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
        var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
        if (mod && k === 's') { e.preventDefault(); this.save(false); return; }
        if (this.qd && this.qd.savedOpen && e.key === 'Escape') { this.qd.savedOpen = false; return; }
        if (this.qd) { if (e.key === 'Escape' && !this.qd.busy && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('.CodeMirror'))) this.closeQuery(false); return; }
        if (this.dialog) { if (e.key === 'Escape' && !this.busy.dialog) this.dialog = null; return; }
        if (this.basicOpen) return;
        if (this.pvSettingsOpen && e.key === 'Escape') { this.pvSettingsOpen = false; return; }
        if (e.key === 'Escape' && this.fullscreen && !document.fullscreenElement && !this.selection.length) { this.toggleFullscreen(); return; }
        if (typing || this.tab !== 'design') return;
        if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
        else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
        else if (mod && k === 'c') { e.preventDefault(); this.copy(false); }
        else if (mod && k === 'x') { e.preventDefault(); this.copy(true); }
        else if (mod && k === 'v') { e.preventDefault(); this.paste(); }
        else if (mod && k === 'd') { e.preventDefault(); this.duplicate(); }
        // Ctrl+] / Ctrl+[ one step forward / backward; with Shift to the front / back (as in Office and Figma).
        else if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft') && this.selection.length) {
          e.preventDefault();
          this.order(e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 'forward') : (e.shiftKey ? 'back' : 'backward'));
        }
        else if (mod && k === 'a') {
          e.preventDefault();
          var band = this.selectedBand || (this.sel && this.find(this.sel.id).band) || 'detail';
          this.selection = this.design.bands[band].elements.map(function (el) { return el.id; });
        }
        else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.selection.length) { e.preventDefault(); this.removeSelected(); } }
        else if (e.key === 'Escape') { this.selection = []; this.selectedBand = null; }
        else if (e.key.indexOf('Arrow') === 0 && this.selection.length) {
          e.preventDefault();
          var s = e.shiftKey ? 10 : 1;
          this.nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
        }
      },

      // ─── files ──────────────────────────────────────────────────────────
      payload: function (extra) { return Object.assign({ id: this.currentId, path: this.currentPath, design: this.design, images: this.usedImages() }, extra || {}); },
      usedImages: function () {
        var vm = this, used = {};
        JD.bandList(vm.design).forEach(function (b) {
          vm.design.bands[b[0]].elements.forEach(function (el) {
            if (el.type === 'image' && el.resource && vm.images[el.resource]) used[el.resource] = vm.images[el.resource];
          });
        });
        if (JD.hasWatermark(vm.design) && vm.images[JD.WATERMARK_IMAGE]) used[JD.WATERMARK_IMAGE] = vm.images[JD.WATERMARK_IMAGE];
        return used;
      },

      // ─── Watermark ──────────────────────────────────────────────────────
      // Draws the watermark as a transparent PNG the size of the Background band (the page inside the
      // margins) at 2× for print, centred on the page. The browser's fonts draw it (Thai included).
      renderWatermark: function () {
        var vm = this, d = vm.design;
        if (!JD.hasWatermark(d)) {
          if (vm.images[JD.WATERMARK_IMAGE]) vm.$delete(vm.images, JD.WATERMARK_IMAGE);
          vm.wmSrc = '';
          return;
        }
        var w = d.watermark, box = JD.watermarkBox(d), S = 2, key = vm.wmKey;
        var font = (w.bold ? 'bold ' : '') + (w.size * S) + 'px "' + w.font.replace(/"/g, '') + '", "TH Sarabun New", Tahoma, sans-serif';
        var fontsReady = document.fonts && document.fonts.load ? document.fonts.load(font, w.text).catch(function () {}) : Promise.resolve();
        fontsReady.then(function () {
          if (key !== vm.wmKey) return;              // changed again meanwhile
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(box.width * S);
          canvas.height = Math.round(box.height * S);
          var ctx = canvas.getContext('2d');
          ctx.globalAlpha = w.opacity;
          ctx.fillStyle = w.color;
          ctx.font = font;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var lines = String(w.text).split(/\r?\n/), lineH = w.size * S * 1.15;
          var textW = Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; }).concat([1]));
          var blockH = lineH * lines.length;
          var drawAt = function (x, y) {
            lines.forEach(function (l, i) { ctx.fillText(l, x, y + (i - (lines.length - 1) / 2) * lineH); });
          };
          // Centre of the page, in the band's coordinates.
          ctx.translate((d.page.width / 2 - d.page.margins.left) * S, (d.page.height / 2 - d.page.margins.top) * S);
          ctx.rotate(w.angle * Math.PI / 180);
          if (w.tiled) {
            var stepX = textW + w.gap * S, stepY = blockH + w.gap * S;
            var reach = Math.hypot(canvas.width, canvas.height);
            var nx = Math.ceil(reach / stepX), ny = Math.ceil(reach / stepY);
            for (var j = -ny; j <= ny; j++) {
              for (var i = -nx; i <= nx; i++) drawAt(i * stepX + (j % 2 ? stepX / 2 : 0), j * stepY);   // rows offset like bricks
            }
          } else {
            drawAt(0, 0);
          }
          var url = canvas.toDataURL('image/png');
          vm.$set(vm.images, JD.WATERMARK_IMAGE, url);
          vm.wmSrc = url;
        });
      },
      // Rotation presets of the Watermark properties.
      setWatermarkAngle: function (a) { this.design.watermark.angle = a; this.commit(); },
      // Save keeps the design where it is; a design that was never saved asks for a name and folder.
      // opts (from the file manager): { path, id } — id replaces that design instead of adding one.
      // opts.auto: an auto save (no toast; the server keeps fewer versions of these).
      save: function (asNew, opts) {
        var vm = this, auto = !!(opts && opts.auto);
        if (vm.busy.save) return Promise.resolve();
        if (!asNew && !vm.currentId && !opts) { vm.askSaveAs(); return Promise.resolve(); }
        vm.busy.save = true;
        clearTimeout(vm._autoTimer);
        if (!auto) vm.design.name = vm.cleanName;   // an auto save must not change what is being typed
        vm.images = vm.usedImages();
        var extra = { path: opts && opts.path !== undefined ? opts.path : vm.currentPath };
        if (opts && opts.id) extra.id = opts.id; else if (asNew) extra.id = null;
        if (auto) extra.auto = true;
        // What is being sent counts as saved: changes made while the request runs stay unsaved.
        var sent = JSON.stringify(vm.design) + JSON.stringify(Object.keys(vm.images));
        var payload = vm.payload(extra);
        if (auto) payload.design = Object.assign({}, payload.design, { name: vm.cleanName });
        return post(BASE + '/designs', payload)
          .then(function (d) {
            vm.currentId = d.id;
            vm.currentPath = d.path || '';
            vm.savedJson = sent;
            vm.saveDraft();
            if (auto) vm.autoSavedAt = new Date();
            else { vm.autoSavedAt = null; vm.toast('Saved "' + (d.path ? d.path + '/' : '') + d.name + '".'); }
            if (vm.dialog && vm.dialog.kind === 'files') vm.dialog = null;
          })
          .catch(function (err) {
            if (vm.dialog && vm.dialog.kind === 'files') vm.dialog.error = err.message;
            else vm.toast((auto ? 'Auto save failed: ' : 'Not saved: ') + err.message, 'error');
          })
          .then(function () { vm.busy.save = false; vm.scheduleAutoSave(); });
      },

      // ─── auto save ──────────────────────────────────────────────────────
      // When on, a design that already has a place in the library is saved AUTOSAVE_DELAY after the
      // last change. A new design is saved by hand first (Save asks for its name and folder).
      scheduleAutoSave: function () {
        var vm = this;
        clearTimeout(vm._autoTimer);
        if (!vm.autoSave || !vm.currentId || !vm.dirty) return;
        vm._autoTimer = setTimeout(function () {
          if (!vm.autoSave || !vm.currentId || !vm.dirty) return;
          if (vm.busy.save || vm.dialog || vm.drag) { vm.scheduleAutoSave(); return; }
          vm.save(false, { auto: true });
        }, AUTOSAVE_DELAY);
      },
      toggleAutoSave: function () {
        this.autoSave = !this.autoSave;
        store(AUTOSAVE_KEY, this.autoSave ? '1' : '0');
        this.toast(this.autoSave
          ? (this.currentId ? 'Auto save is on: changes are saved ' + AUTOSAVE_DELAY / 1000 + ' seconds after you stop editing.' : 'Auto save is on. Save this design once to give it a name and folder.')
          : 'Auto save is off.');
        this.scheduleAutoSave();
      },
      clock: function (d) { return d ? ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) : ''; },

      // ─── versions ───────────────────────────────────────────────────────
      openVersions: function () {
        var vm = this;
        if (!vm.currentId) return;
        vm.dialog = { kind: 'versions', loading: true, list: [], keep: 3, confirm: null };
        getJson(BASE + '/designs/' + vm.currentId + '/versions')
          .then(function (d) { if (vm.dialog && vm.dialog.kind === 'versions') { vm.dialog.list = d.versions; vm.dialog.keep = d.keep; vm.dialog.loading = false; } })
          .catch(function (err) { vm.dialog = null; vm.toast('Could not list versions: ' + err.message, 'error'); });
      },
      // Loads a version into the editor as an unsaved change (Undo takes it back; Save keeps it).
      restoreVersion: function (v) {
        var vm = this;
        if (vm.dirty && vm.dialog.confirm !== v.id) { vm.dialog.confirm = v.id; return; }
        getJson(BASE + '/designs/' + vm.currentId + '/versions/' + v.id)
          .then(function (row) {
            vm.design = JD.sanitize(row.design);
            vm.images = row.images || {};
            vm.selection = []; vm.selectedBand = null;
            vm.commit();
            vm.dialog = null;
            vm.toast('Restored the version from ' + vm.when(row.savedAt) + '. Save to keep it' + (vm.autoSave ? ' (auto save will do it)' : '') + '.');
          })
          .catch(function (err) { vm.toast('Could not restore it: ' + err.message, 'error'); });
      },
      askSaveAs: function () {
        var vm = this;
        vm.openFiles('save', vm.currentId ? vm.cleanName + '_copy' : vm.cleanName);
        vm.$nextTick(function () { if (vm.$refs.dialogInput) vm.$refs.dialogInput.select(); });
      },
      askNew: function () { if (this.dirty) this.dialog = { kind: 'new' }; else this.newDesign(true); },
      newDesign: function () {
        this.design = JD.newDesign('New_Report');
        this.images = {};
        this.currentId = null;
        this.selection = []; this.selectedBand = null;
        this.markSaved();
        this.resetHistory();
        this.dialog = null;
        this.previewUrl = '';
        this.pv.result = null;
      },
      // ─── file manager (Open / Save as) ──────────────────────────────────
      openDesigns: function () { this.openFiles('open'); },
      openFiles: function (mode, name) {
        var vm = this;
        vm.dialog = {
          kind: 'files', mode: mode, loading: true, designs: [], folders: [], path: vm.currentPath, q: '',
          name: name || '', newFolder: null, confirmDelete: null, confirmReplace: null, error: '',
          // Open: 'local' (the design library) or a JasperServer id from Reports > Settings.
          source: 'local', remote: null,
          // Open: the Local design picked with a click (double-click or Open opens it), and the one waiting
          // for a second Open because the design in the editor has unsaved changes.
          selectedId: null, confirmOpen: null
        };
        vm.loadFiles();
      },

      // ─── Open a design > a JasperServer tab ─────────────────────────────
      // Browse the server's repository; opening a report unit imports its JRXML and images as a new,
      // unsaved design (Save keeps it in Local). The server reads JasperServer with the Settings login.
      fmServers: function () { return ((this.jasper && this.jasper.servers) || []).filter(function (s) { return s.configured; }); },
      fmSource: function (src) {
        var dl = this.dialog;
        if (dl.source === src) return;
        dl.source = src; dl.error = '';
        if (src !== 'local' && (!dl.remote || dl.remote.sid !== src)) {
          var sv = this.fmServers().filter(function (s) { return s.id === src; })[0];
          dl.remote = { sid: src, name: sv ? sv.name : src, url: sv ? sv.url : '', folder: '/', items: [], loading: false, error: '', q: '', found: null, confirm: null, opening: null, selected: null };
          this.remoteGo('/');
        }
      },
      remoteGo: function (folder) {
        var vm = this, rm = vm.dialog.remote;
        rm.loading = true; rm.error = ''; rm.found = null; rm.q = ''; rm.confirm = null; rm.selected = null;
        getJson(BASE + '/servers/' + encodeURIComponent(rm.sid) + '/browse?folder=' + encodeURIComponent(folder))
          .then(function (d) { if (vm.dialog && vm.dialog.remote === rm) { rm.folder = d.folder; rm.items = d.items; } })
          .catch(function (err) { rm.error = err.message; })
          .then(function () { rm.loading = false; });
      },
      remoteFind: function () {
        var vm = this, rm = vm.dialog.remote, q = rm.q.trim();
        if (!q) { rm.found = null; return; }
        rm.loading = true; rm.error = '';
        getJson(BASE + '/servers/' + encodeURIComponent(rm.sid) + '/search?q=' + encodeURIComponent(q))
          .then(function (d) { if (vm.dialog && vm.dialog.remote === rm) rm.found = d.items; })
          .catch(function (err) { rm.error = err.message; })
          .then(function () { rm.loading = false; });
      },
      remoteCrumbs: function () {
        var parts = this.dialog.remote.folder.split('/').filter(Boolean);
        return parts.map(function (name, i) { return { name: name, path: '/' + parts.slice(0, i + 1).join('/') }; });
      },
      remoteParent: function (uri) { return uri.split('/').slice(0, -1).join('/') || '/'; },
      // A click goes into a folder or picks a report; double-click or Open opens the report.
      remotePick: function (item) {
        var rm = this.dialog.remote;
        if (item.type === 'folder') { this.remoteGo(item.uri); return; }
        if (rm.selected !== item.uri) rm.confirm = null;
        rm.selected = item.uri;
      },
      openRemote: function (item) {
        var vm = this, dl = vm.dialog, rm = dl.remote;
        if (rm.opening) return;
        if (vm.dirty && rm.confirm !== item.uri) { rm.confirm = item.uri; return; }
        rm.opening = item.uri; rm.error = '';
        getJson(BASE + '/servers/' + encodeURIComponent(rm.sid) + '/unit?uri=' + encodeURIComponent(item.uri))
          .then(function (d) {
            if (vm.dialog !== dl) return;
            var r = importJrxml(d.jrxml);
            r.design.name = JD.sanitize({ name: d.name }).name;      // the report unit's name is what it publishes as
            r.design.folder = d.folder;
            if (d.dataSource) r.design.dataSource = d.dataSource;
            r.resources.filter(function (n) { return !d.images[n]; }).forEach(function (n) {
              r.warnings.unshift('Image "' + n + '" was not brought over. Upload it in the image\'s properties to see it here and to publish it.');
            });
            d.skipped.forEach(function (s) { r.warnings.push('Not brought over: ' + s + '.'); });
            vm.design = r.design;
            vm.images = d.images || {};
            vm.currentId = null; vm.currentPath = '';
            vm.selection = []; vm.selectedBand = null; vm.previewUrl = ''; vm.pv.result = null;
            vm.savedJson = '';
            vm.resetHistory();
            vm.tab = 'design';
            vm.dialog = { kind: 'import', name: d.uri, remote: d.server, count: r.count, warnings: r.warnings, copy: null };
            vm.copyToLocal(vm.localPathFor(d.server, d.folder));
          })
          .catch(function (err) { if (vm.dialog === dl) { rm.error = 'Could not open ' + item.label + ': ' + err.message; rm.confirm = null; } })
          .then(function () { rm.opening = null; });
      },
      loadFiles: function () {
        var vm = this;
        return getJson(BASE + '/designs')
          .then(function (d) {
            var dl = vm.dialog;
            if (!dl || dl.kind !== 'files') return;
            dl.designs = d.designs || [];
            dl.folders = (d.folders || []).map(function (f) { return f.path; });
            if (dl.path && !vm.fmFolderExists(dl.path)) dl.path = '';
            dl.loading = false;
          })
          .catch(function (err) { vm.dialog = null; vm.toast('Could not list designs: ' + err.message, 'error'); });
      },
      fmJoin: function (parent, name) { return parent ? parent + '/' + name : name; },
      // Every folder: the saved ones plus any parent a design path implies.
      fmAllFolders: function () {
        var dl = this.dialog, seen = {};
        dl.folders.concat(dl.designs.map(function (d) { return d.path || ''; })).forEach(function (p) {
          var parts = p ? p.split('/') : [];
          for (var i = 1; i <= parts.length; i++) seen[parts.slice(0, i).join('/')] = true;
        });
        return Object.keys(seen);
      },
      fmFolderExists: function (path) { return !path || this.fmAllFolders().indexOf(path) >= 0; },
      fmSubfolders: function () {
        var dl = this.dialog, prefix = dl.path ? dl.path + '/' : '';
        var list = this.fmAllFolders()
          .filter(function (p) { return p.indexOf(prefix) === 0 && p.length > prefix.length && p.slice(prefix.length).indexOf('/') < 0; })
          .map(function (p) {
            var inside = dl.designs.filter(function (d) { var dp = d.path || ''; return dp === p || dp.indexOf(p + '/') === 0; });
            var subs = dl.folders.some(function (f) { return f.indexOf(p + '/') === 0; });
            // Modified: the newest design inside it
            var updated = inside.reduce(function (m, d) { return String(d.updated_at || '') > m ? String(d.updated_at) : m; }, '');
            return { path: p, name: p.slice(prefix.length), count: inside.length, empty: !inside.length && !subs, updated: updated };
          });
        return this.fmSorted(list, function (f) { return f.name; }, function (f) { return f.updated; });
      },
      // Designs in the open folder, or matches in every folder while searching.
      fmDesigns: function () {
        var dl = this.dialog, q = dl.q.trim().toLowerCase();
        return this.fmSorted(dl.designs
          .filter(function (d) { return q ? ((d.path ? d.path + '/' : '') + d.name).toLowerCase().indexOf(q) >= 0 : (d.path || '') === dl.path; }),
          function (d) { return d.name; }, function (d) { return d.updated_at; });
      },
      // ─── Sort (Name / Modified, ASC / DESC) ─────────────────────────────
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
      // A JasperServer folder (or search result) in the chosen order, folders first.
      remoteShown: function () {
        var r = this.dialog.remote, list = r.found || r.items || [];
        var label = function (it) { return it.label || ''; }, when = function (it) { return it.updated; };
        return this.fmSorted(list.filter(function (it) { return it.type === 'folder'; }), label, when)
          .concat(this.fmSorted(list.filter(function (it) { return it.type !== 'folder'; }), label, when));
      },
      fmCrumbs: function () {
        var parts = this.dialog.path ? this.dialog.path.split('/') : [];
        return parts.map(function (name, i) { return { name: name, path: parts.slice(0, i + 1).join('/') }; });
      },
      fmGo: function (path) {
        var dl = this.dialog;
        dl.path = path; dl.q = ''; dl.newFolder = null; dl.confirmDelete = null; dl.confirmReplace = null; dl.error = '';
        dl.selectedId = null; dl.confirmOpen = null;
      },
      // Open: a click picks the design (double-click or Open opens it). Save: a click uses its name.
      fmPick: function (d) {
        if (this.dialog.mode === 'open') {
          if (this.dialog.selectedId !== d.id) this.dialog.confirmOpen = null;
          this.dialog.selectedId = d.id;
          return;
        }
        if ((d.path || '') !== this.dialog.path) this.fmGo(d.path || '');
        this.dialog.name = d.name;
        this.dialog.confirmReplace = null;
      },
      // Opens a Local design; with unsaved changes in the editor, only on the second try.
      fmOpenLocal: function (id) {
        var vm = this, dl = vm.dialog;
        dl.selectedId = id;
        if (vm.dirty && id !== vm.currentId && dl.confirmOpen !== id) { dl.confirmOpen = id; return; }
        vm._confirmOpen = true;          // already asked here, not with openDesign's toast
        vm.openDesign(id);
      },
      // The report the Open button opens: the picked one on the open tab.
      fmPicked: function () {
        var dl = this.dialog;
        if (!dl || dl.kind !== 'files' || dl.mode !== 'open') return null;
        if (dl.source === 'local') return dl.selectedId ? { local: dl.selectedId } : null;
        var rm = dl.remote;
        if (!rm || !rm.selected) return null;
        var it = (rm.found || rm.items).filter(function (x) { return x.uri === rm.selected; })[0];
        return it ? { remote: it } : null;
      },
      fmOpenSelected: function () {
        var p = this.fmPicked();
        if (!p) return;
        if (p.local) this.fmOpenLocal(p.local); else this.openRemote(p.remote);
      },
      // Local folder for a copy of a JasperServer report: <server name>/<its folder on JasperServer>
      // (folder names as the library allows them: no / \ < > : " | ? *, up to 60 characters, 8 levels).
      localPathFor: function (server, folder) {
        return [server].concat(String(folder || '').split('/'))
          .map(function (p) { return String(p || '').replace(/[\/\\<>:"|?*\u0000-\u001f]/g, '-').trim().slice(0, 60); })
          .filter(function (p) { return p && p !== '.' && p !== '..'; })
          .slice(0, 8).join('/');
      },
      // A report opened from JasperServer is also saved in Local (path above). Opening it again updates that
      // copy (its earlier content stays in Versions) instead of adding another one.
      copyToLocal: function (path) {
        var vm = this, dlg = vm.dialog, name = vm.cleanName;
        dlg.copy = { state: 'saving', path: path };
        return post(BASE + '/designs/folders', { path: path })
          .catch(function (err) { if (!/already exists/i.test(err.message)) throw err; })
          .then(function () { return getJson(BASE + '/designs'); })
          .then(function (list) {
            var same = (list.designs || []).filter(function (x) { return (x.path || '') === path && x.name === name; })[0];
            return vm.save(true, { path: path, id: same ? same.id : null }).then(function () { return same; });
          })
          .then(function (same) {
            dlg.copy = vm.currentId && vm.currentPath === path ? { state: 'done', path: path, name: name, updated: !!same }
              : { state: 'error', path: path, error: 'It was not saved; use Save to keep it.' };
          })
          .catch(function (err) { dlg.copy = { state: 'error', path: path, error: err.message }; });
      },
      fmAskFolder: function () {
        var vm = this;
        vm.dialog.newFolder = '';
        vm.dialog.error = '';
        vm.$nextTick(function () { if (vm.$refs.fmFolderInput) vm.$refs.fmFolderInput.focus(); });
      },
      fmCreateFolder: function () {
        var vm = this, dl = vm.dialog, name = (dl.newFolder || '').trim();
        if (!name || vm.busy.dialog) return;
        vm.busy.dialog = true;
        post(BASE + '/designs/folders', { path: vm.fmJoin(dl.path, name) })
          .then(function (d) {
            if (vm.dialog !== dl) return;
            dl.folders.push(d.path);
            vm.fmGo(d.path);
            vm.toast('Folder "' + d.path + '" created.');
          })
          .catch(function (err) { if (vm.dialog === dl) dl.error = err.message; })
          .then(function () { vm.busy.dialog = false; });
      },
      fmDeleteFolder: function (path) {
        var vm = this, dl = vm.dialog;
        post(BASE + '/designs/folders/delete', { path: path })
          .then(function () {
            dl.folders = dl.folders.filter(function (f) { return f !== path; });
            dl.confirmDelete = null;
            vm.toast('Folder deleted.');
          })
          .catch(function (err) { dl.confirmDelete = null; dl.error = err.message; });
      },
      // Save into the open folder. A different design with the same name there is replaced after a second click.
      fmSave: function () {
        var vm = this, dl = vm.dialog;
        var name = JD.sanitize({ name: dl.name }).name;
        var here = dl.designs.filter(function (d) { return (d.path || '') === dl.path && d.name === name; });
        var same = here.filter(function (d) { return d.id !== vm.currentId; })[0];
        var mine = here.filter(function (d) { return d.id === vm.currentId; })[0];
        if (same && dl.confirmReplace !== same.id) { dl.name = name; dl.confirmReplace = same.id; return; }
        dl.error = '';
        vm.design.name = name;
        vm.save(true, { path: dl.path, id: same ? same.id : (mine ? mine.id : null) });
      },
      openDesign: function (id) {
        var vm = this;
        if (vm.dirty && id !== vm.currentId && !vm._confirmOpen) {
          vm._confirmOpen = true;
          vm.toast('This design has unsaved changes. Click the design again to open it anyway.', 'error');
          setTimeout(function () { vm._confirmOpen = false; }, 5000);
          return;
        }
        vm._confirmOpen = false;
        getJson(BASE + '/designs/' + id)
          .then(function (row) {
            vm.design = JD.sanitize(row.design);
            vm.images = row.images || {};
            vm.currentId = row.id;
            vm.currentPath = row.path || '';
            vm.selection = []; vm.selectedBand = null; vm.previewUrl = ''; vm.pv.result = null;
            vm.markSaved();
            vm.resetHistory();
            vm.dialog = null;
            vm.toast('Opened "' + row.name + '".');
          })
          .catch(function (err) { vm.toast('Could not open it: ' + err.message, 'error'); });
      },
      deleteDesign: function (id) {
        var vm = this, dl = vm.dialog;
        post(BASE + '/designs/' + id + '/delete', {})
          .then(function () {
            dl.designs = dl.designs.filter(function (d) { return d.id !== id; });
            dl.confirmDelete = null;
            if (vm.currentId === id) { vm.currentId = null; vm.savedJson = ''; }
            vm.toast('Design deleted.');
          })
          .catch(function (err) { vm.toast('Not deleted: ' + err.message, 'error'); });
      },
      importFile: function (e) {
        var vm = this, file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        file.text().then(function (text) {
          var r = importJrxml(text);
          vm.design = r.design;
          vm.images = {};
          r.resources.forEach(function (n) { r.warnings.unshift('Image "' + n + '" is a JasperServer resource. Upload it in the image\'s properties to see it here and to publish it.'); });
          vm.currentId = null;
          vm.selection = []; vm.selectedBand = null; vm.previewUrl = ''; vm.pv.result = null;
          vm.savedJson = '';
          vm.resetHistory();
          vm.tab = 'design';
          vm.dialog = { kind: 'import', name: file.name, count: r.count, warnings: r.warnings };
        }).catch(function (err) { vm.toast('Could not import ' + file.name + ': ' + err.message, 'error'); });
      },
      // Word (.docx) → a new design (see docx-import.js); its pictures become the design's images.
      importDocx: function (e) {
        var vm = this, file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file || vm.busy.docx) return;
        if (!window.DocxImport) { vm.toast('The Word converter did not load. Reload the page.', 'error'); return; }
        vm.busy.docx = true;
        file.arrayBuffer()
          .then(function (buf) { return window.DocxImport.parse(buf, file.name); })
          .then(function (r) { vm.loadConverted(r, file.name, 'word'); })
          .catch(function (err) { console.error('Word import:', err); vm.toast('Could not convert ' + file.name + ': ' + err.message, 'error'); })
          .then(function () { vm.busy.docx = false; });
      },
      // A converted document (Word or HTML) replaces the design as a new, unsaved one.
      loadConverted: function (r, name, source) {
        this.design = r.design;
        this.images = r.images;
        this.currentId = null;
        this.selection = []; this.selectedBand = null; this.previewUrl = ''; this.pv.result = null;
        this.savedJson = '';
        this.resetHistory();
        this.tab = 'design';
        this.dialog = { kind: 'import', docx: true, source: source, name: name, count: r.count, images: Object.keys(r.images).length, fields: r.fields, warnings: r.warnings };
      },
      // HTML form → a new design (see html-import.js).
      askHtml: function () {
        var vm = this;
        vm.dialog = { kind: 'html', html: '', fileName: '', pageSize: 'auto', error: '' };
        vm.$nextTick(function () { if (vm.$refs.dialogInput) vm.$refs.dialogInput.focus(); });
      },
      htmlFile: function (e) {
        var vm = this, file = e.target.files && e.target.files[0], dl = vm.dialog;
        e.target.value = '';
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { dl.error = 'The file is larger than 10 MB.'; return; }
        file.text().then(function (text) { dl.html = text; dl.fileName = file.name; dl.error = ''; })
          .catch(function (err) { dl.error = 'Could not read ' + file.name + ': ' + err.message; });
      },
      importHtml: function () {
        var vm = this, dl = vm.dialog;
        if (!window.HtmlImport) { dl.error = 'The HTML converter did not load. Reload the page.'; return; }
        vm.busy.dialog = true;
        dl.error = '';
        window.HtmlImport.parse(dl.html, { fileName: dl.fileName || 'HTML_Report', pageSize: dl.pageSize })
          .then(function (r) { vm.busy.dialog = false; vm.loadConverted(r, dl.fileName || 'the pasted HTML', 'html'); })
          .catch(function (err) { console.error('HTML import:', err); vm.busy.dialog = false; if (vm.dialog === dl) dl.error = err.message; });
      },
      downloadJrxml: function () {
        var vm = this, name = vm.cleanName, xml = vm.jrxml, imgs = vm.usedImages(), names = Object.keys(imgs);
        if (!names.length || !window.JSZip) {
          download(new Blob([xml], { type: 'application/xml' }), name + '.jrxml');
          if (names.length) vm.toast('Images were left out (ZIP library not loaded).', 'error');
          return;
        }
        var zip = new JSZip();
        zip.file(name + '.jrxml', xml);
        names.forEach(function (n) { zip.file(n, imgs[n].split(',')[1], { base64: true }); });
        zip.generateAsync({ type: 'blob' }).then(function (blob) { download(blob, name + '.zip'); });
      },

      // ─── source ─────────────────────────────────────────────────────────
      // ─── borders (per side) ─────────────────────────────────────────────
      boxSideWidth: function (side) { var pn = sidePen(this.sel && this.sel.box, side); return pn ? pn.w : 0; },
      boxColor: function () { var b = this.sel && this.sel.box; var pn = b && (b.pen || b.sides.top || b.sides.left || b.sides.bottom || b.sides.right); return pn ? pn.c : '#000000'; },
      boxStyle: function () { var b = this.sel && this.sel.box; var pn = b && (b.pen || b.sides.top || b.sides.left || b.sides.bottom || b.sides.right); return pn ? pn.s : 'Solid'; },
      // ─── checkbox / radio: drawn as in its JRXML (jrxml-design.js, case 'check') ───
      checkShape: function (el) {
        var w = Math.max(el.width, 1), h = Math.max(el.height, 1), lw = el.lineWidth, ix = Math.round(w * 0.27), iy = Math.round(h * 0.27);
        return {
          view: '0 0 ' + w + ' ' + h, lw: lw, mw: Math.max(1, lw * 1.5),
          box: { x: lw / 2, y: lw / 2, width: Math.max(0, w - lw), height: Math.max(0, h - lw) },
          ring: { cx: w / 2, cy: h / 2, rx: Math.max(0, (w - lw) / 2), ry: Math.max(0, (h - lw) / 2) },
          dot: { cx: w / 2, cy: h / 2, rx: Math.max(0.5, w / 2 - ix), ry: Math.max(0.5, h / 2 - iy) },
          tick: [[0.2, 0.5], [0.4, 0.75], [0.8, 0.25]].map(function (p) { return Math.round(w * p[0]) + ',' + Math.round(h * p[1]); }).join(' ')
        };
      },
      setCheck: function (prop, v) { this.$set(this.sel, prop, v); this.commit(); },

      // ─── subreport parameters ──────────────────────────────────────────
      addSubParam: function () { this.sel.params.push({ name: '', expression: '' }); this.commit(); },
      removeSubParam: function (i) { this.sel.params.splice(i, 1); this.commit(); },
      // Every report parameter not passed yet, as $P{name}.
      addAllSubParams: function () {
        var el = this.sel, have = {};
        el.params.forEach(function (p) { have[p.name] = true; });
        this.design.params.forEach(function (p) { if (!have[p.name]) el.params.push({ name: p.name, expression: '$P{' + p.name + '}' }); });
        this.commit();
      },
      setConnection: function (v) {
        var el = this.sel, defs = { connection: '$P{REPORT_CONNECTION}', dataSource: '$P{REPORT_DATA_SOURCE}' };
        if (!el.connExpr || el.connExpr === defs[el.connection]) el.connExpr = defs[v] || el.connExpr;
        el.connection = v;
        this.commit();
      },
      setBoxSide: function (side, w) {
        var b = this.sel.box, cur = sidePen(b, side), v = Math.max(0, Number(w) || 0);
        this.$set(b.sides, side, { w: v, s: cur ? cur.s : this.boxStyle(), c: cur ? cur.c : this.boxColor() });
        this.commit();
      },
      setBoxAll: function (w) {
        var b = this.sel.box, v = Math.max(0, Number(w) || 0), c = this.boxColor(), st = this.boxStyle();
        b.pen = { w: v, s: st, c: c };
        ['top', 'left', 'bottom', 'right'].forEach(function (sd) { b.sides[sd] = null; });
        this.commit();
      },
      setBoxLook: function (prop, v) {
        var b = this.sel.box;
        if (b.pen) b.pen[prop] = v;
        ['top', 'left', 'bottom', 'right'].forEach(function (sd) { if (b.sides[sd]) b.sides[sd][prop] = v; });
        if (!b.pen && !['top', 'left', 'bottom', 'right'].some(function (sd) { return b.sides[sd]; })) b.pen = { w: 0, s: prop === 's' ? v : 'Solid', c: prop === 'c' ? v : '#000000' };
        this.commit();
      },
      setPadAll: function (v) {
        var b = this.sel.box, n = Math.max(0, parseInt(v, 10) || 0);
        ['top', 'left', 'bottom', 'right'].forEach(function (sd) { b.pad[sd] = n; });
        this.commit();
      },
      setAttr: function (key, v) {
        if (v) this.$set(this.design.attrs, key, v); else this.$delete(this.design.attrs, key);
        this.commit();
      },

      // ─── Dataset and Query dialog ───────────────────────────────────────
      openQuery: function (tab) {
        var d = this.design, vm = this;
        var values = {};
        d.params.forEach(function (p) { values[p.name] = vm.previewParams[p.name] || ''; });
        vm.qd = {
          language: 'MongoDbQuery', query: d.query,
          fields: clone(d.fields), params: clone(d.params), sortFields: clone(d.sortFields), filterExpression: d.filterExpression,
          tab: tab || 'fields', sel: { fields: -1, params: -1, sortFields: -1 }, values: values,
          busy: '', error: '', info: '', preview: null, limit: 20, filter: '',
          savedOpen: false, saved: null, savedQ: '', savedLoading: false, savedErr: '', confirmDel: null
        };
        vm.$nextTick(function () { vm.initQueryEditor(); });
      },
      initQueryEditor: function () {
        var vm = this, host = vm.$refs.qdEditor;
        vm._qcm = null;
        if (!host || !window.CodeMirror) return;
        vm._qcm = CodeMirror(host, {
          value: vm.qd.query, mode: { name: 'javascript', json: false }, lineNumbers: true, matchBrackets: true,
          autoCloseBrackets: true, tabSize: 2, indentUnit: 2, lineWrapping: false
        });
        vm._qcm.on('change', function (cm) { if (vm.qd) vm.qd.query = cm.getValue(); });
        vm._qcm.setOption('extraKeys', { 'Shift-Alt-F': function () { vm.formatQuery(); } });
        setTimeout(function () { if (vm._qcm) vm._qcm.refresh(); }, 50);
      },
      toggleSavedQueries: function () {
        var vm = this, q = vm.qd;
        q.savedOpen = !q.savedOpen;
        q.confirmDel = null;
        if (!q.savedOpen) return;
        vm.$nextTick(function () { if (vm.$refs.savedSearch) vm.$refs.savedSearch.focus(); });
        q.savedLoading = true; q.savedErr = '';
        getJson(BASE + '/saved-queries')
          .then(function (d) { if (vm.qd === q) q.saved = d.queries; })
          .catch(function (err) { if (vm.qd === q) q.savedErr = err.message; })
          .then(function () { if (vm.qd === q) q.savedLoading = false; });
      },
      // Loads a saved Jasper query into the editor; its parameters are added when the report lacks them.
      loadSavedQuery: function (sq) {
        var q = this.qd;
        if (!q) return;
        q.query = sq.query;
        if (this._qcm) this._qcm.setValue(sq.query);
        var added = [];
        ((sq.meta && sq.meta.params) || []).forEach(function (pm) {
          if (!pm || !JD.NAME_RE.test(pm.name) || q.params.some(function (x) { return x.name === pm.name; })) return;
          q.params.push({ name: pm.name, cls: pm.cls || 'java.lang.String', def: pm.def || '', desc: '', prompt: true, props: [] });
          added.push(pm.name);
        });
        q.savedOpen = false;
        q.error = '';
        q.info = 'Loaded "' + sq.name + '".' + (added.length ? ' Added parameter' + (added.length > 1 ? 's' : '') + ': ' + added.join(', ') + '.' : '') + ' Use Read Fields to get its fields.';
      },
      deleteSavedQuery: function (sq) {
        var vm = this, q = vm.qd;
        post(BASE + '/saved-queries/' + sq.id + '/delete', {})
          .then(function () { if (vm.qd === q) { q.saved = q.saved.filter(function (x) { return x.id !== sq.id; }); q.confirmDel = null; } })
          .catch(function (err) { if (vm.qd === q) q.savedErr = err.message; });
      },
      formatQuery: function () {
        var q = this.qd;
        if (!q || !window.QueryFormat) return;
        try {
          var text = window.QueryFormat.format(q.query);
          q.error = '';
          if (text === q.query) { q.info = 'The query is already formatted.'; return; }
          q.query = text;
          if (this._qcm) this._qcm.setValue(text);
          q.info = 'Query formatted.';
        } catch (err) {
          q.error = 'Could not format the query: ' + err.message;
        }
      },
      closeQuery: function (apply) {
        var vm = this, q = vm.qd;
        if (apply && q) {
          var bad = q.fields.concat(q.params).filter(function (x) { return !JD.NAME_RE.test(x.name); });
          if (bad.length) { q.error = 'These names are not valid: ' + bad.map(function (x) { return x.name || '(empty)'; }).join(', '); q.tab = q.fields.indexOf(bad[0]) >= 0 ? 'fields' : 'params'; return; }
          vm.design.language = 'MongoDbQuery';
          vm.design.query = q.query;
          vm.design.fields = q.fields;
          vm.design.params = q.params;
          vm.design.sortFields = q.sortFields.filter(function (x) { return x.name; });
          vm.design.filterExpression = q.filterExpression;
          q.params.forEach(function (p) { vm.$set(vm.previewParams, p.name, q.values[p.name] || ''); });
          vm.commit();
          vm.toast('Dataset updated: ' + q.fields.length + ' fields, ' + q.params.length + ' parameters.');
        }
        vm._qcm = null;
        vm.qd = null;
      },
      qRows: function (kind) { return this.qd ? this.qd[kind] : []; },
      qAdd: function (kind) {
        var q = this.qd, list = q[kind], n = list.length + 1;
        var base = kind === 'params' ? 'param' : 'field';
        if (kind === 'sortFields') list.push({ name: (q.fields[0] || {}).name || '', order: 'Ascending', type: 'Field' });
        else {
          while (list.some(function (x) { return x.name === base + n; })) n++;
          list.push(kind === 'params' ? { name: base + n, cls: 'java.lang.String', def: '', desc: '', prompt: true, props: [] } : { name: base + n, cls: 'java.lang.String', desc: '', props: [] });
        }
        q.sel[kind] = list.length - 1;
      },
      qRemove: function (kind) {
        var q = this.qd, i = q.sel[kind];
        if (i < 0 || i >= q[kind].length) return;
        q[kind].splice(i, 1);
        q.sel[kind] = Math.min(i, q[kind].length - 1);
      },
      qMove: function (kind, delta) {
        var q = this.qd, i = q.sel[kind], j = i + delta, list = q[kind];
        if (i < 0 || j < 0 || j >= list.length) return;
        var item = list.splice(i, 1)[0];
        list.splice(j, 0, item);
        q.sel[kind] = j;
      },
      qPayload: function (mode) {
        var q = this.qd;
        return { mode: mode, language: q.language, query: q.query, params: q.params.map(function (p) { return { name: p.name, def: p.def }; }), values: q.values,
          fields: mode === 'preview' ? q.fields.map(function (f) { return f.name; }) : undefined, limit: mode === 'preview' ? q.limit : 100 };
      },
      readFields: function () {
        var vm = this, q = vm.qd;
        q.busy = 'fields'; q.error = ''; q.info = '';
        post(BASE + '/query', vm.qPayload('fields'))
          .then(function (d) {
            if (!vm.qd) return;
            var old = {};
            q.fields.forEach(function (f) { old[f.name] = f; });
            q.fields = d.fields.map(function (f) { var o = old[f.name]; return { name: f.name, cls: f.cls, desc: o ? o.desc : '', props: o ? o.props : [] }; });
            // Fields the sample rows lack but the report uses ($F{…} in an expression) are kept.
            var used = vm.jrxml + ' ' + q.filterExpression;
            var kept = [], dropped = [];
            Object.keys(old).forEach(function (n) {
              if (d.fields.some(function (f) { return f.name === n; })) return;
              if (used.indexOf('$F{' + n + '}') >= 0) { kept.push(n); q.fields.push(old[n]); } else dropped.push(n);
            });
            if (kept.length) dropped.unshift('(kept because the report uses them: ' + kept.join(', ') + ')');
            q.info = 'Read ' + d.fields.length + ' fields from ' + d.docs + ' document' + (d.docs === 1 ? '' : 's') + ' of ' + d.collection + '.' +
              (dropped.length ? ' Not in the results any more: ' + dropped.slice(0, 8).join(', ') + (dropped.length > 8 ? '…' : '') + '.' : '') +
              (d.missing.length ? ' No value for ' + d.missing.map(function (n) { return '$P{' + n + '}'; }).join(', ') + ' (used null).' : '') +
              (!d.docs ? ' The query returned nothing; set parameter values in the Parameters tab and read again.' : '');
            q.tab = 'fields';
          })
          .catch(function (err) { if (vm.qd) q.error = err.message; })
          .then(function () { if (vm.qd) q.busy = ''; });
      },
      runDataPreview: function () {
        var vm = this, q = vm.qd;
        q.busy = 'preview'; q.error = ''; q.tab = 'preview';
        post(BASE + '/query', vm.qPayload('preview'))
          .then(function (d) { if (vm.qd) q.preview = Object.freeze(d); })
          .catch(function (err) { if (vm.qd) q.error = err.message; })
          .then(function () { if (vm.qd) q.busy = ''; });
      },
      startSourceEdit: function () { this.sourceText = this.jrxml; this.sourceEdit = true; },
      applySource: function () {
        try {
          var r = importJrxml(this.sourceText), vm = this;
          r.resources.filter(function (n) { return !vm.images[n]; }).forEach(function (n) { r.warnings.unshift('Image "' + n + '" is not uploaded yet. Upload it in the image\'s properties.'); });
          r.design.folder = this.design.folder;
          r.design.dataSource = this.design.dataSource;
          this.design = r.design;
          this.selection = [];
          this.commit();
          this.sourceEdit = false;
          if (r.warnings.length) this.dialog = { kind: 'import', name: 'source', count: r.count, warnings: r.warnings };
          else this.toast('Source applied.');
        } catch (err) { this.toast(err.message, 'error'); }
      },
      copySource: function () {
        var vm = this;
        navigator.clipboard.writeText(vm.jrxml).then(function () { vm.copied = true; setTimeout(function () { vm.copied = false; }, 1500); })
          .catch(function () { vm.toast('Copy is blocked by the browser; select the text instead.', 'error'); });
      },

      // ─── JasperServer ───────────────────────────────────────────────────
      // The shared "Publish to" panel (publish-panel.js): the design's folder and data source, and
      // the servers / HIS settings of its last publish when it is a saved design.
      askPublish: function () {
        var vm = this;
        if (!vm.canPublish) return;      // off in Reports > Settings (deploy workflow only), or not in the role
        var form = JRPublish.form({ folder: vm.design.folder, dataSource: vm.design.dataSource, hisName: vm.cleanName }, vm.ctx);
        vm.dialog = { kind: 'publish', error: '', done: null, form: form, ownCode: '' };
        if (!vm.currentId) return;
        var id = vm.currentId;
        getJson(BASE + '/designs/' + id + '/publishes')
          .then(function (d) {
            var dl = vm.dialog;
            if (!dl || dl.kind !== 'publish' || dl.form !== form || vm.currentId !== id) return;
            var hisRow = (d.history || []).filter(function (h) { return h.hisCode; })[0];
            if (hisRow && !JRPublish.hisBlocked(vm.ctx)) {
              Object.assign(form, { target: 'both', hisCode: hisRow.hisCode, hisName: hisRow.hisName || form.hisName, locale: hisRow.hisLocale === 'en' ? 'en' : 'th' });
              dl.ownCode = hisRow.hisCode;
            }
          })
          .catch(function () { /* no history: defaults stay */ });
      },
      publish: function () {
        var vm = this, dl = vm.dialog, f = dl.form;
        if (vm.busy.dialog || vm.dialogIssue) return;
        vm.busy.dialog = true;
        dl.error = '';
        vm.design.name = vm.cleanName;
        // The folder and data source chosen here are kept in the design (as in Properties).
        if (vm.design.folder !== f.folder || vm.design.dataSource !== f.dataSource) {
          vm.design.folder = f.folder;
          vm.design.dataSource = f.dataSource;
          vm.commit();
        }
        post(BASE + '/publish', vm.payload({ publish: JRPublish.fields(f) }))
          .then(function (d) {
            dl.done = d;
            var failed = (d.servers || []).filter(function (sv) { return !sv.ok; });
            if (failed.length) vm.toast('Not published to ' + failed.map(function (sv) { return sv.name; }).join(', ') + '.', 'error');
          })
          .catch(function (err) { dl.error = err.message; })
          .then(function () { vm.busy.dialog = false; });
      },
      // ─── Live preview ───────────────────────────────────────────────────
      toggleLive: function () {
        this.liveOpen = !this.liveOpen;
        this.saveLive();
        if (this.liveOpen) { this.tab = 'design'; this.startLive(); }
      },
      saveLive: function () { store(LIVE_KEY, JSON.stringify({ open: this.liveOpen, width: this.liveWidth })); },
      // Opened: sample values for the well-known parameters, then the first data load.
      startLive: function () {
        var vm = this;
        vm.loadSampleParams().then(function () { if (vm.liveOpen && !vm.pv.busy) vm.runLocal(); });
      },
      startLiveResize: function (e) {
        var vm = this, x0 = e.clientX, w0 = vm.liveWidth, bar = e.currentTarget;
        var work = bar.parentNode.getBoundingClientRect().width;
        e.preventDefault();
        bar.classList.add('is-drag');
        var move = function (ev) { vm.liveWidth = Math.round(Math.max(260, Math.min(work * 0.6, w0 + x0 - ev.clientX))); };
        var up = function () {
          bar.classList.remove('is-drag');
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          vm.saveLive();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      },
      // reload: the rows depend on what changed (query, fields, parameters, source), else redraw only.
      scheduleLive: function (reload) {
        var vm = this;
        if (!vm.liveOpen) return;
        if (reload) {
          clearTimeout(vm._liveFetch);
          vm._liveFetch = setTimeout(function () { vm.runLocal(); }, 700);
        } else {
          clearTimeout(vm._liveDraw);
          vm._liveDraw = setTimeout(function () { vm.renderLive(); }, 250);
        }
      },
      // Fills the current design with the loaded rows (no database round trip).
      // layoutOnly: why the query gave nothing to draw (no query, it failed): the layout is drawn with one empty record instead.
      renderLive: function (layoutOnly) {
        var vm = this, pv = vm.pv, source = vm.pvSource;
        var rows, info;
        if (layoutOnly !== undefined) vm._pvLayout = layoutOnly || '';
        else if (source === 'query' && vm._pvLayout) layoutOnly = vm._pvLayout;   // a design edit redraws the same way
        if (source === 'empty') { rows = [{}]; info = { rows: 1, source: 'One empty record' }; }
        else if (source === 'none') { rows = []; info = { rows: 0, source: 'No data' }; }
        else if (layoutOnly) { rows = [{}]; info = { rows: 0, source: 'layout only' }; }
        else if (vm._pvData) { rows = vm._pvData.rows.map(function (r) { return Object.assign({}, r); }); info = vm._pvData.info; }
        else return;
        var d = JSON.parse(JSON.stringify(vm.design));
        var opts = { params: vm.previewParams, locale: pv.locale, images: vm.images, layoutText: layoutText };     // layoutText: Text adjust
        try {
          var res = window.JrxmlFill.fill(d, rows, opts);
          // The query found no rows and "When no data" gives no pages: show the layout anyway.
          if (source === 'query' && !layoutOnly && !res.pages.length && res.empty) {
            layoutOnly = 'The query found no rows';
            d = JSON.parse(JSON.stringify(vm.design));
            res = window.JrxmlFill.fill(d, [{}], opts);
          }
          if (layoutOnly) {
            res.notes.unshift(layoutOnly + ', so the layout is drawn with one empty record: fields and expressions on fields show empty.');
            info = Object.assign({}, info, { source: 'layout only' });
            res.empty = '';
          }
          if (info.missing && info.missing.length) res.notes.unshift('No value for ' + info.missing.join(', ') + ' in the query; null was used.');
          res.design = d;
          res.info = info;
          pv.result = Object.freeze(res);
          pv.error = '';
          if (pv.notesOpen && !res.notes.length) pv.notesOpen = false;
        } catch (err) { pv.error = err.message; }
      },
      // Loads the rows (query source) and draws them.
      runLocal: function () {
        var vm = this, pv = vm.pv, d = vm.design, source = vm.pvSource;
        clearTimeout(vm._liveFetch);
        pv.view = 'local';
        if (source !== 'query') { pv.dataKey = null; vm.renderLive(); return; }
        if (!d.query.trim()) { pv.error = ''; pv.dataKey = vm.liveKey; vm.renderLive('This report has no query yet (Dataset & Query)'); return; }
        var limit = Math.max(1, Math.min(1000, parseInt(pv.limit, 10) || 200));
        var key = vm.liveKey, req = (vm._liveReq || 0) + 1;
        vm._liveReq = req;
        pv.busy = true;
        pv.error = '';
        post(BASE + '/query', {
          mode: 'fill', language: d.language, query: d.query, limit: limit, values: vm.previewParams,
          params: d.params.map(function (x) { return { name: x.name, def: x.def }; }),
          fields: d.fields.map(function (f) { return f.name; })
        })
          .then(function (res) {
            if (req !== vm._liveReq) return;
            var rows = res.rows.map(function (row) {
              Object.keys(row).forEach(function (k) { var v = row[k]; if (v && typeof v === 'object' && v.$date) row[k] = new Date(v.$date); });
              return row;
            });
            vm._pvData = { rows: rows, info: { rows: res.docs, source: res.collection, masked: res.masked, limit: res.docs >= limit ? limit : 0, missing: res.missing } };
            pv.dataKey = key;
            vm.renderLive('');
          })
          .catch(function (err) {
            if (req !== vm._liveReq) return;
            vm._pvData = null;
            pv.dataKey = key;
            vm.renderLive('The query could not be run (' + err.message + ')');
            pv.error = err.message;                // after the redraw, which clears it
          })
          .then(function () { if (req === vm._liveReq) pv.busy = false; });
      },
      // ─── Problems panel ─────────────────────────────────────────────────
      // A click on a problem shows what it is about: selects the element (or band) on the canvas,
      // scrolls it into view and makes it blink; a dataset problem opens that tab of Dataset and Query.
      goToProblem: function (text) {
        var vm = this, t = vm.checked.targets[text];
        if (!t) return;
        if (t.dataset) { vm.openQuery(t.dataset); return; }
        if (t.id && !vm.find(t.id)) return;
        if (t.id) vm.oxSelectEl({ id: t.id }, t.band);
        else vm.oxSelectBand(t.band);
        vm.$nextTick(function () {
          var node = vm.$el.querySelector(t.id ? '[data-el="' + t.id + '"]' : '[data-band="' + t.band + '"]');
          if (!node) return;
          if (!t.id) node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          node.classList.remove('is-flash');
          void node.offsetWidth;                         // restart the animation on a second click
          node.classList.add('is-flash');
          setTimeout(function () { node.classList.remove('is-flash'); }, 1000);
        });
      },
      problemHint: function (text) {
        var t = this.checked.targets[text];
        if (!t) return '';
        return t.dataset ? 'Open Dataset and Query' : t.id ? 'Select this element' : 'Select this band';
      },
      toggleProblems: function () { this.showProblems = !this.showProblems; this.saveProbs(); },
      saveProbs: function () { store(PROBS_KEY, JSON.stringify({ open: this.showProblems, height: this.probsHeight })); },
      // Drag its top edge: up makes it taller (the design above keeps at least 160 px).
      startProbsResize: function (e) {
        var vm = this, startY = e.clientY, startH = vm.probsHeight, panel = e.target.parentNode;
        var work = panel.parentNode, maxH = Math.max(PROBS_MIN, work.clientHeight - 160 - 32);
        e.preventDefault();
        panel.classList.add('is-resizing');
        function move(ev) { vm.probsHeight = Math.round(Math.min(maxH, Math.max(PROBS_MIN, startH + startY - ev.clientY))); }
        function up() {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          panel.classList.remove('is-resizing');
          vm.saveProbs();
        }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      },
      togglePalette: function () { this.paletteOpen = !this.paletteOpen; store(PALETTE_KEY, this.paletteOpen ? '1' : '0'); },
      resetPreviewParams: function () {
        var vm = this;
        Object.keys(vm.previewParams).forEach(function (k) { vm.previewParams[k] = ''; });
        vm.loadSampleParams();
      },
      // patientvisitsuid / loginuid: the first record of the connected site, when the field is empty.
      loadSampleParams: function () {
        var vm = this;
        return getJson(BASE + '/sample-params')
          .then(function (d) {
            var values = (d && d.values) || {};
            vm.design.params.forEach(function (p) {
              var v = values[p.name.toLowerCase()];
              if (v && !vm.previewParams[p.name]) vm.$set(vm.previewParams, p.name, v);
            });
          })
          .catch(function () { /* not connected: leave the fields empty */ });
      },
      // Save PDF: the pages at print size (1 report px = 1 pt) in a hidden frame, printed by the browser.
      printPreview: function () {
        var vm = this, pv = vm.pv, res = pv.result;
        if (!res || !res.pages.length) return;
        var zoom = pv.zoom;
        pv.zoom = 4 / 3;
        vm.$nextTick(function () {
          var html = vm.$refs.pvPages ? vm.$refs.pvPages.innerHTML : '';
          pv.zoom = zoom;
          var css = [].map.call(document.querySelectorAll('style'), function (st) { return st.textContent.replace(/@import[^;]+;/g, ''); }).join('\n');
          var icons = [].filter.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) { return /fontawesome|font-awesome/i.test(l.href); })
            .map(function (l) { return '<link rel="stylesheet" href="' + escHtml(l.href) + '">'; }).join('');
          var pg = res.pages[0];
          var frame = document.createElement('iframe');
          frame.setAttribute('aria-hidden', 'true');
          frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
          document.body.appendChild(frame);
          var doc = frame.contentDocument;
          doc.open();
          doc.write('<!doctype html><html><head><meta charset="utf-8"><title>' + escHtml(res.design.name) + '</title>' +
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap">' + icons +
            // box-sizing: the page gets it from Bootstrap, which the print frame does not load (without it text
            // boxes grow by their padding and right-aligned text is cut off at the edge).
            '<style>' + css + '</style><style>*, *::before, *::after { box-sizing: border-box; } @page { size: ' + pg.width + 'pt ' + pg.height + 'pt; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }' +
            ' .jd-pv-pages { display: block; padding: 0; gap: 0; width: auto; min-width: 0; } .jd-pv-page { box-shadow: none !important; margin: 0 !important; break-after: page; page-break-after: always; }' +
            ' .jd-pv-page:last-child { break-after: auto; page-break-after: auto; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }</style>' +
            '</head><body><div class="jd-pv-pages">' + html + '</div></body></html>');
          doc.close();
          var link = doc.querySelector('link');
          var loaded = new Promise(function (done) {
            if (link.sheet) return done();
            link.onload = link.onerror = done;
            setTimeout(done, 3000);
          });
          loaded
            .then(function () { return doc.fonts ? Promise.race([doc.fonts.load('400 16px Sarabun').then(function () { return doc.fonts.load('700 16px Sarabun'); }), new Promise(function (t) { setTimeout(t, 3000); })]) : null; })
            .catch(function () { /* print with the fallback font */ })
            .then(function () {
              setTimeout(function () {
                try { frame.contentWindow.focus(); frame.contentWindow.print(); }
                finally { setTimeout(function () { frame.remove(); }, 1000); }
              }, 100);
            });
        });
      },
      runPreview: function () {
        var vm = this;
        vm.busy.preview = true;
        vm.previewError = '';
        post(BASE + '/preview', vm.payload({ params: vm.previewParams }), true)
          .then(function (blob) {
            if (vm.previewUrl) URL.revokeObjectURL(vm.previewUrl);
            vm.previewUrl = URL.createObjectURL(blob);
            vm.pv.view = 'server';
          })
          .catch(function (err) { vm.previewError = err.message; })
          .then(function () { vm.busy.preview = false; });
      }
    }
  });
})();
