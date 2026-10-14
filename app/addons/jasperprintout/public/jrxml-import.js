// Jasper Designer: JRXML → design (browser only: DOMParser). Everything the designer models becomes
// editable; what it does not model is kept (extra attributes, <property> elements, variables,
// groups, styles, …) and written back by jrxml-design.js, so a report survives a round trip.
(function () {
  'use strict';
  var JD = window.JrxmlDesign;

  // Attributes the designer reads into its own settings; any other attribute is kept as-is.
  var MODELED = {
    el: { textField: ['textAdjust', 'isStretchWithOverflow', 'isBlankWhenNull', 'pattern', 'evaluationTime'], image: ['scaleImage', 'hAlign', 'vAlign'], rectangle: ['radius'], line: ['direction'] },
    re: ['mode', 'x', 'y', 'width', 'height', 'uuid', 'key', 'positionType', 'stretchType', 'forecolor', 'backcolor'],
    te: ['textAlignment', 'verticalAlignment', 'markup', 'rotation'],
    font: ['fontName', 'size', 'isBold', 'isItalic', 'isUnderline', 'isStrikeThrough']
  };
  // Child elements each element type may have; anything else makes it a kept (raw) element.
  var CHILDREN = {
    staticText: ['reportElement', 'box', 'textElement', 'text'],
    textField: ['reportElement', 'box', 'textElement', 'textFieldExpression'],
    image: ['reportElement', 'box', 'graphicElement', 'imageExpression'],
    rectangle: ['reportElement', 'graphicElement'],
    ellipse: ['reportElement', 'graphicElement'],
    line: ['reportElement', 'graphicElement'],
    break: ['reportElement'],
    subreport: ['reportElement', 'parametersMapExpression', 'subreportParameter', 'connectionExpression', 'dataSourceExpression', 'returnValue', 'subreportExpression'],
    componentElement: ['reportElement']
  };

  function parse(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not valid XML.');
    var root = doc.documentElement;
    if (!root || root.localName !== 'jasperReport') throw new Error('This file is not a JasperReports JRXML (no <jasperReport>).');

    var serializer = new XMLSerializer();
    var A = function (el, n, d) { var v = el.getAttribute(n); return v === null ? d : v; };
    var N = function (el, n, d) { var v = parseFloat(el.getAttribute(n)); return isFinite(v) ? v : d; };
    var kids = function (el, name) { return Array.prototype.filter.call(el.children, function (c) { return !name || c.localName === name; }); };
    var first = function (el, name) { return kids(el, name)[0] || null; };
    var textOf = function (el) { return el ? el.textContent : ''; };
    // Serialized without the namespace declarations the serializer adds to a lone element.
    var xmlOf = function (el) {
      return serializer.serializeToString(el)
        .replace(/\sxmlns="http:\/\/jasperreports\.sourceforge\.net\/jasperreports"/g, '')
        .replace(/\sxmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"/g, '');
    };
    var extra = function (el, skip) {
      var out = {};
      if (!el) return out;
      Array.prototype.forEach.call(el.attributes, function (a) {
        if (skip.indexOf(a.name) < 0 && a.name.indexOf('xmlns') !== 0) out[a.name] = a.value;
      });
      return out;
    };
    var props = function (el) { return el ? kids(el, 'property').map(function (p) { return [A(p, 'name', ''), A(p, 'value', '')]; }) : []; };
    var pen = function (p) { return p ? { w: N(p, 'lineWidth', 1), s: A(p, 'lineStyle', 'Solid'), c: A(p, 'lineColor', '#000000') } : null; };

    var warnings = [];
    var d = JD.newDesign(A(root, 'name', 'Imported_Report'));
    var w = N(root, 'pageWidth', 595), h = N(root, 'pageHeight', 842);
    var size = 'Custom';
    Object.keys(JD.PAGES).forEach(function (k) {
      var p = JD.PAGES[k];
      if ((p[0] === w && p[1] === h) || (p[1] === w && p[0] === h)) size = k;
    });
    d.page = {
      size: size, orientation: A(root, 'orientation', w > h ? 'Landscape' : 'Portrait') === 'Landscape' ? 'landscape' : 'portrait', width: w, height: h,
      margins: { top: N(root, 'topMargin', 20), right: N(root, 'rightMargin', 20), bottom: N(root, 'bottomMargin', 20), left: N(root, 'leftMargin', 20) }
    };
    JD.REPORT_ATTRS.forEach(function (k) { if (root.hasAttribute(k)) d.attrs[k] = root.getAttribute(k); });
    d.uuid = A(root, 'uuid', '');
    d.properties = props(root);

    ['import', 'template', 'reportFont', 'style', 'subDataset', 'scriptlet'].forEach(function (tag) {
      kids(root, tag).forEach(function (el) {
        // A designer table's dataset and row style are written again from the table
        if ((tag === 'style' || tag === 'subDataset') && A(el, 'name', '').indexOf(JD.TABLE_PREFIX) === 0) return;
        d.raw.head.push(xmlOf(el));
      });
    });
    kids(root, 'parameter').forEach(function (p) {
      if (A(p, 'isSystemDefined', 'false') === 'true') return;
      d.params.push({
        name: A(p, 'name', ''), cls: A(p, 'class', 'java.lang.String'),
        def: textOf(first(p, 'defaultValueExpression')).trim(), desc: textOf(first(p, 'parameterDescription')).trim(),
        prompt: A(p, 'isForPrompting', 'true') !== 'false', props: props(p)
      });
    });
    var q = first(root, 'queryString');
    // The one-record query added on publish to a report without one (JD.toJrxml server option): not part of the design.
    var oneRow = d.properties.some(function (p) { return p[0] === 'com.centrix.designer.oneRowQuery'; });
    d.properties = d.properties.filter(function (p) { return p[0] !== 'com.centrix.designer.oneRowQuery'; });
    if (oneRow) q = null;
    if (q) {
      d.query = textOf(q).replace(/^\s*\n/, '').replace(/\s+$/, '');
      var lang = A(q, 'language', 'sql');
      if (lang.toLowerCase() !== 'mongodbquery') warnings.push('The query was written in "' + lang + '". The designer works with MongoDB reports only, so it is written back as MongoDbQuery; rewrite it for MongoDB.');
    }
    kids(root, 'field').forEach(function (f) {
      d.fields.push({ name: A(f, 'name', ''), cls: A(f, 'class', 'java.lang.Object'), desc: textOf(first(f, 'fieldDescription')).trim(), props: props(f) });
    });
    kids(root, 'sortField').forEach(function (s) { d.sortFields.push({ name: A(s, 'name', ''), order: A(s, 'order', 'Ascending'), type: A(s, 'type', 'Field') }); });
    kids(root, 'variable').forEach(function (v) { d.raw.variables.push(xmlOf(v)); });
    d.filterExpression = textOf(first(root, 'filterExpression')).trim();
    kids(root, 'group').forEach(function (g) { d.raw.groups.push(xmlOf(g)); });
    if (d.raw.groups.length) warnings.push(d.raw.groups.length + ' group' + (d.raw.groups.length > 1 ? 's are' : ' is') + ' kept as written; edit them in Source.');
    if (d.raw.variables.length) warnings.push(d.raw.variables.length + ' variable' + (d.raw.variables.length > 1 ? 's are' : ' is') + ' kept as written; edit them in Source.');
    // Our watermark: its settings are a report property; its image in the Background band is drawn
    // again from them, so it is not kept as background XML.
    var wmProp = d.properties.filter(function (p) { return p[0] === JD.WATERMARK_PROP; })[0];
    d.properties = d.properties.filter(function (p) { return p[0] !== JD.WATERMARK_PROP; });
    if (wmProp) {
      try { d.watermark = JD.sanitizeWatermark(JSON.parse(wmProp[1])); } catch (e) { warnings.push('The watermark settings could not be read; set them again in Report properties.'); }
    }
    var bg = first(root, 'background');
    if (bg) {
      [].slice.call(bg.getElementsByTagNameNS('*', 'image')).forEach(function (img) {
        var re = first(img, 'reportElement');
        var mine = re && kids(re, 'property').some(function (p) { return A(p, 'name', '') === JD.WATERMARK_EL_PROP; });
        if (!mine) return;
        var band = img.parentNode;
        band.removeChild(img);
        if (!band.children.length) band.setAttribute('height', '0');     // nothing else there: no background to keep
      });
    }
    ['background', 'noData'].forEach(function (k) {
      var el = first(root, k);
      if (el && kids(el, 'band').some(function (b) { return b.children.length || N(b, 'height', 0) > 0; })) {
        d.raw[k] = xmlOf(el);
        warnings.push('The ' + k + ' section is kept as written; edit it in Source.');
      }
    });

    var fontSeen = {}, sizeSeen = {}, resources = [], rawCount = 0;
    var base = function (el, type) {
      var re = first(el, 'reportElement');
      var e = JD.newElement(type);
      e.xa = { el: extra(el, MODELED.el[el.localName] || []), re: extra(re, MODELED.re), te: {}, font: {} };
      if (re) {
        e.x = N(re, 'x', 0); e.y = N(re, 'y', 0); e.width = N(re, 'width', 100); e.height = N(re, 'height', 30);
        var mode = A(re, 'mode', '');
        e.opaque = mode === 'Opaque';
        if (mode === 'Transparent') e.xa.re.mode = 'Transparent';
        e.forecolor = A(re, 'forecolor', '#000000'); e.backcolor = A(re, 'backcolor', '#FFFFFF');
        if (/^[0-9a-f-]{36}$/i.test(A(re, 'uuid', ''))) e.id = A(re, 'uuid', '');
        e.key = A(re, 'key', ''); e.positionType = A(re, 'positionType', ''); e.stretchType = A(re, 'stretchType', '');
        e.props = props(re);
        e.printWhen = textOf(first(re, 'printWhenExpression')).trim();
        kids(re).forEach(function (c) { if (c.localName !== 'property' && c.localName !== 'printWhenExpression') warnings.push('<' + c.localName + '> inside reportElement is not supported and was left out.'); });
      }
      return e;
    };
    var boxOf = function (el) {
      var b = JD.emptyBox(), box = first(el, 'box');
      if (!box) return b;
      var all = N(box, 'padding', 0);
      JD.SIDES.forEach(function (s) { b.pad[s] = N(box, s + 'Padding', all); b.sides[s] = pen(first(box, s + 'Pen')); });
      b.pen = pen(first(box, 'pen'));
      return b;
    };
    var textFrom = function (el, e) {
      var te = first(el, 'textElement');
      e.hAlign = te ? A(te, 'textAlignment', 'Left') : 'Left';
      e.vAlign = te ? A(te, 'verticalAlignment', 'Top') : 'Top';
      e.markup = te ? A(te, 'markup', 'none') : 'none';
      e.rotation = te ? A(te, 'rotation', 'None') : 'None';
      e.xa.te = extra(te, MODELED.te);
      var f = te && first(te, 'font');
      // Jasper's own defaults when the report does not set them.
      e.fontName = f ? A(f, 'fontName', 'SansSerif') : 'SansSerif';
      e.fontSize = f ? N(f, 'size', 10) : 10;
      e.bold = !!f && A(f, 'isBold', 'false') === 'true';
      e.italic = !!f && A(f, 'isItalic', 'false') === 'true';
      e.underline = !!f && A(f, 'isUnderline', 'false') === 'true';
      e.strike = !!f && A(f, 'isStrikeThrough', 'false') === 'true';
      e.xa.font = extra(f, MODELED.font);
      fontSeen[e.fontName] = (fontSeen[e.fontName] || 0) + 1;
      sizeSeen[e.fontSize] = (sizeSeen[e.fontSize] || 0) + 1;
      e.box = boxOf(el);
    };
    var penFrom = function (el, e) {
      var g = first(el, 'graphicElement'), p = g && first(g, 'pen');
      e.lineWidth = p ? N(p, 'lineWidth', 1) : 1;
      e.lineColor = p ? A(p, 'lineColor', '#000000') : '#000000';
      e.lineStyle = p ? A(p, 'lineStyle', 'Solid') : 'Solid';
    };
    var editable = function (el) {
      var allowed = CHILDREN[el.localName];
      if (!allowed) return false;
      if (el.localName === 'componentElement') {
        var comp = kids(el).filter(function (c) { return c.localName !== 'reportElement'; });
        return comp.length === 1 && JD.BARCODES.indexOf(comp[0].localName) >= 0 && kids(comp[0]).every(function (c) { return c.localName === 'codeExpression'; });
      }
      if (el.localName === 'subreport') {
        // Parameters with only an expression (no <property>), and one of connection / data source.
        if (first(el, 'connectionExpression') && first(el, 'dataSourceExpression')) return false;
        if (!kids(el, 'subreportParameter').every(function (p) { return kids(p).every(function (c) { return c.localName === 'subreportParameterExpression'; }); })) return false;
      }
      return kids(el).every(function (c) { return allowed.indexOf(c.localName) >= 0; });
    };
    // A checkbox / radio written by the designer: a frame marked with JD.CHECK_PROP holding the outline
    // and, when not unchecked, the mark (with a print-when when it is checked by an expression).
    var checkOf = function (el) {
      var re = first(el, 'reportElement');
      var mark = re && kids(re, 'property').filter(function (p) { return A(p, 'name', '') === JD.CHECK_PROP; })[0];
      if (el.localName !== 'frame' || !mark) return null;
      var shapes = kids(el).filter(function (c) { return c.localName !== 'reportElement'; });
      if (!shapes.length || !shapes.every(function (c) { return ['rectangle', 'ellipse', 'line'].indexOf(c.localName) >= 0; })) return null;
      var e = base(el, 'check');
      e.props = e.props.filter(function (p) { return p[0] !== JD.CHECK_PROP; });
      e.kind = A(mark, 'value', '') === 'radio' ? 'radio' : 'checkbox';
      var outline = penOf(shapes[0]);
      e.lineWidth = outline.w; e.lineColor = outline.c;
      var m = shapes[1];
      if (!m) { e.state = 'unchecked'; return e; }
      var mre = first(m, 'reportElement');
      e.markColor = m.localName === 'ellipse' ? A(mre, 'backcolor', '#000000') : penOf(m).c;
      var when = textOf(mre && first(mre, 'printWhenExpression')).trim();
      e.state = when ? 'expression' : 'checked';
      e.checkedWhen = when;
      return e;
    };
    var penOf = function (shape) {
      var g = first(shape, 'graphicElement'), p = g && first(g, 'pen');
      return { w: p ? N(p, 'lineWidth', 1) : 1, c: p ? A(p, 'lineColor', '#000000') : '#000000' };
    };
    // A table written by the designer: its cells are text fields marked with JD.TABLE_PART_PROP; the first row
    // cell also carries JD.TABLE_PROP (the settings) and becomes the table, at its place. The other cells
    // (the rest of the rows, and the header in Column Header) are written again from it: SKIP.
    var SKIP = {};
    var propOf = function (el, name) {
      var re = first(el, 'reportElement');
      return re && kids(re, 'property').filter(function (p) { return A(p, 'name', '') === name; })[0];
    };
    var tableOf = function (el) {
      var mark = propOf(el, JD.TABLE_PROP);
      if (!mark) return propOf(el, JD.TABLE_PART_PROP) ? SKIP : null;
      var settings;
      try { settings = JSON.parse(A(mark, 'value', '{}')); } catch (e) { return null; }
      var e = base(el, 'table');
      e.props = [];
      e.xa = { el: {}, re: {}, te: {}, font: {} };
      Object.keys(settings || {}).forEach(function (k) { e[k] = settings[k]; });
      // Its size follows its columns and rows (the cell read is only the first one).
      e.width = (e.columns || []).reduce(function (sum, c) { return sum + (+c.width || 0); }, 0) || e.width;
      e.height = (e.rowSource === 'fixed' ? (+e.rowCount || 1) : 1) * (+e.rowHeight || e.height);
      return e;
    };
    var convert = function (el) {
      var e, ln = el.localName;
      var check = checkOf(el);
      if (check) return check;
      var table = tableOf(el);
      if (table === SKIP) return null;
      if (table) return table;
      if (!editable(el)) {
        e = base(el, 'raw');
        e.tag = ln;
        e.xml = xmlOf(el);
        e.xa = { el: {}, re: {}, te: {}, font: {} };
        rawCount++;
        warnings.push('"' + ln + '" elements' + (CHILDREN[ln] ? ' with settings the designer does not edit' : '') + ' are kept as they are; you can move and resize them, and edit them in Source.');
        return e;
      }
      if (ln === 'staticText') { e = base(el, 'staticText'); textFrom(el, e); e.text = textOf(first(el, 'text')); return e; }
      if (ln === 'textField') {
        e = base(el, 'textField'); textFrom(el, e);
        e.expression = textOf(first(el, 'textFieldExpression')).trim();
        e.pattern = A(el, 'pattern', '');
        e.evaluationTime = A(el, 'evaluationTime', 'Now');
        e.textAdjust = A(el, 'textAdjust', '') || (A(el, 'isStretchWithOverflow', 'false') === 'true' ? 'StretchHeight' : 'CutText');
        e.blankWhenNull = A(el, 'isBlankWhenNull', 'false') === 'true';
        return e;
      }
      if (ln === 'image') {
        e = base(el, 'image');
        var expr = textOf(first(el, 'imageExpression')).trim();
        var m = /^"repo:([A-Za-z0-9_.-]+)"$/.exec(expr);
        if (m) { e.source = 'resource'; e.resource = m[1]; resources.push(m[1]); }
        else { e.source = 'expression'; e.expression = expr; }
        e.scale = A(el, 'scaleImage', 'RetainShape'); e.hAlign = A(el, 'hAlign', 'Left'); e.vAlign = A(el, 'vAlign', 'Top');
        e.box = boxOf(el);
        return e;
      }
      if (ln === 'ellipse') { e = base(el, 'ellipse'); penFrom(el, e); return e; }
      if (ln === 'rectangle') { e = base(el, 'rectangle'); penFrom(el, e); e.radius = N(el, 'radius', 0); return e; }
      if (ln === 'break') { e = base(el, 'break'); e.breakType = A(el, 'type', 'Page') === 'Column' ? 'Column' : 'Page'; return e; }
      if (ln === 'subreport') {
        e = base(el, 'subreport');       // isUsingCache, runToBottom, overflowType, … stay in xa.el
        e.expression = textOf(first(el, 'subreportExpression')).trim();
        e.paramsMap = textOf(first(el, 'parametersMapExpression')).trim();
        e.params = kids(el, 'subreportParameter').map(function (p) { return { name: A(p, 'name', ''), expression: textOf(first(p, 'subreportParameterExpression')).trim() }; });
        var conn = first(el, 'connectionExpression'), ds = first(el, 'dataSourceExpression');
        e.connection = conn ? 'connection' : ds ? 'dataSource' : 'none';
        e.connExpr = conn || ds ? textOf(conn || ds).trim() : '$P{REPORT_CONNECTION}';
        e.returns = kids(el, 'returnValue').map(xmlOf);
        return e;
      }
      if (ln === 'line') { e = base(el, 'line'); penFrom(el, e); e.direction = A(el, 'direction', 'TopDown') === 'BottomUp' ? 'BottomUp' : 'TopDown'; return e; }
      // componentElement with a barcode
      var comp = kids(el).filter(function (c) { return c.localName !== 'reportElement'; })[0];
      e = base(el, 'barcode');
      e.kind = comp.localName;
      e.expression = textOf(kids(comp, 'codeExpression')[0]).trim();
      e.textPosition = e.kind === 'QRCode' || e.kind === 'DataMatrix' ? 'bottom' : A(comp, 'textPosition', 'none');
      e.moduleWidth = N(comp, 'moduleWidth', 1);
      return e;
    };

    var count = 0;
    JD.BANDS.forEach(function (b) {
      var sect = first(root, b[0]);
      var bands = sect ? kids(sect, 'band') : [];
      if (!bands.length) { d.bands[b[0]] = { height: 0, elements: [], props: [], splitType: 'Stretch', printWhen: '', hidden: true }; return; }
      // Detail: each band of the section is its own detail band (Detail 1, Detail 2, …).
      if (b[0] === 'detail' && bands.length > 1) {
        if (bands.length > JD.MAX_DETAIL) warnings.push('The detail section has ' + bands.length + ' bands; the last ' + (bands.length - JD.MAX_DETAIL) + ' are joined into Detail ' + JD.MAX_DETAIL + '.');
        bands.slice(0, JD.MAX_DETAIL - 1).forEach(function (band, i) { d.bands[i ? 'detail' + (i + 1) : 'detail'] = readBand([band]); });
        if (bands.length >= JD.MAX_DETAIL) d.bands['detail' + JD.MAX_DETAIL] = readBand(bands.slice(JD.MAX_DETAIL - 1));
        return;
      }
      if (bands.length > 1) warnings.push(b[1] + ' has ' + bands.length + ' bands; they are joined into one.');
      d.bands[b[0]] = readBand(bands);
    });
    function readBand(bands) {
      var height = 0, elements = [];
      bands.forEach(function (band) {
        kids(band).forEach(function (el) {
          if (el.localName === 'property' || el.localName === 'printWhenExpression') return;
          var e = convert(el);
          if (!e) return;                 // written again from another element (a table's cells)
          e.y += height;
          elements.push(e);
          count++;
        });
        height += N(band, 'height', 0);
      });
      return {
        height: height, elements: elements, props: props(bands[0]),
        splitType: A(bands[0], 'splitType', 'Stretch'), printWhen: textOf(first(bands[0], 'printWhenExpression')).trim()
      };
    }

    // The most used font and size become the designer's report font; elements using it inherit it.
    var top = function (seen) { return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; })[0]; };
    if (top(fontSeen)) d.font.name = top(fontSeen);
    if (top(sizeSeen)) d.font.size = +top(sizeSeen);
    JD.bandList(d).forEach(function (b) {
      d.bands[b[0]].elements.forEach(function (el) {
        if (el.type !== 'staticText' && el.type !== 'textField') return;
        if (el.fontName === d.font.name) el.fontName = '';
        if (el.fontSize === d.font.size) el.fontSize = 0;
      });
    });
    var seen = {};
    warnings = warnings.filter(function (x) { return !seen[x] && (seen[x] = true); });
    return {
      design: JD.sanitize(d), warnings: warnings, count: count, raw: rawCount,
      resources: resources.filter(function (n, i) { return resources.indexOf(n) === i; })
    };
  }

  window.JrxmlImport = { parse: parse };
})();
