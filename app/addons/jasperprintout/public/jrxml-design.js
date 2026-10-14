// Jasper Designer: the report design model and its JRXML.
// Shared by the browser (live Source tab, download) and the server (publish, preview), so both
// produce the same JRXML. A design is plain JSON:
//
//   { name, page: { size, orientation, width, height, margins: { top, right, bottom, left } },
//     font: { name, size },                       designer default for new text elements
//     language, query,                            dataset query (e.g. MongoDbQuery)
//     params: [{ name, cls, def, desc, prompt }], fields: [{ name, cls, desc, props }],
//     sortFields: [{ name, order }], filterExpression,
//     attrs: { isIgnorePagination, whenNoDataType, ... },   other <jasperReport> attributes
//     properties: [[name, value]],                report <property> elements
//     raw: { head: [], variables: [], groups: [], background, noData, lastPageFooter },   lastPageFooter: only designs saved before it was a band
//                                                 JRXML the designer keeps without editing
//     bands: { title: { height, elements: [...], props, hidden }, pageHeader, columnHeader, detail,
//              columnFooter, pageFooter, lastPageFooter, summary },     hidden: left out of the JRXML, elements kept
//     folder, dataSource,
//     watermark: { enabled, text, angle, size, color, opacity, bold, font, tiled, gap } }
//                                                 printed on every page: a transparent PNG (WATERMARK_IMAGE, drawn
//                                                 by the browser) in the Background band; JRXML text can't turn by any angle
//
// Element types: staticText, textField, image, barcode, rectangle, ellipse, line, raw (an element the
// designer can't edit, e.g. a subreport; its XML is kept and written back, moved/resized).
// Every element keeps what the designer does not model (extra attributes, <property> elements)
// so an imported JRXML is written back without losing settings.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JrxmlDesign = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BANDS = [
    ['title', 'Title'], ['pageHeader', 'Page Header'], ['columnHeader', 'Column Header'], ['detail', 'Detail 1'],
    ['columnFooter', 'Column Footer'], ['pageFooter', 'Page Footer'], ['lastPageFooter', 'Last Page Footer'], ['summary', 'Summary']
  ];
  // The Detail section may have more bands: detail2, detail3, … ("Detail 2", "Detail 3"), printed in
  // order for each record. bandList(d) is BANDS with the design's extra detail bands after Detail 1.
  var DETAIL_RE = /^detail([2-9]|[1-9]\d)$/;
  var MAX_DETAIL = 50;
  function detailKeys(d) {
    return ['detail'].concat(Object.keys(d.bands || {}).filter(function (k) { return DETAIL_RE.test(k) && Number(k.slice(6)) <= MAX_DETAIL; })
      .sort(function (a, b) { return Number(a.slice(6)) - Number(b.slice(6)); }));
  }
  function bandList(d) {
    var out = [];
    BANDS.forEach(function (b) {
      if (b[0] !== 'detail') { out.push(b); return; }
      detailKeys(d).forEach(function (k) { out.push([k, 'Detail ' + (k === 'detail' ? 1 : Number(k.slice(6)))]); });
    });
    return out;
  }
  var PAGES = { A4: [595, 842], A5: [420, 595], A3: [842, 1191], Letter: [612, 792], Legal: [612, 1008] };
  var TYPES = ['staticText', 'textField', 'image', 'barcode', 'rectangle', 'ellipse', 'line', 'break', 'subreport', 'check', 'table', 'raw'];
  // Table: edited as one element; its header prints in the Column Header band (each page) and its rows in
  // its own band (a Detail band: a row per record of the report query), or it has a fixed number of blank
  // rows (a form to fill in by hand). See tableXml for how it is written.
  var TABLE_PROP = 'com.centrix.designer.table';            // the settings, on its first row cell
  var TABLE_PART_PROP = 'com.centrix.designer.tablePart';   // the table id, on every cell it writes
  var TABLE_PREFIX = 'CentrixTable_';
  var ROW_SOURCES = ['query', 'fixed'];
  // Checkbox / radio ("check"): drawn with shapes in a <frame> marked by CHECK_PROP, so they print the same
  // in every font. state: shown checked, unchecked, or checked when checkedWhen (Boolean) is true.
  var CHECK_KINDS = ['checkbox', 'radio'];
  var CHECK_STATES = ['unchecked', 'checked', 'expression'];
  var CHECK_PROP = 'com.centrix.designer.check';
  var CONNECTIONS = ['connection', 'dataSource', 'none'];
  // Bands JasperServer prints on every page and never splits onto the next one.
  var FIXED_BANDS = ['pageHeader', 'columnHeader', 'columnFooter', 'pageFooter', 'lastPageFooter'];      // subreport: what it reads its data from
  var BARCODES = ['Code128', 'Code39', 'EAN13', 'QRCode', 'DataMatrix'];
  var H_ALIGN = ['Left', 'Center', 'Right', 'Justified'];
  var V_ALIGN = ['Top', 'Middle', 'Bottom'];
  var SCALE = ['RetainShape', 'FillFrame', 'Clip', 'RealSize', 'RealHeight'];
  var TEXT_ADJUST = ['CutText', 'StretchHeight', 'ScaleFont'];
  var EVAL = ['Now', 'Report', 'Page', 'Column', 'Group', 'Band', 'Auto'];
  var LINE_STYLES = ['Solid', 'Dashed', 'Dotted', 'Double'];
  var POSITION = ['Float', 'FixRelativeToTop', 'FixRelativeToBottom'];
  var STRETCH = ['NoStretch', 'RelativeToTallestObject', 'RelativeToBandHeight', 'ContainerHeight', 'ContainerBottom', 'ElementGroupHeight', 'ElementGroupBottom'];
  var MARKUP = ['none', 'html', 'styled', 'rtf'];
  var ROTATION = ['None', 'Left', 'Right', 'UpsideDown'];
  var LANGUAGES = ['MongoDbQuery', 'sql', 'hql', 'xPath', 'xPath2', 'json', 'jsonql', 'csv', 'ejbql', 'mdx', 'plsql'];
  var WHEN_NO_DATA = ['NoPages', 'BlankPage', 'AllSectionsNoDetail', 'NoDataSection'];
  // Report attributes kept from an import (the designer writes name, page size and margins itself).
  var REPORT_ATTRS = ['language', 'columnCount', 'printOrder', 'columnDirection', 'columnSpacing', 'whenNoDataType',
    'sectionType', 'isTitleNewPage', 'isSummaryNewPage', 'isSummaryWithPageHeaderAndFooter', 'isFloatColumnFooter',
    'scriptletClass', 'resourceBundle', 'whenResourceMissingType', 'isIgnorePagination', 'formatFactoryClass'];
  var CLASSES = ['java.lang.String', 'java.lang.Integer', 'java.lang.Long', 'java.lang.Double', 'java.math.BigDecimal',
    'java.lang.Boolean', 'java.util.Date', 'java.sql.Timestamp', 'org.bson.types.ObjectId', 'java.util.List',
    'java.util.Map', 'java.lang.Object'];
  var FONTS = ['TH SarabunPSK', 'TH Sarabun New', 'SansSerif', 'Serif', 'Monospaced', 'Tahoma', 'Arial'];
  var NAME_RE = /^[A-Za-z_$][\w$.\-]*$/;                       // field / parameter names (Mongo paths have dots)
  var CLASS_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*(\[\])*$/;
  var ATTR_RE = /^[A-Za-z_][\w.:-]*$/;
  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var SIDES = ['top', 'left', 'bottom', 'right'];

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  var attr = function (v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var cdata = function (v) { return '<![CDATA[' + String(v == null ? '' : v).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>'; };
  var num = function (v, d, min, max) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) n = d;
    if (min != null && n < min) n = min;
    if (max != null && n > max) n = max;
    return n;
  };
  var dec = function (v, d, min, max) {
    var n = Math.round(Number(v) * 100) / 100;
    if (!isFinite(n)) n = d;
    return Math.max(min, Math.min(max, n));
  };
  var pick = function (v, list, d) { return list.indexOf(v) >= 0 ? v : d; };
  var color = function (v, d) { return COLOR_RE.test(String(v || '')) ? String(v).toUpperCase() : d; };
  var str = function (v, max) { return String(v == null ? '' : v).slice(0, max || 4000); };
  var bool = function (v) { return v === true || v === 'true'; };
  // Extra attributes / properties kept from an import: plain string maps and [name, value] pairs.
  var attrMap = function (m) {
    var out = {};
    if (m && typeof m === 'object') Object.keys(m).slice(0, 60).forEach(function (k) { if (ATTR_RE.test(k)) out[k] = str(m[k], 2000); });
    return out;
  };
  var propList = function (list) {
    return (Array.isArray(list) ? list : []).filter(function (p) { return Array.isArray(p) && ATTR_RE.test(String(p[0])); })
      .slice(0, 100).map(function (p) { return [str(p[0], 200), str(p[1], 2000)]; });
  };
  var rawXml = function (v) { var s = str(v, 400000).trim(); return /^<[A-Za-z][\s\S]*>$/.test(s) ? s : ''; };

  function newDesign(name) {
    var bands = {};
    var heights = { title: 79, pageHeader: 35, columnHeader: 61, detail: 125, columnFooter: 45, pageFooter: 54, lastPageFooter: 54, summary: 42 };
    BANDS.forEach(function (b) { bands[b[0]] = { height: heights[b[0]], elements: [], props: [] }; });
    return {
      version: 2,
      name: name || 'New_Report',
      page: { size: 'A4', orientation: 'portrait', width: 595, height: 842, margins: { top: 20, right: 20, bottom: 20, left: 20 } },
      font: { name: 'TH SarabunPSK', size: 14 },
      language: 'MongoDbQuery',
      query: '',
      params: [],
      fields: [],
      sortFields: [],
      filterExpression: '',
      attrs: {},
      properties: [],
      raw: { head: [], variables: [], groups: [], background: '', noData: '', lastPageFooter: '' },
      bands: bands,
      folder: '',
      dataSource: '',
      watermark: defaultWatermark()
    };
  }

  // ─── Watermark ─────────────────────────────────────────────────────────
  var WATERMARK_IMAGE = 'watermark.png';                       // the image resource it is published as
  var WATERMARK_PROP = 'com.centrix.designer.watermark';      // report property: its settings (JSON), read back on import
  var WATERMARK_EL_PROP = 'com.centrix.designer.watermarkImage';   // marks its <image> in the Background band
  function defaultWatermark() {
    return { enabled: false, text: 'CONFIDENTIAL', angle: -45, size: 72, color: '#9ca3af', opacity: 0.25, bold: true, font: 'TH SarabunPSK', tiled: false, gap: 120 };
  }
  function sanitizeWatermark(w) {
    var src = w && typeof w === 'object' ? w : {}, def = defaultWatermark();
    var op = parseFloat(src.opacity);
    return {
      enabled: src.enabled === true,
      text: src.text == null ? def.text : str(src.text, 500),
      angle: Math.round(num(src.angle, def.angle, -180, 180)),
      size: num(src.size, def.size, 6, 400),
      color: /^#[0-9a-f]{6}$/i.test(src.color || '') ? src.color : def.color,
      opacity: isFinite(op) ? Math.min(1, Math.max(0.03, Math.round(op * 100) / 100)) : def.opacity,
      bold: src.bold == null ? def.bold : src.bold === true,
      font: str(src.font || def.font, 60),
      tiled: src.tiled === true,
      gap: num(src.gap, def.gap, 0, 1000)
    };
  }
  // <background>: the kept one (imported), with the watermark image added when there is one.
  // The Background band prints behind everything else on every page.
  function backgroundXml(d) {
    var keep = d.raw.background;
    if (!hasWatermark(d)) return keep ? '\t' + keep : '\t<background>\n\t\t<band splitType="Stretch"/>\n\t</background>';
    var box = watermarkBox(d);
    var img = '\t\t\t<image scaleImage="FillFrame" hAlign="Center" vAlign="Middle" isUsingCache="true">\n' +
      '\t\t\t\t<reportElement x="0" y="0" width="' + box.width + '" height="' + box.height + '" uuid="' + uuid() + '">\n' +
      '\t\t\t\t\t<property name="' + WATERMARK_EL_PROP + '" value="true"/>\n' +
      '\t\t\t\t</reportElement>\n' +
      '\t\t\t\t<imageExpression><![CDATA["repo:' + WATERMARK_IMAGE + '"]]></imageExpression>\n' +
      '\t\t\t</image>';
    var band = /<band\b[^>]*?(\/?)>/.exec(keep || '');
    if (!band) return '\t<background>\n\t\t<band height="' + box.height + '" splitType="Stretch">\n' + img + '\n\t\t</band>\n\t</background>';
    // Kept background: tall enough for the image, which goes in first (behind what was there).
    var tag = band[0].replace(/\s*\/?>$/, '').replace(/\sheight="[^"]*"/, '') + ' height="' + box.height + '">';
    var rest = band[1] ? '</band>' : keep.slice(band.index + band[0].length).replace(/^([\s\S]*?)<\/band>[\s\S]*$/, '$1</band>');
    return '\t<background>\n\t\t' + tag + '\n' + img + '\n' + rest.replace(/^\s*\n?/, '\t\t\t') + '\n\t</background>';
  }

  // Printed when switched on with some text.
  function hasWatermark(d) { return !!(d && d.watermark && d.watermark.enabled && String(d.watermark.text || '').trim()); }
  // Where the watermark image goes: the Background band covers the page inside the margins.
  function watermarkBox(d) {
    var p = d.page, m = p.margins;
    return { x: 0, y: 0, width: Math.max(1, p.width - m.left - m.right), height: Math.max(1, p.height - m.top - m.bottom) };
  }

  // Converted documents (Word, HTML): pages of { els, height } → Detail 1, Detail 2, … one per page.
  // A page taller than `room` is split at an element boundary; every band but the last is `room` high,
  // so each starts on a new page. Title, column bands and summary are hidden. Returns warnings.
  function pagesToDetailBands(d, pages, room) {
    var warnings = [], fitted = [];
    pages.forEach(function (pg) {
      var els = pg.els.slice(), height = pg.height;
      while (height > room && els.length) {
        var cut = Infinity;
        els.forEach(function (e) { if (e.y + e.height > room) cut = Math.min(cut, e.y); });
        if (!isFinite(cut) || cut <= 0) break;
        fitted.push({ els: els.filter(function (e) { return e.y < cut; }), height: cut });
        els = els.filter(function (e) { return e.y >= cut; });
        els.forEach(function (e) { e.y -= cut; });
        height -= cut;
      }
      fitted.push({ els: els, height: height });
    });
    if (!fitted.length) fitted.push({ els: [], height: 0 });
    if (fitted.length > MAX_DETAIL) {
      warnings.push('The document has ' + fitted.length + ' pages; pages ' + MAX_DETAIL + '–' + fitted.length + ' are joined into Detail ' + MAX_DETAIL + ', which is taller than a page. Split the document into more than one report.');
      var last = fitted.splice(MAX_DETAIL - 1), h = 0, all = [];
      last.forEach(function (pg) { pg.els.forEach(function (e) { e.y += h; all.push(e); }); h += pg.height; });
      fitted.push({ els: all, height: h });
    }
    Object.keys(d.bands).forEach(function (k) { if (DETAIL_RE.test(k)) delete d.bands[k]; });
    fitted.forEach(function (pg, i) {
      var tall = Math.ceil(Math.max(pg.height, 20));
      d.bands[i ? 'detail' + (i + 1) : 'detail'] = { height: i < fitted.length - 1 ? Math.max(room, tall) : Math.max(1, Math.min(tall, i === MAX_DETAIL - 1 ? tall : room)), elements: pg.els, props: [] };
    });
    ['title', 'columnHeader', 'columnFooter', 'lastPageFooter', 'summary'].forEach(function (k) { d.bands[k] = { height: 0, elements: [], props: [], hidden: true }; });
    delete d.attrs.whenNoDataType; delete d.attrs.isSummaryNewPage; delete d.attrs.isSummaryWithPageHeaderAndFooter;
    return { warnings: warnings, pages: fitted.length };
  }

  function hTitleBands(d) {
    var h = function (k) { return d.bands[k] && !d.bands[k].hidden ? d.bands[k].height : 0; };
    return h('pageHeader') + Math.max(h('pageFooter'), h('lastPageFooter'));
  }

  function columnWidth(d) { return d.page.width - d.page.margins.left - d.page.margins.right; }

  // Height the bands use on one page (title + summary print once; Jasper checks the others).
  function bandUsage(d) {
    var h = function (k) { return d.bands[k] && !d.bands[k].hidden ? d.bands[k].height : 0; };
    var available = d.page.height - d.page.margins.top - d.page.margins.bottom;
    var detail = Math.max.apply(null, detailKeys(d).map(h));             // the detail bands print one after another
    var page = h('pageHeader') + h('columnHeader') + detail + h('columnFooter') + Math.max(h('pageFooter'), h('lastPageFooter'));
    return { available: available, perPage: page, withTitle: page + h('title'), withSummary: page + h('summary') };
  }

  function emptyBox() { return { pad: { top: 0, left: 0, bottom: 0, right: 0 }, pen: null, sides: { top: null, left: null, bottom: null, right: null } }; }

  // Default element of a palette type, sized like Jaspersoft Studio's.
  function newElement(type, opts) {
    opts = opts || {};
    var el = {
      id: uuid(), type: type, x: 0, y: 0, width: 100, height: 30, forecolor: '#000000', backcolor: '#FFFFFF', opaque: false,
      positionType: '', stretchType: '', printWhen: '', key: '', props: [], xa: { el: {}, re: {}, te: {}, font: {} }
    };
    if (type === 'staticText' || type === 'textField') {
      Object.assign(el, {
        text: 'Static Text', expression: '"Text Field"', fontName: '', fontSize: 0, bold: false, italic: false, underline: false, strike: false,
        hAlign: 'Left', vAlign: 'Middle', markup: 'none', rotation: 'None',
        box: emptyBox(), pattern: '', evaluationTime: 'Now', textAdjust: 'CutText', blankWhenNull: true
      });
      el.box.pad = { top: 2, left: 2, bottom: 2, right: 2 };
    } else if (type === 'image') {
      Object.assign(el, { height: 50, source: 'resource', resource: '', expression: '', scale: 'RetainShape', hAlign: 'Center', vAlign: 'Middle', box: emptyBox() });
    } else if (type === 'barcode') {
      Object.assign(el, { width: 200, height: 50, kind: 'Code128', expression: '"123456789"', textPosition: 'bottom', moduleWidth: 1 });
    } else if (type === 'ellipse') {
      Object.assign(el, { height: 50, lineWidth: 1, lineColor: '#000000', lineStyle: 'Solid' });
    } else if (type === 'rectangle') {
      Object.assign(el, { height: 50, radius: 0, lineWidth: 1, lineColor: '#000000', lineStyle: 'Solid' });
    } else if (type === 'line') {
      Object.assign(el, { height: 1, direction: 'TopDown', lineWidth: 1, lineColor: '#000000', lineStyle: 'Solid' });
    } else if (type === 'break') {
      Object.assign(el, { height: 1, breakType: 'Page' });               // what is below it in the band starts a new page (or column)
    } else if (type === 'subreport') {
      // expression: the report to run ("repo:Sub.jrxml" or a repository path); params: [{ name, expression }] passed to it;
      // connection + connExpr: its connectionExpression / dataSourceExpression; returns: <returnValue> XML kept as written.
      Object.assign(el, { width: 200, height: 100, expression: '', params: [], connection: 'connection', connExpr: '$P{REPORT_CONNECTION}', paramsMap: '', returns: [] });
    } else if (type === 'check') {
      Object.assign(el, { width: 14, height: 14, kind: 'checkbox', state: 'unchecked', checkedWhen: '', lineWidth: 1, lineColor: '#000000', markColor: '#000000' });
    } else if (type === 'table') {
      Object.assign(el, {
        width: 450, height: 20,                                  // the rows (one, or the fixed ones); the header is in Column Header
        rowSource: 'query', rowCount: 5,                       // fixed: that many blank rows
        headerShow: true, headerHeight: 20, headerY: 0, rowHeight: 20,   // headerY: where the header is in the Column Header band
        headerBg: '#D9E2F3', headerColor: '#000000', headerBold: true, headerAlign: 'Center', headerAdjust: 'CutText',
        rowBg: '#FFFFFF', altRowBg: '', rowColor: '#000000',     // altRowBg: every second row ('' = same)
        textAdjust: 'CutText',                                   // of the row cells: CutText | StretchHeight | ScaleFont
        borderWidth: 0.5, borderColor: '#000000', borderStyle: 'Solid',
        borders: allBorders(true),                               // which lines: outer sides and inner lines (see tableCellSides)
        fontName: '', fontSize: 0, padding: 2,
        columns: [1, 2, 3].map(function (n) { return newColumn('Column ' + n, 150); })
      });
    }
    return Object.assign(el, opts);
  }

  // A table column: header text, the value of each row (an expression, usually $F{field}), width and alignment.
  function newColumn(header, width) {
    return { id: uuid(), header: header || '', expression: '', width: width || 100, hAlign: 'Left', pattern: '' };
  }
  // Table borders, like a spreadsheet's: the four outer sides and the inner lines between rows / columns.
  var BORDER_KEYS = ['top', 'bottom', 'left', 'right', 'innerH', 'innerV'];
  var BORDER_PRESETS = {
    all: { top: 1, bottom: 1, left: 1, right: 1, innerH: 1, innerV: 1 }, inner: { innerH: 1, innerV: 1 },
    innerH: { innerH: 1 }, innerV: { innerV: 1 }, outer: { top: 1, bottom: 1, left: 1, right: 1 }, none: {}
  };
  function allBorders(on) { var b = {}; BORDER_KEYS.forEach(function (k) { b[k] = !!on; }); return b; }
  // A preset sets the lines (all, inner, innerH, innerV, outer, none); a side (top, bottom, left, right)
  // turns that one on or off, like the spreadsheet's border menu.
  function applyBorders(el, preset) {
    if (BORDER_PRESETS[preset]) {
      var p = BORDER_PRESETS[preset];
      BORDER_KEYS.forEach(function (k) { el.borders[k] = !!p[k]; });
    } else if (BORDER_KEYS.indexOf(preset) >= 0) {
      el.borders[preset] = !el.borders[preset];
    }
    if (preset !== 'none' && !(el.borderWidth > 0)) el.borderWidth = 0.5;
    return el;
  }
  // The sides of one cell that have a line: kind 'header' (the header row) or 'row' (row r of n rows;
  // with rows from the query n is unknown: a row is any record, so its bottom has the inner line, or
  // the outer one when there are no inner lines). i: the column of cols. Each line is drawn by one cell only.
  function tableCellSides(el, kind, i, cols, r, n) {
    var b = el.borders || allBorders(true), on = el.borderWidth > 0, s = {};
    s.left = on && (i === 0 ? b.left : b.innerV);
    s.right = on && i === cols - 1 && b.right;
    if (kind === 'header') {
      s.top = on && b.top;
      s.bottom = on && b.innerH;                    // between the header and the rows
    } else if (el.rowSource === 'fixed') {
      s.top = on && r === 0 && !el.headerShow && b.top;
      s.bottom = on && (r === n - 1 ? b.bottom : b.innerH);
    } else {
      s.top = on && !el.headerShow && b.top;      // no header: the top line (between rows it lies on the line of the row above)
      s.bottom = on && (b.innerH || b.bottom);
    }
    return s;
  }

  // Rows the table shows in the designer (and prints, for fixed rows).
  function tableRows(el) { return el.rowSource === 'fixed' ? el.rowCount : 1; }
  // Size the table (its rows) from its columns and rows (after its settings change).
  function fitTable(el) {
    el.width = el.columns.reduce(function (s, c) { return s + c.width; }, 0) || 1;
    el.height = tableRows(el) * el.rowHeight;
    return el;
  }
  // The other way round, after the table was resized on the page: columns keep their proportions,
  // the rows share the new height.
  function normalizeTable(el) {
    var total = el.columns.reduce(function (s, c) { return s + c.width; }, 0);
    if (el.columns.length && total !== el.width && el.width > 0) {
      var left = el.width;
      el.columns.forEach(function (c, i) {
        c.width = i === el.columns.length - 1 ? Math.max(1, left) : Math.max(1, Math.round(c.width * el.width / (total || 1)));
        left -= c.width;
      });
    }
    var n = tableRows(el);
    if (n * el.rowHeight !== el.height) {
      el.rowHeight = Math.max(6, Math.round(el.height / n));
      el.height = n * el.rowHeight;
    }
    return el;
  }

  // ─── sanitize: a clean copy with every value checked; the server publishes only what passes ──

  function sanitizePen(p) {
    if (!p || typeof p !== 'object') return null;
    return { w: dec(p.w, 0, 0, 20), s: pick(p.s, LINE_STYLES, 'Solid'), c: color(p.c, '#000000') };
  }
  function sanitizeBox(b, legacy) {
    var box = emptyBox();
    if (b && typeof b === 'object') {
      var pad = b.pad || {};
      SIDES.forEach(function (s) { box.pad[s] = num(pad[s], 0, 0, 200); box.sides[s] = sanitizePen((b.sides || {})[s]); });
      box.pen = sanitizePen(b.pen);
    } else if (legacy) {
      // Designs saved before per-side borders: borderWidth / borderColor / padding.
      var p = num(legacy.padding, 0, 0, 200);
      SIDES.forEach(function (s) { box.pad[s] = p; });
      if (Number(legacy.borderWidth) > 0) box.pen = { w: dec(legacy.borderWidth, 1, 0, 20), s: 'Solid', c: color(legacy.borderColor, '#000000') };
    }
    return box;
  }

  function sanitize(input) {
    var src = input && typeof input === 'object' ? input : {};
    var d = newDesign();
    d.uuid = /^[0-9a-f-]{36}$/i.test(src.uuid || '') ? src.uuid : '';
    d.name = str(src.name || 'New_Report', 100).replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '') || 'New_Report';
    var pg = src.page || {};
    d.page.size = PAGES[pg.size] ? pg.size : (pg.size === 'Custom' ? 'Custom' : 'A4');
    d.page.orientation = pg.orientation === 'landscape' ? 'landscape' : 'portrait';
    if (d.page.size === 'Custom') {
      d.page.width = num(pg.width, 595, 50, 5000);
      d.page.height = num(pg.height, 842, 50, 14400);
    } else {
      var wh = PAGES[d.page.size];
      d.page.width = d.page.orientation === 'landscape' ? wh[1] : wh[0];
      d.page.height = d.page.orientation === 'landscape' ? wh[0] : wh[1];
    }
    var m = pg.margins || {};
    ['top', 'right', 'bottom', 'left'].forEach(function (k) { d.page.margins[k] = num(m[k], 20, 0, 500); });
    var f = src.font || {};
    d.font = { name: str(f.name || 'TH SarabunPSK', 60), size: num(f.size, 14, 4, 96) };
    d.language = 'MongoDbQuery';      // the designer works with MongoDB reports only
    d.query = str(src.query, 100000);
    d.folder = str(src.folder, 300);
    d.dataSource = str(src.dataSource, 300);
    d.filterExpression = str(src.filterExpression, 10000);
    var seen = {};
    d.params = (Array.isArray(src.params) ? src.params : []).filter(function (p) {
      return p && NAME_RE.test(p.name) && !seen['p' + p.name] && (seen['p' + p.name] = true);
    }).slice(0, 200).map(function (p) {
      return { name: p.name, cls: CLASS_RE.test(p.cls || '') ? p.cls : 'java.lang.String', def: str(p.def, 5000), desc: str(p.desc, 1000), prompt: p.prompt !== false, props: propList(p.props) };
    });
    d.fields = (Array.isArray(src.fields) ? src.fields : []).filter(function (p) {
      return p && NAME_RE.test(p.name) && !seen['f' + p.name] && (seen['f' + p.name] = true);
    }).slice(0, 1000).map(function (p) {
      return { name: p.name, cls: CLASS_RE.test(p.cls || '') ? p.cls : 'java.lang.String', desc: str(p.desc, 1000), props: propList(p.props) };
    });
    d.sortFields = (Array.isArray(src.sortFields) ? src.sortFields : []).filter(function (s) { return s && NAME_RE.test(s.name); })
      .slice(0, 50).map(function (s) { return { name: s.name, order: s.order === 'Descending' ? 'Descending' : 'Ascending', type: s.type === 'Variable' ? 'Variable' : 'Field' }; });
    var attrs = src.attrs && typeof src.attrs === 'object' ? src.attrs : {};
    REPORT_ATTRS.forEach(function (k) { if (attrs[k] != null && attrs[k] !== '') d.attrs[k] = str(attrs[k], 300); });
    d.properties = propList(src.properties).filter(function (p) { return p[0] !== WATERMARK_PROP; });   // written from d.watermark
    d.watermark = sanitizeWatermark(src.watermark);
    var raw = src.raw || {};
    d.raw = {
      head: (Array.isArray(raw.head) ? raw.head : []).map(rawXml).filter(Boolean).slice(0, 200),
      variables: (Array.isArray(raw.variables) ? raw.variables : []).map(rawXml).filter(Boolean).slice(0, 200),
      groups: (Array.isArray(raw.groups) ? raw.groups : []).map(rawXml).filter(Boolean).slice(0, 50),
      background: rawXml(raw.background), noData: rawXml(raw.noData), lastPageFooter: rawXml(raw.lastPageFooter)
    };
    var bands = src.bands || {};
    var cleanBand = function (key) {
      var band = bands[key] || {};
      return {
        height: num(band.height, 0, 0, 14400),
        elements: (Array.isArray(band.elements) ? band.elements : []).slice(0, 2000).map(sanitizeElement).filter(Boolean),
        props: propList(band.props),
        splitType: pick(band.splitType, ['Stretch', 'Prevent', 'Immediate'], 'Stretch'),
        printWhen: str(band.printWhen, 5000),
        hidden: band.hidden === true || !bands[key]
      };
    };
    BANDS.forEach(function (b) { d.bands[b[0]] = cleanBand(b[0]); });
    // Extra detail bands, renumbered detail2, detail3, … in their order.
    detailKeys({ bands: bands }).slice(1).forEach(function (k, i) { d.bands['detail' + (i + 2)] = cleanBand(k); });
    return d;
  }

  function sanitizeElement(e) {
    if (!e || TYPES.indexOf(e.type) < 0) return null;
    var el = newElement(e.type);
    el.id = /^[0-9a-f-]{36}$/i.test(e.id) ? e.id : uuid();
    el.x = num(e.x, 0, -5000, 14400); el.y = num(e.y, 0, -5000, 14400);
    el.width = num(e.width, 100, 0, 14400); el.height = num(e.height, 30, 0, 14400);
    el.forecolor = color(e.forecolor, '#000000'); el.backcolor = color(e.backcolor, '#FFFFFF'); el.opaque = !!e.opaque;
    el.positionType = pick(e.positionType, POSITION, ''); el.stretchType = pick(e.stretchType, STRETCH, '');
    el.printWhen = str(e.printWhen, 5000); el.key = str(e.key, 200);
    el.props = propList(e.props);
    var xa = e.xa || {};
    el.xa = { el: attrMap(xa.el), re: attrMap(xa.re), te: attrMap(xa.te), font: attrMap(xa.font) };
    if (e.type === 'staticText' || e.type === 'textField') {
      el.text = str(e.text, 20000); el.expression = str(e.expression, 20000);
      el.fontName = str(e.fontName, 60); el.fontSize = dec(e.fontSize, 0, 0, 200);
      el.bold = !!e.bold; el.italic = !!e.italic; el.underline = !!e.underline; el.strike = !!e.strike;
      el.hAlign = pick(e.hAlign, H_ALIGN, 'Left'); el.vAlign = pick(e.vAlign, V_ALIGN, 'Middle');
      el.markup = pick(e.markup, MARKUP, 'none'); el.rotation = pick(e.rotation, ROTATION, 'None');
      el.box = sanitizeBox(e.box, e.box ? null : e);
      el.pattern = str(e.pattern, 200);
      el.evaluationTime = pick(e.evaluationTime, EVAL, 'Now'); el.textAdjust = pick(e.textAdjust, TEXT_ADJUST, e.stretch ? 'StretchHeight' : 'CutText'); el.blankWhenNull = e.blankWhenNull !== false;
    } else if (e.type === 'image') {
      el.source = e.source === 'expression' ? 'expression' : 'resource';
      el.resource = str(e.resource, 120).replace(/[^A-Za-z0-9_.-]/g, '');
      el.expression = str(e.expression, 5000);
      el.scale = pick(e.scale, SCALE, 'RetainShape'); el.hAlign = pick(e.hAlign, H_ALIGN, 'Center'); el.vAlign = pick(e.vAlign, V_ALIGN, 'Middle');
      el.box = sanitizeBox(e.box, null);
    } else if (e.type === 'barcode') {
      el.kind = pick(e.kind, BARCODES, 'Code128'); el.expression = str(e.expression, 5000);
      el.textPosition = pick(e.textPosition, ['none', 'bottom', 'top'], 'bottom');
      el.moduleWidth = dec(e.moduleWidth, 1, 0.1, 10);
    } else if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'line') {
      el.lineWidth = dec(e.lineWidth, 1, 0, 20); el.lineColor = color(e.lineColor, '#000000');
      el.lineStyle = pick(e.lineStyle, LINE_STYLES, 'Solid');
      if (e.type === 'rectangle') el.radius = num(e.radius, 0, 0, 200);
      else el.direction = e.direction === 'BottomUp' ? 'BottomUp' : 'TopDown';
    } else if (e.type === 'break') {
      el.breakType = e.breakType === 'Column' ? 'Column' : 'Page';
      el.height = 1;
    } else if (e.type === 'subreport') {
      el.expression = str(e.expression, 5000);
      el.params = (Array.isArray(e.params) ? e.params : []).filter(function (p) { return p && typeof p === 'object'; }).slice(0, 100)
        .map(function (p) { return { name: str(p.name, 200).trim(), expression: str(p.expression, 5000) }; });
      el.connection = pick(e.connection, CONNECTIONS, 'connection');
      el.connExpr = str(e.connExpr, 5000);
      el.paramsMap = str(e.paramsMap, 5000);
      el.returns = (Array.isArray(e.returns) ? e.returns : []).map(rawXml).filter(Boolean).slice(0, 100);
    } else if (e.type === 'check') {
      el.kind = pick(e.kind, CHECK_KINDS, 'checkbox');
      el.state = pick(e.state, CHECK_STATES, 'unchecked');
      el.checkedWhen = str(e.checkedWhen, 5000);
      el.lineWidth = dec(e.lineWidth, 1, 0, 20);
      el.lineColor = color(e.lineColor, '#000000'); el.markColor = color(e.markColor, '#000000');
      el.props = el.props.filter(function (p) { return p[0] !== CHECK_PROP; });
    } else if (e.type === 'table') {
      el.rowSource = pick(e.rowSource, ROW_SOURCES, 'query');
      el.rowCount = num(e.rowCount, 5, 1, 200);
      el.headerShow = e.headerShow !== false;
      el.headerHeight = num(e.headerHeight, 20, 6, 500); el.rowHeight = num(e.rowHeight, 20, 6, 500);
      el.headerY = num(e.headerY, 0, 0, 5000);
      el.textAdjust = pick(e.textAdjust, TEXT_ADJUST, 'CutText'); el.headerAdjust = pick(e.headerAdjust, TEXT_ADJUST, 'CutText');
      el.headerBg = color(e.headerBg, '#D9E2F3'); el.headerColor = color(e.headerColor, '#000000');
      el.headerBold = e.headerBold !== false; el.headerAlign = pick(e.headerAlign, H_ALIGN, 'Center');
      el.rowBg = color(e.rowBg, '#FFFFFF'); el.rowColor = color(e.rowColor, '#000000');
      el.altRowBg = e.altRowBg ? color(e.altRowBg, '') : '';
      el.borderWidth = dec(e.borderWidth, 0.5, 0, 10); el.borderColor = color(e.borderColor, '#000000');
      el.borderStyle = pick(e.borderStyle, LINE_STYLES, 'Solid');
      var bs = e.borders && typeof e.borders === 'object' ? e.borders : null;
      el.borders = allBorders(true);
      if (bs) BORDER_KEYS.forEach(function (k) { el.borders[k] = bs[k] !== false && !!bs[k]; });
      el.fontName = str(e.fontName, 60); el.fontSize = dec(e.fontSize, 0, 0, 200); el.padding = num(e.padding, 2, 0, 50);
      var cols = (Array.isArray(e.columns) ? e.columns : []).filter(function (c) { return c && typeof c === 'object'; }).slice(0, 50);
      el.columns = (cols.length ? cols : [{ header: 'Column 1', width: el.width }]).map(function (c) {
        return {
          id: /^[0-9a-f-]{36}$/i.test(c.id || '') ? c.id : uuid(),
          header: str(c.header, 500), expression: str(c.expression, 5000),
          width: num(c.width, 100, 1, 5000), hAlign: pick(c.hAlign, H_ALIGN, 'Left'), pattern: str(c.pattern, 200)
        };
      });
      el.props = el.props.filter(function (p) { return p[0] !== TABLE_PROP && p[0] !== TABLE_PART_PROP; });
      normalizeTable(el);
    } else if (e.type === 'raw') {
      el.xml = rawXml(e.xml); el.tag = str(e.tag, 60).replace(/[^A-Za-z0-9:_-]/g, '');
      if (!el.xml) return null;
    }
    return el;
  }

  // ─── JRXML ──────────────────────────────────────────────────────────────────

  // Attributes written by the designer win; kept extras fill in the rest.
  function attrs(own, extra) {
    var out = '', done = {};
    own.forEach(function (a) { if (a[1] === null || a[1] === undefined || a[1] === '') return; done[a[0]] = 1; out += ' ' + a[0] + '="' + attr(a[1]) + '"'; });
    Object.keys(extra || {}).forEach(function (k) { if (!done[k]) out += ' ' + k + '="' + attr(extra[k]) + '"'; });
    return out;
  }
  function propsXml(list, ind) { return (list || []).map(function (p) { return ind + '<property name="' + attr(p[0]) + '" value="' + attr(p[1]) + '"/>'; }).join('\n'); }

  function reportElement(el, I) {
    var a = attrs([
      ['mode', el.opaque ? 'Opaque' : (el.xa.re.mode === 'Transparent' ? 'Transparent' : '')],
      ['x', el.x], ['y', el.y], ['width', el.width], ['height', el.height], ['uuid', el.id], ['key', el.key],
      ['positionType', el.positionType], ['stretchType', el.stretchType],
      ['forecolor', el.forecolor !== '#000000' ? el.forecolor : ''], ['backcolor', el.opaque || el.backcolor !== '#FFFFFF' ? el.backcolor : '']
    ], el.xa.re);
    var kids = [];
    if (el.props.length) kids.push(propsXml(el.props, I + '\t'));
    if (el.printWhen) kids.push(I + '\t<printWhenExpression>' + cdata(el.printWhen) + '</printWhenExpression>');
    return kids.length ? '<reportElement' + a + '>\n' + kids.join('\n') + '\n' + I + '</reportElement>' : '<reportElement' + a + '/>';
  }

  function penAttrs(p) { return ' lineWidth="' + p.w + '" lineStyle="' + p.s + '" lineColor="' + attr(p.c) + '"'; }
  function boxXml(box) {
    if (!box) return '';
    var pad = '', kids = '';
    SIDES.forEach(function (s) { if (box.pad[s]) pad += ' ' + s + 'Padding="' + box.pad[s] + '"'; });
    if (box.pen) kids += '<pen' + penAttrs(box.pen) + '/>';
    SIDES.forEach(function (s) { if (box.sides[s]) kids += '<' + s + 'Pen' + penAttrs(box.sides[s]) + '/>'; });
    if (!pad && !kids) return '';
    return '<box' + pad + '>' + kids + '</box>';
  }

  function textParts(el, d) {
    var font = attrs([
      ['fontName', el.fontName || d.font.name], ['size', el.fontSize || d.font.size],
      ['isBold', el.bold ? 'true' : ''], ['isItalic', el.italic ? 'true' : ''], ['isUnderline', el.underline ? 'true' : ''], ['isStrikeThrough', el.strike ? 'true' : '']
    ], el.xa.font);
    var te = attrs([
      ['textAlignment', el.hAlign], ['verticalAlignment', el.vAlign],
      ['markup', el.markup !== 'none' ? el.markup : ''], ['rotation', el.rotation !== 'None' ? el.rotation : '']
    ], el.xa.te);
    return boxXml(el.box) + '<textElement' + te + '><font' + font + '/></textElement>';
  }

  function elementXml(el, d, ind) {
    var I = ind + '\t';
    var open = function (tag, own) { return ind + '<' + tag + attrs(own, el.xa.el) + '>\n' + I + reportElement(el, I); };
    switch (el.type) {
      case 'staticText':
        return open('staticText', []) + '\n' + I + textParts(el, d) + '\n' + I + '<text>' + cdata(el.text) + '</text>\n' + ind + '</staticText>';
      case 'textField':
        return open('textField', [
          ['textAdjust', el.textAdjust !== 'CutText' ? el.textAdjust : ''], ['isBlankWhenNull', el.blankWhenNull ? 'true' : ''],
          ['pattern', el.pattern], ['evaluationTime', el.evaluationTime !== 'Now' ? el.evaluationTime : '']
        ]) + '\n' + I + textParts(el, d) + '\n' + I + '<textFieldExpression>' + cdata(el.expression || '""') + '</textFieldExpression>\n' + ind + '</textField>';
      case 'image': {
        var expr = el.source === 'resource' ? '"repo:' + el.resource + '"' : (el.expression || '""');
        var b = boxXml(el.box);
        return open('image', [['scaleImage', el.scale], ['hAlign', el.hAlign], ['vAlign', el.vAlign]]) + (b ? '\n' + I + b : '') + '\n' + I +
          '<imageExpression>' + cdata(expr) + '</imageExpression>\n' + ind + '</image>';
      }
      case 'barcode': {
        var ns = ' xmlns:jr="http://jasperreports.sourceforge.net/jasperreports/components" xsi:schemaLocation="http://jasperreports.sourceforge.net/jasperreports/components http://jasperreports.sourceforge.net/xsd/components.xsd"';
        var linear = el.kind !== 'QRCode' && el.kind !== 'DataMatrix';
        var opts = linear ? ' moduleWidth="' + el.moduleWidth + '" textPosition="' + el.textPosition + '"' : '';
        return open('componentElement', []) + '\n' + I + '<jr:' + el.kind + ns + opts + '>\n' + I + '\t<jr:codeExpression>' +
          cdata(el.expression || '""') + '</jr:codeExpression>\n' + I + '</jr:' + el.kind + '>\n' + ind + '</componentElement>';
      }
      case 'ellipse':
        return open('ellipse', []) + '\n' + I +
          '<graphicElement><pen' + penAttrs({ w: el.lineWidth, s: el.lineStyle, c: el.lineColor }) + '/></graphicElement>\n' + ind + '</ellipse>';
      case 'rectangle':
        return open('rectangle', [['radius', el.radius || '']]) + '\n' + I +
          '<graphicElement><pen' + penAttrs({ w: el.lineWidth, s: el.lineStyle, c: el.lineColor }) + '/></graphicElement>\n' + ind + '</rectangle>';
      case 'line':
        return open('line', [['direction', el.direction === 'BottomUp' ? 'BottomUp' : '']]) + '\n' + I +
          '<graphicElement><pen' + penAttrs({ w: el.lineWidth, s: el.lineStyle, c: el.lineColor }) + '/></graphicElement>\n' + ind + '</line>';
      case 'break':
        return open('break', [['type', el.breakType === 'Column' ? 'Column' : '']]) + '\n' + ind + '</break>';
      case 'check': {
        // A transparent frame (marked, so an import reads it back as a checkbox / radio) with the outline and,
        // unless unchecked, the mark: a tick of two lines, or a filled dot. "expression" prints the mark when checkedWhen is true.
        var w = el.width, h = el.height, J = I;
        var pen = function (p) { return '<graphicElement><pen' + penAttrs(p) + '/></graphicElement>'; };
        var shape = function (tag, a, extraKids, g) {
          var re = '<reportElement' + attrs(a) + (extraKids ? '>\n' + J + '\t' + extraKids + '\n' + J + '</reportElement>' : '/>');
          return J + '<' + tag + '>\n' + J + '\t' + re.replace(/\n/g, '\n\t') + '\n' + J + '\t' + g + '\n' + J + '</' + tag + '>';
        };
        var when = el.state === 'expression' ? '<printWhenExpression>' + cdata(el.checkedWhen || 'false') + '</printWhenExpression>' : '';
        var kidsXml = [shape(el.kind === 'radio' ? 'ellipse' : 'rectangle', [['mode', 'Transparent'], ['x', 0], ['y', 0], ['width', w], ['height', h], ['uuid', uuid()]], '',
          pen({ w: el.lineWidth, s: 'Solid', c: el.lineColor }))];
        if (el.state !== 'unchecked') {
          var markPen = pen({ w: Math.max(1, Math.round(el.lineWidth * 15) / 10), s: 'Solid', c: el.markColor });
          var r = function (v) { return Math.round(v); };
          if (el.kind === 'radio') {
            var ix = r(w * 0.27), iy = r(h * 0.27);
            kidsXml.push(shape('ellipse', [['mode', 'Opaque'], ['x', ix], ['y', iy], ['width', Math.max(1, w - 2 * ix)], ['height', Math.max(1, h - 2 * iy)], ['uuid', uuid()],
              ['forecolor', el.markColor], ['backcolor', el.markColor]], when, '<graphicElement><pen lineWidth="0"/></graphicElement>'));
          } else {
            // Down stroke from (20%, 50%) to (40%, 75%), up stroke from there to (80%, 25%).
            var x1 = r(w * 0.2), x2 = r(w * 0.4), x3 = r(w * 0.8), yTop = r(h * 0.25), yMid = r(h * 0.5), yLow = r(h * 0.75);
            kidsXml.push(shape('line', [['x', x1], ['y', yMid], ['width', Math.max(1, x2 - x1)], ['height', Math.max(1, yLow - yMid)], ['uuid', uuid()]], when, markPen));
            kidsXml.push(shape('line', [['x', x2], ['y', yTop], ['width', Math.max(1, x3 - x2)], ['height', Math.max(1, yLow - yTop)], ['uuid', uuid()]], when, markPen)
              .replace('<line>', '<line direction="BottomUp">'));
          }
        }
        var marked = Object.assign({}, el, { props: el.props.concat([[CHECK_PROP, el.kind]]), opaque: false });
        return ind + '<frame' + attrs([], el.xa.el) + '>\n' + I + reportElement(marked, I) + '\n' + kidsXml.join('\n') + '\n' + ind + '</frame>';
      }
      case 'subreport': {
        // Children in the order the JRXML schema wants them.
        var sub = [];
        if (el.paramsMap) sub.push(I + '<parametersMapExpression>' + cdata(el.paramsMap) + '</parametersMapExpression>');
        el.params.forEach(function (p) {
          if (!p.name) return;
          sub.push(p.expression
            ? I + '<subreportParameter name="' + attr(p.name) + '">\n' + I + '\t<subreportParameterExpression>' + cdata(p.expression) + '</subreportParameterExpression>\n' + I + '</subreportParameter>'
            : I + '<subreportParameter name="' + attr(p.name) + '"/>');
        });
        if (el.connection === 'connection') sub.push(I + '<connectionExpression>' + cdata(el.connExpr || '$P{REPORT_CONNECTION}') + '</connectionExpression>');
        else if (el.connection === 'dataSource') sub.push(I + '<dataSourceExpression>' + cdata(el.connExpr || '$P{REPORT_DATA_SOURCE}') + '</dataSourceExpression>');
        el.returns.forEach(function (x) { sub.push(I + x); });
        sub.push(I + '<subreportExpression>' + cdata(el.expression || '""') + '</subreportExpression>');
        return open('subreport', []) + '\n' + sub.join('\n') + '\n' + ind + '</subreport>';
      }
      case 'table':
        return tableXml(el, d, ind);
      case 'raw':
        // Kept as-is: only its position and size follow the design.
        return ind + el.xml.trim().replace(/<reportElement\b[^>]*?(\/?)>/, function (tag) {
          var t = tag;
          ['x', 'y', 'width', 'height'].forEach(function (k) {
            var re = new RegExp('(\\s' + k + '=")[^"]*(")');
            t = re.test(t) ? t.replace(re, '$1' + el[k] + '$2') : t.replace(/<reportElement/, '<reportElement ' + k + '="' + el[k] + '"');
          });
          return t;
        });
      default:
        return '';
    }
  }

  // ─── Table ────────────────────────────────────────────────────────────────
  // Written as plain text fields: the header cells in the Column Header band (printed at the top of each
  // page) at headerY, the row cells in the table's own band at its position (in a Detail band: a row for
  // each record; fixed rows: that many rows). Every cell carries TABLE_PART_PROP (the table's id); the first
  // row cell also carries TABLE_PROP (the settings), so an import rebuilds the table from them.
  var tableName = function (el) { return TABLE_PREFIX + String(el.id).replace(/[^0-9a-f]/gi, '').slice(0, 12); };
  // Every table of the design with its band, in band order.
  function designTables(d) {
    var list = [];
    bandList(d).forEach(function (b) {
      if (d.bands[b[0]].hidden) return;
      d.bands[b[0]].elements.forEach(function (el) { if (el.type === 'table') list.push({ el: el, band: b[0] }); });
    });
    return list;
  }
  // The row style of each table with alternating colors: every second record (REPORT_COUNT) gets altRowBg.
  function tableHead(d) {
    var styles = [];
    designTables(d).forEach(function (t) {
      var el = t.el;
      if (el.rowSource !== 'query' || !el.altRowBg || el.altRowBg === el.rowBg) return;
      styles.push('<style name="' + tableName(el) + '_Row" mode="Opaque" backcolor="' + el.rowBg + '">\n\t\t<conditionalStyle>\n' +
        '\t\t\t<conditionExpression><![CDATA[$V{REPORT_COUNT} % 2 == 0]]></conditionExpression>\n' +
        '\t\t\t<style mode="Opaque" backcolor="' + el.altRowBg + '"/>\n\t\t</conditionalStyle>\n\t</style>');
    });
    return { styles: styles, datasets: [] };
  }
  var javaString = function (s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"'; };
  // One cell: a text field (so Text adjust applies to it too).
  function tableCell(el, d, ind, c) {
    var I = ind + '\t', font = attrs([['fontName', el.fontName || d.font.name], ['size', el.fontSize || d.font.size], ['isBold', c.bold ? 'true' : '']]);
    var pad = el.padding ? ['top', 'left', 'bottom', 'right'].map(function (s) { return ' ' + s + 'Padding="' + el.padding + '"'; }).join('') : '';
    var pen = ' lineWidth="' + el.borderWidth + '" lineStyle="' + el.borderStyle + '" lineColor="' + el.borderColor + '"/>';
    var sides = c.sides || {};
    var box = '<box' + pad + '>' + ['top', 'left', 'bottom', 'right'].map(function (sd) { return sides[sd] ? '<' + sd + 'Pen' + pen : ''; }).join('') + '</box>';
    var props = [[TABLE_PART_PROP, el.id]].concat(c.settings ? [[TABLE_PROP, c.settings]] : []);
    var re = '<reportElement' + attrs([
      ['style', c.style], ['mode', c.bg ? 'Opaque' : ''], ['x', c.x], ['y', c.y], ['width', c.w], ['height', c.h], ['uuid', uuid()],
      ['stretchType', c.adjust === 'StretchHeight' ? 'RelativeToTallestObject' : ''],
      ['forecolor', c.color && c.color !== '#000000' ? c.color : ''], ['backcolor', c.bg]
    ]) + '>\n' + propsXml(props, I + '\t') + '\n' + I + '</reportElement>';
    return ind + '<textField' + attrs([['textAdjust', c.adjust !== 'CutText' ? c.adjust : ''], ['isBlankWhenNull', 'true'], ['pattern', c.pattern]]) + '>\n' +
      I + re + '\n' + I + box + '<textElement textAlignment="' + c.align + '" verticalAlignment="Middle"><font' + font + '/></textElement>\n' +
      I + '<textFieldExpression>' + cdata(c.expr || '""') + '</textFieldExpression>\n' + ind + '</textField>';
  }
  // The row cells, in the table's band.
  function tableXml(el, d, ind) {
    var out = [], x, styled = el.rowSource === 'query' && el.altRowBg && el.altRowBg !== el.rowBg;
    var settings = JSON.stringify(tableSettings(el));
    for (var r = 0; r < tableRows(el); r++) {
      x = el.x;
      el.columns.forEach(function (c, i) {
        var bg = styled ? '' : (el.rowSource === 'fixed' && el.altRowBg && r % 2 === 1 ? el.altRowBg : (el.rowBg !== '#FFFFFF' ? el.rowBg : ''));
        out.push(tableCell(el, d, ind, {
          sides: tableCellSides(el, 'row', i, el.columns.length, r, tableRows(el)),
          x: x, y: el.y + r * el.rowHeight, w: c.width, h: el.rowHeight, expr: c.expression, pattern: c.pattern, align: c.hAlign,
          adjust: el.textAdjust, color: el.rowColor, bg: bg, style: styled ? tableName(el) + '_Row' : '', settings: r === 0 && i === 0 ? settings : ''
        }));
        x += c.width;
      });
    }
    return out.join('\n');
  }
  // The header cells, for the Column Header band.
  function tableHeaderXml(el, d, ind) {
    var x = el.x;
    return el.columns.map(function (c, i) {
      var cell = tableCell(el, d, ind, {
        sides: tableCellSides(el, 'header', i, el.columns.length),
        x: x, y: el.headerY, w: c.width, h: el.headerHeight, expr: javaString(c.header), align: el.headerAlign, bold: el.headerBold,
        adjust: el.headerAdjust, color: el.headerColor, bg: el.headerBg
      });
      x += c.width;
      return cell;
    }).join('\n');
  }
  // What the table property keeps (read back on import).
  function tableSettings(el) {
    var out = {};
    ['rowSource', 'rowCount', 'headerShow', 'headerHeight', 'headerY', 'rowHeight', 'headerBg', 'headerColor', 'headerBold', 'headerAlign', 'headerAdjust',
      'rowBg', 'altRowBg', 'rowColor', 'textAdjust', 'borderWidth', 'borderColor', 'borderStyle', 'borders', 'fontName', 'fontSize', 'padding', 'columns'].forEach(function (k) { out[k] = el[k]; });
    return out;
  }

  // A report without a query gets no rows on JasperServer, so its Detail bands never print (a blank
  // page). For JasperServer (opts.server) it is given this query, one record from a collection every
  // Centrix site has, like the Print-Out Builder's reports. The JRXML download keeps no query.
  var ONE_ROW_QUERY = "{\n\t\t\trunCommand: {\n\t\t\t\taggregate: 'users',\n\t\t\t\tpipeline: [ { $limit: 1 }, { $project: { _id: 1 } } ]\n\t\t\t}\n\t\t}";
  function toJrxml(input, opts) {
    var d = sanitize(input);
    if (opts && opts.server && !d.query.trim()) {
      d.query = ONE_ROW_QUERY;
      d.properties = d.properties.concat([['com.centrix.designer.oneRowQuery', 'true']]);
    }
    var out = [];
    var top = attrs([
      ['name', d.name], ['language', d.attrs.language], ['pageWidth', d.page.width], ['pageHeight', d.page.height],
      ['orientation', d.page.orientation === 'landscape' ? 'Landscape' : ''],
      ['columnCount', d.attrs.columnCount], ['printOrder', d.attrs.printOrder], ['columnDirection', d.attrs.columnDirection],
      ['whenNoDataType', d.attrs.whenNoDataType], ['sectionType', d.attrs.sectionType],
      ['columnWidth', columnWidth(d)], ['columnSpacing', d.attrs.columnSpacing],
      ['leftMargin', d.page.margins.left], ['rightMargin', d.page.margins.right], ['topMargin', d.page.margins.top], ['bottomMargin', d.page.margins.bottom]
    ], (function () { var rest = {}; REPORT_ATTRS.forEach(function (k) { if (d.attrs[k] != null && ['language', 'columnCount', 'printOrder', 'columnDirection', 'whenNoDataType', 'sectionType', 'columnSpacing'].indexOf(k) < 0) rest[k] = d.attrs[k]; }); return rest; })());
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<!-- Created with Centrix HIS Helper Tools: Jasper Designer -->');
    out.push('<jasperReport xmlns="http://jasperreports.sourceforge.net/jasperreports" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xsi:schemaLocation="http://jasperreports.sourceforge.net/jasperreports http://jasperreports.sourceforge.net/xsd/jasperreport.xsd"' + top + ' uuid="' + (d.uuid || uuid()) + '">');
    var props = d.properties.slice();
    if (!props.some(function (p) { return p[0] === 'com.jaspersoft.studio.unit.'; })) props.push(['com.jaspersoft.studio.unit.', 'pixel']);
    if (hasWatermark(d)) props.push([WATERMARK_PROP, JSON.stringify(d.watermark)]);     // read back on import
    if (props.length) out.push(propsXml(props, '\t'));
    // Kept head, with each table's row style and dataset where the JRXML schema wants them:
    // import / template / reportFont, then styles, then subDatasets, then scriptlets.
    var tables = tableHead(d), headOf = function (x) { var m = /^<([A-Za-z]+)/.exec(x); return m ? m[1] : ''; };
    var rank = { style: 1, subDataset: 2, scriptlet: 3 };
    var head = d.raw.head.map(function (x, i) { return { x: x, r: rank[headOf(x)] || 0, i: i }; })
      .concat(tables.styles.map(function (x, i) { return { x: x, r: 1, i: 1e6 + i }; }));
    head.sort(function (a, b) { return a.r - b.r || a.i - b.i; }).forEach(function (h) { out.push('\t' + h.x); });
    d.params.forEach(function (p) {
      var kids = (p.props.length ? propsXml(p.props, '\t\t') + '\n' : '') +
        (p.desc ? '\t\t<parameterDescription>' + cdata(p.desc) + '</parameterDescription>\n' : '') +
        (p.def ? '\t\t<defaultValueExpression>' + cdata(p.def) + '</defaultValueExpression>\n' : '');
      var a = ' name="' + attr(p.name) + '" class="' + attr(p.cls) + '"' + (p.prompt ? '' : ' isForPrompting="false"');
      out.push(kids ? '\t<parameter' + a + '>\n' + kids + '\t</parameter>' : '\t<parameter' + a + '/>');
    });
    if (d.query.trim()) out.push('\t<queryString language="' + attr(d.language) + '">\n\t\t' + cdata(d.query) + '\n\t</queryString>');
    d.fields.forEach(function (f) {
      var kids = (f.props.length ? propsXml(f.props, '\t\t') + '\n' : '') + (f.desc ? '\t\t<fieldDescription>' + cdata(f.desc) + '</fieldDescription>\n' : '');
      var a = ' name="' + attr(f.name) + '" class="' + attr(f.cls) + '"';
      out.push(kids ? '\t<field' + a + '>\n' + kids + '\t</field>' : '\t<field' + a + '/>');
    });
    d.sortFields.forEach(function (s) { out.push('\t<sortField name="' + attr(s.name) + '"' + (s.order === 'Descending' ? ' order="Descending"' : '') + (s.type === 'Variable' ? ' type="Variable"' : '') + '/>'); });
    d.raw.variables.forEach(function (x) { out.push('\t' + x); });
    if (d.filterExpression.trim()) out.push('\t<filterExpression>' + cdata(d.filterExpression) + '</filterExpression>');
    d.raw.groups.forEach(function (x) { out.push('\t' + x); });
    out.push(backgroundXml(d));
    var bandInner = function (key) {
      var band = d.bands[key];
      if (!band || band.hidden || (band.height === 0 && !band.elements.length)) return '';
      var kids = [];
      if (band.props.length) kids.push(propsXml(band.props, '\t\t\t'));
      if (band.printWhen) kids.push('\t\t\t<printWhenExpression>' + cdata(band.printWhen) + '</printWhenExpression>');
      band.elements.forEach(function (el) { var x = elementXml(el, d, '\t\t\t'); if (x) kids.push(x); });
      if (key === 'columnHeader') designTables(d).forEach(function (t) { if (t.el.headerShow) kids.push(tableHeaderXml(t.el, d, '\t\t\t')); });
      return '\t\t<band height="' + band.height + '" splitType="' + band.splitType + '"' + (kids.length ? '>\n' + kids.join('\n') + '\n\t\t</band>' : '/>');
    };
    var bandXml = function (key) {
      // The Detail section holds Detail 1, Detail 2, … one after another.
      var inner = (key === 'detail' ? detailKeys(d) : [key]).map(bandInner).filter(Boolean);
      if (inner.length) out.push('\t<' + key + '>\n' + inner.join('\n') + '\n\t</' + key + '>');
    };
    ['title', 'pageHeader', 'columnHeader', 'detail', 'columnFooter', 'pageFooter'].forEach(bandXml);
    var lpf = d.bands.lastPageFooter;
    if (d.raw.lastPageFooter && (lpf.hidden || (!lpf.height && !lpf.elements.length))) out.push('\t' + d.raw.lastPageFooter);
    else bandXml('lastPageFooter');
    bandXml('summary');
    if (d.raw.noData) out.push('\t' + d.raw.noData);
    out.push('</jasperReport>');
    return out.join('\n') + '\n';
  }

  // Problems that stop a report from compiling (errors) and things worth a look (warnings).
  function check(input) {
    var d = sanitize(input);
    var errors = [], warnings = [];
    // targets: message -> what it is about, for the designer's Problems panel ({ id, band } of an element,
    // { band } of a band, or { dataset: tab } of the Dataset and Query dialog). "at" is what is being checked.
    var targets = {}, at = null;
    var note = function (list, text) { list.push(text); if (at && !targets[text]) targets[text] = at; };
    var err = function (text) { note(errors, text); }, warn = function (text) { note(warnings, text); };
    // loops: errors that make JasperServer loop creating new pages (or run the report inside itself) until it
    // runs out of memory, instead of failing; publish, deploy and preview refuse a design with any of them.
    var loops = [];
    var loop = function (text) { err(text); loops.push(text); };
    // A report with "Ignore pagination" is one long page: nothing has to fit a page and nothing makes new pages.
    var paged = d.attrs.isIgnorePagination !== 'true';
    // A subreport expression that names this report: "repo:Name.jrxml", "/Folder/Name", "Name.jasper", …
    // (only a plain string can be checked; an expression built at run time is not).
    var isSelf = function (expr) {
      var m = /^\s*"([^"]+)"\s*$/.exec(expr || '');
      if (!m) return false;
      var last = m[1].replace(/^repo:/i, '').split('/').pop().replace(/\.(jrxml|jasper)$/i, '');
      return last.toLowerCase() === d.name.toLowerCase();
    };
    var u = bandUsage(d);
    var hb = function (k) { return d.bands[k] && !d.bands[k].hidden ? d.bands[k].height : 0; };
    var foot = Math.max(hb('pageFooter'), hb('lastPageFooter'));
    var detailRoom = u.available - hb('pageHeader') - hb('columnHeader') - hb('columnFooter') - foot;
    if (paged) pageFit();
    function pageFit() {
    if (u.perPage > u.available) err('The page header, column header, detail, column footer and page footer (or last page footer) bands are ' + u.perPage + ' px high, more than the ' + u.available + ' px between the top and bottom margins.');
    // The title shares the first page with the page header and footer (unless it has a page of its own).
    var titleRoom = u.available - (d.attrs.isTitleNewPage === 'true' ? 0 : hTitleBands(d));
    at = { band: 'title' };
    if (d.bands.title && !d.bands.title.hidden && d.bands.title.height > titleRoom) err('Title is ' + d.bands.title.height + ' px high, more than the ' + titleRoom + ' px a page has for it. Use a page break in it, or move part of it into a detail band.');
    // A band never breaks across pages by its fixed height: each must fit on a page with what prints around it.
    bandList(d).forEach(function (b) {
      at = { band: b[0] };
      if (b[0].indexOf('detail') === 0 && hb(b[0]) > detailRoom) err(b[1] + ' is ' + hb(b[0]) + ' px high, more than the ' + detailRoom + ' px a page has for it. Split it into more detail bands (add one in Sections) or use page breaks.');
    });
    var summaryRoom = u.available - (d.attrs.isSummaryWithPageHeaderAndFooter === 'true' ? hb('pageHeader') + foot : 0);
    at = { band: 'summary' };
    if (hb('summary') > summaryRoom) err('Summary is ' + hb('summary') + ' px high, more than the ' + summaryRoom + ' px of a page. Move part of it into detail bands.');
    at = null;
    // Groups (kept as JRXML): a reprinted group header, or "start a new page when less than N px is left",
    // that can never be met on an empty page makes JasperServer loop.
    var tallestDetail = Math.max.apply(null, detailKeys(d).map(hb));
    d.raw.groups.forEach(function (x) {
      var name = (/\bname="([^"]+)"/.exec(x) || [])[1] || 'a group';
      var bandH = function (sect) {
        var m = new RegExp('<' + sect + '>[\\s\\S]*?</' + sect + '>').exec(x), h = 0;
        if (m) m[0].replace(/<band\b[^>]*\bheight="(\d+)"/g, function (all, n) { h += +n; return all; });
        return h;
      };
      var min = +((/\bminHeightToStartNewPage="(\d+)"/.exec(x) || [])[1] || 0);
      if (min > detailRoom) loop('Group "' + name + '" starts a new page when less than ' + min + ' px is left, but an empty page only has ' + detailRoom + ' px. JasperServer would keep making new pages ("Infinite loop creating new page"). Make "min height to start new page" ' + detailRoom + ' or less (in Source).');
      if (/\bisReprintHeaderOnEachPage="true"/.test(x)) {
        var gh = bandH('groupHeader');
        if (gh + tallestDetail > detailRoom) loop('Group "' + name + '" prints its ' + gh + ' px header again on each page, and with the ' + tallestDetail + ' px detail that is more than the ' + detailRoom + ' px a page has. JasperServer would keep making new pages ("Infinite loop creating new page"). Make the header or the detail lower, or turn off "reprint header on each page" (in Source).');
      }
    });
    }
    var cw = columnWidth(d);
    var refs = { F: {}, P: {}, V: { PAGE_NUMBER: 1, COLUMN_NUMBER: 1, REPORT_COUNT: 1, PAGE_COUNT: 1, COLUMN_COUNT: 1 } };
    d.fields.forEach(function (f) { refs.F[f.name] = 1; });
    d.params.forEach(function (p) { refs.P[p.name] = 1; });
    ['REPORT_PARAMETERS_MAP', 'REPORT_CONNECTION', 'REPORT_DATA_SOURCE', 'REPORT_LOCALE', 'REPORT_TIME_ZONE', 'REPORT_RESOURCE_BUNDLE', 'REPORT_SCRIPTLET', 'REPORT_MAX_COUNT', 'REPORT_VIRTUALIZER', 'IS_IGNORE_PAGINATION', 'REPORT_FORMAT_FACTORY', 'REPORT_CONTEXT', 'JASPER_REPORTS_CONTEXT', 'JASPER_REPORT', 'FILTER', 'SORT_FIELDS', 'REPORT_TEMPLATES', 'REPORT_CLASS_LOADER', 'REPORT_URL_HANDLER_FACTORY', 'REPORT_FILE_RESOLVER', 'LoggedInUser', 'LoggedInUsername', 'LoggedInUserTenantId', 'LoggedInUserAttributes']
      .forEach(function (n) { refs.P[n] = 1; });
    d.raw.variables.forEach(function (x) { var m = /name="([^"]+)"/.exec(x); if (m) refs.V[m[1]] = 1; });
    d.raw.groups.forEach(function (x) { var m = /name="([^"]+)"/.exec(x); if (m) refs.V[m[1] + '_COUNT'] = 1; });
    var scan = function (expr, label) {
      String(expr || '').replace(/\$([FPV])!?\{([^}]+)\}/g, function (m, k, n) {
        if (!refs[k][n]) err(label + ' uses ' + m + ', which is not defined.');
        return m;
      });
    };
    at = { dataset: 'fields' };
    scan(d.query, 'The query');
    at = { dataset: 'filter' };
    scan(d.filterExpression, 'The filter expression');
    at = { dataset: 'sortFields' };
    d.sortFields.forEach(function (s) { if (s.type === 'Field' && !refs.F[s.name]) err('Sorting uses the field "' + s.name + '", which is not defined.'); });
    bandList(d).forEach(function (b) {
      at = null;
      if (d.bands[b[0]].hidden) {
        var n = d.bands[b[0]].elements.length;
        if (n) warn(b[1] + ' is inactive: its ' + n + ' element' + (n > 1 ? 's are' : ' is') + ' kept but not in the report.');
        return;
      }
      d.bands[b[0]].elements.forEach(function (el) {
        at = { id: el.id, band: b[0] };
        var label = b[1] + ': ' + (el.type === 'staticText' ? '"' + el.text.slice(0, 24) + '"' : el.type === 'textField' ? el.expression.slice(0, 30) : el.type === 'check' ? el.kind : el.type);
        if (el.y + el.height > d.bands[b[0]].height) err(label + ' sticks out of the bottom of its band.');
        if (el.x < 0 || el.y < 0) err(label + ' starts outside its band.');
        // Bands printed on every page (headers, footers) can't break or grow onto another page: a break in
        // one starts a page that prints it again, and content that outgrows the page does the same.
        var fixed = paged && FIXED_BANDS.indexOf(b[0]) >= 0;
        if (fixed && (el.type === 'break' || (el.type === 'raw' && /<break\b/.test(el.xml)))) {
          loop(b[1] + ': a page break here starts a new page, which prints ' + b[1] + ' again. JasperServer would keep making new pages ("Infinite loop creating new page"). Move the break into a detail band, the title or the summary.');
        }
        if (fixed && el.type === 'textField' && el.textAdjust === 'StretchHeight') {
          warn(label + ' can grow (Text adjust StretchHeight) in ' + b[1] + ', which is printed on every page and can\'t continue on the next one. If the text outgrows the page, JasperServer stops with "Infinite loop creating new page". Use CutText or ScaleFont here.');
        }
        if (el.type === 'subreport' && isSelf(el.expression)) {
          loop(label + ' runs this same report (' + el.expression.trim() + '), so it would run itself again and again until JasperServer runs out of memory. Point it at another report.');
        }
        else if (el.x + el.width > cw) warn(label + ' is ' + (el.x + el.width - cw) + ' px wider than the printable width.');
        var expr = el.type === 'textField' || el.type === 'barcode' || (el.type === 'image' && el.source === 'expression') ? el.expression : '';
        scan(expr, label);
        scan(el.printWhen, label + ' (print when)');
        if (el.type === 'image' && el.source === 'resource' && !el.resource) err(label + ' has no image chosen.');
        if (el.type === 'check' && el.state === 'expression') {
          if (!el.checkedWhen.trim()) err(label + ' is checked by an expression, but the expression is empty.');
          scan(el.checkedWhen, label + ' (checked when)');
        }
        if (el.type === 'table') {
          el.columns.forEach(function (c, i) {
            var cl = label + ' column ' + (i + 1) + (c.header ? ' "' + c.header.slice(0, 20) + '"' : '');
            if (el.rowSource === 'fixed' && /\$F\{/.test(c.expression)) err(cl + ' uses a field, but the table has fixed blank rows (no data). Use "Rows from the report query", or leave the cell empty.');
            else scan(c.expression, cl);
          });
          // The header prints in the Column Header band.
          var ch = d.bands.columnHeader;
          if (el.headerShow && (!ch || ch.hidden || !ch.height)) err(label + ': its header prints in the Column Header section, which is off. Turn Column Header on (Outline) or hide the table header.');
          else if (el.headerShow && el.headerY + el.headerHeight > ch.height) err(label + ': its header (' + el.headerY + ' + ' + el.headerHeight + ' px) sticks out of the ' + ch.height + ' px Column Header band.');
          if (el.headerShow && paged && el.headerAdjust === 'StretchHeight') warn(label + ': the header can grow (StretchHeight) in Column Header, which is printed on every page. A header that outgrows the page makes JasperServer loop; use CutText or ScaleFont.');
          if (el.rowSource === 'query' && !d.query.trim()) warn(label + ': its rows come from the report query, which is empty. Set it in Dataset & Query, or use fixed rows.');
          if (el.rowSource === 'query' && b[0].indexOf('detail') !== 0) warn(label + ' is in ' + b[1] + ': its row prints once there. Put it in a Detail band to get a row for each record.');
          if (el.rowSource === 'fixed' && b[0].indexOf('detail') === 0) warn(label + ' has fixed blank rows in ' + b[1] + ', so they print again for every record. Put it in the Title or Summary for one set of rows.');
          if (fixed && el.textAdjust === 'StretchHeight') warn(label + ' can grow (StretchHeight) in ' + b[1] + ', which is printed on every page. Use CutText or ScaleFont here.');
        }
        if (el.type === 'subreport') {
          if (!el.expression.trim()) err(label + ' has no subreport expression (the report to run).');
          scan(el.expression, label);
          scan(el.paramsMap, label + ' (parameters map)');
          if (el.connection !== 'none') scan(el.connExpr, label + ' (' + (el.connection === 'dataSource' ? 'data source' : 'connection') + ')');
          var names = {};
          el.params.forEach(function (p) {
            if (!NAME_RE.test(p.name)) err(label + ' has a parameter without a valid name' + (p.name ? ' ("' + p.name + '")' : '') + '.');
            else if (names[p.name]) err(label + ' passes the parameter "' + p.name + '" twice.');
            names[p.name] = true;
            scan(p.expression, label + ' (parameter ' + p.name + ')');
          });
        }
      });
    });
    var dedupe = function (list) { var s = {}; return list.filter(function (x) { return !s[x] && (s[x] = true); }); };
    return { errors: dedupe(errors), warnings: dedupe(warnings), targets: targets, loops: dedupe(loops) };
  }
  function problems(input) { return check(input).errors; }
  function loops(input) { return check(input).loops; }      // the errors publish, deploy and preview refuse

  // A parameter's default value expression as the text to type in a run form: "abc", 5, 5L,
  // new Integer(5), Integer.valueOf("5"), new BigDecimal("1.5"), true, Boolean.TRUE. Anything
  // computed ($P{…}, new Date(), "a" + "b") or null gives null.
  function defaultValue(expr) {
    var s = String(expr == null ? '' : expr).trim(), m;
    for (var i = 0; i < 4; i++) {      // unwrap new X(…) / X.valueOf(…) a few levels deep
      m = /^(?:new\s+[\w.]+|[\w.]+\.valueOf)\s*\(([\s\S]*)\)$/.exec(s);
      if (!m) break;
      s = m[1].trim();
    }
    if ((m = /^"((?:[^"\\]|\\.)*)"$/.exec(s))) {
      return m[1].replace(/\\(u[0-9a-fA-F]{4}|.)/g, function (all, c) {
        if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
        return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[c] || c;
      });
    }
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[LlFfDd]?$/.test(s)) return s.replace(/[LlFfDd]$/, '');
    if ((m = /^(?:(?:java\.lang\.)?Boolean\.)?(true|false|TRUE|FALSE)$/.exec(s))) return m[1].toLowerCase();
    return null;
  }

  return {
    BANDS: BANDS, DETAIL_RE: DETAIL_RE, MAX_DETAIL: MAX_DETAIL, bandList: bandList, detailKeys: detailKeys, pagesToDetailBands: pagesToDetailBands, PAGES: PAGES, TYPES: TYPES, BARCODES: BARCODES, H_ALIGN: H_ALIGN, V_ALIGN: V_ALIGN, SCALE: SCALE,
    EVAL: EVAL, TEXT_ADJUST: TEXT_ADJUST, CLASSES: CLASSES, FONTS: FONTS, NAME_RE: NAME_RE, CLASS_RE: CLASS_RE, LINE_STYLES: LINE_STYLES,
    POSITION: POSITION, STRETCH: STRETCH, MARKUP: MARKUP, ROTATION: ROTATION, LANGUAGES: LANGUAGES, WHEN_NO_DATA: WHEN_NO_DATA,
    REPORT_ATTRS: REPORT_ATTRS, SIDES: SIDES, CONNECTIONS: CONNECTIONS,
    CHECK_KINDS: CHECK_KINDS, CHECK_STATES: CHECK_STATES, CHECK_PROP: CHECK_PROP,
    uuid: uuid, newDesign: newDesign, newElement: newElement, emptyBox: emptyBox, columnWidth: columnWidth, bandUsage: bandUsage,
    sanitize: sanitize, toJrxml: toJrxml, problems: problems, loops: loops, check: check, defaultValue: defaultValue,
    TABLE_PROP: TABLE_PROP, TABLE_PART_PROP: TABLE_PART_PROP, TABLE_PREFIX: TABLE_PREFIX, ROW_SOURCES: ROW_SOURCES,
    newColumn: newColumn, fitTable: fitTable, normalizeTable: normalizeTable, tableRows: tableRows,
    BORDER_KEYS: BORDER_KEYS, applyBorders: applyBorders, tableCellSides: tableCellSides,
    WATERMARK_IMAGE: WATERMARK_IMAGE, WATERMARK_PROP: WATERMARK_PROP, WATERMARK_EL_PROP: WATERMARK_EL_PROP,
    defaultWatermark: defaultWatermark, sanitizeWatermark: sanitizeWatermark, hasWatermark: hasWatermark, watermarkBox: watermarkBox
  };
});
