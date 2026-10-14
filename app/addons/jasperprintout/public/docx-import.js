// Jasper Designer: Word (.docx) → design (browser only: JSZip + DOMParser). The design then gives
// the JRXML like any other. What is converted:
//   page size, orientation and margins; the default header → Page Header, footer → Page Footer;
//   paragraphs → text elements (font, size, bold/italic/underline, colour, alignment, indent,
//   spacing, shading, borders, list numbers/bullets); tables → one bordered text element per cell
//   (column widths, merged cells, row heights, cell shading, vertical alignment); PNG/JPEG/GIF
//   pictures → image elements with the picture as a resource;
//   MERGEFIELD, $F{x} / $P{x} / $V{x} and {{x}} → text fields with $F/$P/$V expressions;
//   PAGE / NUMPAGES fields → page number text fields.
// The document body goes to the Title band (page 1) and the Summary band (what follows a page
// break or does not fit), so the form prints once, with or without data.
// Jasper text elements have one format each, so a paragraph with mixed formatting uses the format
// of most of its text; the import lists such simplifications as warnings.
(function () {
  'use strict';
  var JD = window.JrxmlDesign;
  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  var PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var EMU = 12700;                       // EMU per point
  var IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
  var MAX_IMAGE = 5 * 1024 * 1024;
  var THAI = /[฀-๿]/;
  var THAI_MARKS = /[ัิ-ฺ็-๎]/g;      // above/below marks take no width
  var THAI_LETTERS = 'กขคงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ';

  // ─── XML helpers ───────────────────────────────────────────────────────────
  function kids(el, name, ns) {
    var out = [];
    if (!el) return out;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name && c.namespaceURI === (ns || W)) out.push(c);
    return out;
  }
  function kid(el, name, ns) { return kids(el, name, ns)[0] || null; }
  function path(el) { for (var i = 1; i < arguments.length && el; i++) el = kid(el, arguments[i]); return el; }
  function wa(el, name) {
    if (!el) return null;
    var v = el.getAttributeNS(W, name);
    if (v === null || v === '') v = el.getAttribute('w:' + name);
    return v === '' ? null : v;
  }
  function onOff(el) { if (!el) return null; var v = wa(el, 'val'); return !(v === '0' || v === 'false' || v === 'off' || v === 'none'); }
  var tw = function (v) { return v == null || isNaN(v) ? null : Number(v) / 20; };          // twips → points
  function xml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The Word file is damaged (its XML could not be read).');
    return doc;
  }
  function relsOf(doc) {
    var map = {};
    if (!doc) return map;
    var list = doc.getElementsByTagNameNS(PR, 'Relationship');
    for (var i = 0; i < list.length; i++) map[list[i].getAttribute('Id')] = { target: list[i].getAttribute('Target'), type: list[i].getAttribute('Type') || '', mode: list[i].getAttribute('TargetMode') };
    return map;
  }
  function partPath(base, target) {
    if (/^\//.test(target)) return target.slice(1);
    var parts = base.split('/'); parts.pop();
    target.split('/').forEach(function (p) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); });
    return parts.join('/');
  }

  // ─── styles: docDefaults → style chain (basedOn) → direct formatting ───────
  function readStyles(doc) {
    var s = { byId: {}, defaultPara: null, defaultTable: null, rPr: null, pPr: null };
    if (!doc) return s;
    var root = doc.documentElement;
    var dd = kid(root, 'docDefaults');
    s.rPr = path(dd, 'rPrDefault', 'rPr');
    s.pPr = path(dd, 'pPrDefault', 'pPr');
    kids(root, 'style').forEach(function (st) {
      var id = wa(st, 'styleId'), type = wa(st, 'type');
      if (!id) return;
      s.byId[id] = { type: type, basedOn: wa(kid(st, 'basedOn'), 'val'), pPr: kid(st, 'pPr'), rPr: kid(st, 'rPr'), tblPr: kid(st, 'tblPr'), name: wa(kid(st, 'name'), 'val') };
      if (wa(st, 'default') === '1' || wa(st, 'default') === 'true') {
        if (type === 'paragraph') s.defaultPara = id;
        if (type === 'table') s.defaultTable = id;
      }
    });
    return s;
  }
  function chain(styles, id) {
    var out = [], seen = {};
    while (id && styles.byId[id] && !seen[id]) { seen[id] = 1; out.unshift(styles.byId[id]); id = styles.byId[id].basedOn; }
    return out;
  }

  function applyRPr(f, rPr) {
    if (!rPr) return f;
    var fonts = kid(rPr, 'rFonts');
    if (fonts) {
      var latin = wa(fonts, 'ascii') || wa(fonts, 'hAnsi');
      if (latin) f.latinFont = latin;
      if (wa(fonts, 'cs')) f.csFont = wa(fonts, 'cs');
    }
    [['b', 'bold'], ['bCs', 'boldCs'], ['i', 'italic'], ['iCs', 'italicCs'], ['strike', 'strike'], ['dstrike', 'strike'], ['vanish', 'hidden'], ['caps', 'caps']].forEach(function (p) {
      var e = kid(rPr, p[0]);
      if (e) f[p[1]] = onOff(e);
    });
    var u = kid(rPr, 'u');
    if (u) f.underline = wa(u, 'val') !== 'none';
    var sz = wa(kid(rPr, 'sz'), 'val'), szCs = wa(kid(rPr, 'szCs'), 'val');
    if (sz) f.size = Number(sz) / 2;
    if (szCs) f.sizeCs = Number(szCs) / 2;
    var c = wa(kid(rPr, 'color'), 'val');
    if (c && /^[0-9A-Fa-f]{6}$/.test(c)) f.color = '#' + c.toUpperCase();
    else if (c === 'auto') f.color = null;
    var hl = kid(rPr, 'shd');
    if (hl && /^[0-9A-Fa-f]{6}$/.test(wa(hl, 'fill') || '')) f.fill = '#' + wa(hl, 'fill').toUpperCase();
    return f;
  }
  function applyPPr(p, pPr) {
    if (!pPr) return p;
    var jc = wa(kid(pPr, 'jc'), 'val');
    if (jc) p.jc = jc;
    var ind = kid(pPr, 'ind');
    if (ind) {
      ['left', 'start'].forEach(function (k) { if (wa(ind, k) != null) p.left = tw(wa(ind, k)); });
      ['right', 'end'].forEach(function (k) { if (wa(ind, k) != null) p.right = tw(wa(ind, k)); });
      if (wa(ind, 'firstLine') != null) { p.firstLine = tw(wa(ind, 'firstLine')); p.hanging = 0; }
      if (wa(ind, 'hanging') != null) { p.hanging = tw(wa(ind, 'hanging')); p.firstLine = 0; }
    }
    var sp = kid(pPr, 'spacing');
    if (sp) {
      if (wa(sp, 'before') != null) p.before = tw(wa(sp, 'before'));
      if (wa(sp, 'after') != null) p.after = tw(wa(sp, 'after'));
      if (wa(sp, 'line') != null) { p.line = Number(wa(sp, 'line')); p.lineRule = wa(sp, 'lineRule') || 'auto'; }
      if (onOff(kid(pPr, 'contextualSpacing'))) p.contextual = true;
    }
    var num = kid(pPr, 'numPr');
    if (num) {
      var id = wa(kid(num, 'numId'), 'val');
      p.numId = id && id !== '0' ? id : null;
      p.ilvl = Number(wa(kid(num, 'ilvl'), 'val') || 0);
    }
    var shd = kid(pPr, 'shd');
    if (shd && /^[0-9A-Fa-f]{6}$/.test(wa(shd, 'fill') || '')) p.fill = '#' + wa(shd, 'fill').toUpperCase();
    var bdr = kid(pPr, 'pBdr');
    if (bdr) { p.borders = p.borders || {}; ['top', 'left', 'bottom', 'right'].forEach(function (s) { var b = kid(bdr, s); if (b) p.borders[s] = pen(b); }); }
    if (onOff(kid(pPr, 'pageBreakBefore'))) p.pageBreakBefore = true;
    if (kid(pPr, 'rPr')) p.markRPr = kid(pPr, 'rPr');
    return p;
  }
  // A Word border (<w:top w:val="single" w:sz="4" w:color="000000"/>) → design pen, or null for none.
  function pen(b) {
    var v = wa(b, 'val');
    if (!v || v === 'none' || v === 'nil') return null;
    var c = wa(b, 'color');
    return {
      w: Math.max(0.25, Math.round((Number(wa(b, 'sz') || 4) / 8) * 4) / 4),
      s: /dash/i.test(v) ? 'Dashed' : /dot/i.test(v) ? 'Dotted' : /double/i.test(v) ? 'Double' : 'Solid',
      c: c && /^[0-9A-Fa-f]{6}$/.test(c) ? '#' + c.toUpperCase() : '#000000'
    };
  }

  // ─── numbering (list labels) ────────────────────────────────────────────────
  function readNumbering(doc) {
    var n = { abstract: {}, nums: {} };
    if (!doc) return n;
    var root = doc.documentElement;
    kids(root, 'abstractNum').forEach(function (an) {
      var levels = {};
      kids(an, 'lvl').forEach(function (l) {
        levels[wa(l, 'ilvl')] = { fmt: wa(kid(l, 'numFmt'), 'val') || 'decimal', text: wa(kid(l, 'lvlText'), 'val') || '', start: Number(wa(kid(l, 'start'), 'val') || 1), pPr: kid(l, 'pPr') };
      });
      n.abstract[wa(an, 'abstractNumId')] = levels;
    });
    kids(root, 'num').forEach(function (nm) {
      var over = {};
      kids(nm, 'lvlOverride').forEach(function (o) { var s = wa(kid(o, 'startOverride'), 'val'); if (s) over[wa(o, 'ilvl')] = Number(s); });
      n.nums[wa(nm, 'numId')] = { abs: wa(kid(nm, 'abstractNumId'), 'val'), start: over };
    });
    return n;
  }
  function roman(n) {
    var out = '', map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    map.forEach(function (m) { while (n >= m[0]) { out += m[1]; n -= m[0]; } });
    return out;
  }
  function numText(n, fmt) {
    switch (fmt) {
      case 'lowerLetter': return String.fromCharCode(97 + ((n - 1) % 26));
      case 'upperLetter': return String.fromCharCode(65 + ((n - 1) % 26));
      case 'lowerRoman': return roman(n);
      case 'upperRoman': return roman(n).toUpperCase();
      case 'thaiNumbers': case 'thaiCounting': return String(n).replace(/\d/g, function (d) { return String.fromCharCode(0x0E50 + Number(d)); });
      case 'thaiLetters': return THAI_LETTERS.charAt((n - 1) % THAI_LETTERS.length);
      case 'none': return '';
      default: return String(n);
    }
  }
  function listLabel(ctx, numId, ilvl) {
    var num = ctx.numbering.nums[numId];
    var levels = num && ctx.numbering.abstract[num.abs];
    var lvl = levels && levels[ilvl];
    if (!lvl) return null;
    var key = num.abs + ':' + numId;
    var counters = ctx.counters[key] || (ctx.counters[key] = []);
    for (var i = 0; i <= ilvl; i++) {
      var l = levels[i] || { start: 1 };
      var start = num.start[i] != null ? num.start[i] : l.start;
      if (counters[i] == null) counters[i] = start - (i === ilvl ? 1 : 0);
    }
    counters[ilvl]++;
    counters.length = ilvl + 1;
    if (lvl.fmt === 'bullet') {
      var ch = lvl.text || '•';
      return { text: /[-]/.test(ch) || ch === '' ? '•' : ch === 'o' ? '◦' : ch, pPr: lvl.pPr };
    }
    var text = lvl.text.replace(/%(\d)/g, function (m, d) {
      var i2 = Number(d) - 1, l2 = levels[i2] || lvl;
      return numText(counters[i2] != null ? counters[i2] : 1, l2.fmt);
    });
    return { text: text, pPr: lvl.pPr };
  }

  // ─── fonts and text size ────────────────────────────────────────────────────
  function mapFont(ctx, name) {
    if (!name) return '';
    if (/sarabun/i.test(name)) return /new/i.test(name) ? 'TH Sarabun New' : 'TH SarabunPSK';
    if (JD.FONTS.indexOf(name) >= 0) return name;
    if (/times|georgia|cambria|garamond/i.test(name)) return 'Serif';
    if (/courier|consolas|mono/i.test(name)) return 'Monospaced';
    if (/^arial|helvetica/i.test(name)) return 'Arial';
    ctx.unknownFonts[name] = true;
    return ctx.design.font.name;
  }
  // The effective format of a piece of text (Thai text uses the complex-script font, size and bold).
  function textFormat(ctx, f, text) {
    var thai = THAI.test(text);
    var font = mapFont(ctx, (thai ? f.csFont || f.latinFont : f.latinFont || f.csFont) || '') || ctx.design.font.name;
    var size = (thai ? f.sizeCs || f.size : f.size || f.sizeCs) || ctx.design.font.size;
    return {
      font: font, size: Math.round(size * 2) / 2,
      bold: !!(thai && f.boldCs != null ? f.boldCs : f.bold), italic: !!(thai && f.italicCs != null ? f.italicCs : f.italic),
      underline: !!f.underline, strike: !!f.strike, color: f.color || '#000000'
    };
  }
  function isSarabun(font) { return /sarabun/i.test(font); }
  // Width of text in points, estimated (a little generous, so text is not cut off).
  function textWidth(text, fmt) {
    var base = text.replace(THAI_MARKS, ''), thai = (base.match(/[฀-๿]/g) || []).length, other = base.length - thai;
    var k = isSarabun(fmt.font) ? [0.40, 0.40] : [0.56, 0.52];
    return (thai * k[0] + other * k[1]) * fmt.size * (fmt.bold ? 1.06 : 1);
  }
  function lineHeight(fmt) { return fmt.size * (isSarabun(fmt.font) ? 1.13 : 1.18); }
  function textHeight(text, fmt, width, lineFactor) {
    var avail = Math.max(10, width - 4), lines = 0;
    String(text).split('\n').forEach(function (seg) { lines += Math.max(1, Math.ceil(textWidth(seg, fmt) / avail)); });
    return Math.ceil(lines * lineHeight(fmt) * (lineFactor || 1) + 4);
  }

  // ─── paragraph content: runs, fields, pictures ──────────────────────────────
  // A paragraph becomes a list of parts: { text, fmt } / { expr, fmt } / { image } / { pageBreak }.
  function paragraphParts(ctx, p, baseR) {
    var parts = [], field = null, images = [], boxes = [];
    function addText(text, f) { if (text && !f.hidden) parts.push({ text: f.caps ? text.toUpperCase() : text, f: f }); }
    function runFormat(r) {
      var f = Object.assign({}, baseR);
      var rPr = kid(r, 'rPr');
      var rs = wa(kid(rPr, 'rStyle'), 'val');
      chain(ctx.styles, rs).forEach(function (st) { applyRPr(f, st.rPr); });
      return applyRPr(f, rPr);
    }
    function fieldToken(instr) {
      var m = /^\s*MERGEFIELD\s+("([^"]+)"|(\S+))/i.exec(instr);
      if (m) return { expr: '$F{' + ctx.fieldName(m[2] || m[3]) + '}' };
      if (/^\s*PAGE\b/i.test(instr)) return { expr: '$V{PAGE_NUMBER}' };
      if (/^\s*(NUMPAGES|SECTIONPAGES)\b/i.test(instr)) return { expr: '$V{PAGE_NUMBER}', total: true };
      return null;
    }
    function run(r) {
      var f = runFormat(r);
      for (var c = r.firstElementChild; c; c = c.nextElementSibling) {
        if (c.namespaceURI !== W) {
          if (c.localName === 'AlternateContent') { var ch = c.firstElementChild; if (ch) drawing(ch, f); }
          continue;
        }
        var n = c.localName;
        if (n === 'fldChar') {
          var t = wa(c, 'fldCharType');
          if (t === 'begin') { if (!field) field = { depth: 1, instr: '', phase: 'instr', token: null, done: false }; else field.depth++; }
          else if (t === 'separate' && field && field.depth === 1) { field.phase = 'result'; field.token = fieldToken(field.instr); if (field.token) { parts.push(Object.assign({ f: f }, field.token)); field.done = true; } }
          else if (t === 'end' && field) {
            if (--field.depth === 0) {
              if (!field.done) { var tok = fieldToken(field.instr); if (tok) parts.push(Object.assign({ f: f }, tok)); }
              field = null;
            }
          }
          continue;
        }
        if (n === 'instrText') { if (field && field.depth === 1 && field.phase === 'instr') field.instr += c.textContent; continue; }
        if (field && (field.phase === 'instr' || field.done)) continue;           // field code, or result replaced by an expression
        if (n === 't') addText(c.textContent, f);
        else if (n === 'tab' || n === 'ptab') addText('    ', f);
        else if (n === 'br' || n === 'cr') {
          if (wa(c, 'type') === 'page') parts.push({ pageBreak: true });
          else if (wa(c, 'type') !== 'column') addText('\n', f);
        } else if (n === 'noBreakHyphen') addText('-', f);
        else if (n === 'sym') { var code = parseInt(wa(c, 'char') || '', 16); addText(code >= 0xF000 ? '•' : String.fromCharCode(code || 32), f); }
        else if (n === 'drawing') drawing(c, f);
        else if (n === 'pict' || n === 'object') ctx.warn('A legacy (VML) picture or embedded object was left out. Save the document as .docx in a recent Word, or add the picture in the designer.');
      }
    }
    function drawing(d, f) {
      var blip = d.getElementsByTagNameNS(A, 'blip')[0];
      var box = d.getElementsByTagNameNS(W, 'txbxContent')[0];
      if (box) { boxes.push(box); if (!blip) return; }
      if (!blip) return;
      var host = d.getElementsByTagNameNS(WP, 'inline')[0] || d.getElementsByTagNameNS(WP, 'anchor')[0];
      var ext = host && kid(host, 'extent', WP);
      var img = {
        rid: blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed'),
        width: ext ? Number(ext.getAttribute('cx')) / EMU : 100, height: ext ? Number(ext.getAttribute('cy')) / EMU : 50,
        floating: !!(host && host.localName === 'anchor')
      };
      if (img.floating) {
        var ph = kid(host, 'positionH', WP), pv = kid(host, 'positionV', WP);
        img.hFrom = ph && ph.getAttribute('relativeFrom'); img.vFrom = pv && pv.getAttribute('relativeFrom');
        var ho = kid(ph, 'posOffset', WP), vo = kid(pv, 'posOffset', WP), ha = kid(ph, 'align', WP);
        img.dx = ho ? Number(ho.textContent) / EMU : 0; img.dy = vo ? Number(vo.textContent) / EMU : 0;
        img.hAlign = ha ? ha.textContent : null;
      }
      images.push(img);
      parts.push({ image: img });
    }
    function walk(el) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (c.namespaceURI !== W) continue;
        var n = c.localName;
        if (n === 'r') run(c);
        else if (n === 'hyperlink' || n === 'ins' || n === 'smartTag' || n === 'customXml' || n === 'dir' || n === 'bdo') walk(c);
        else if (n === 'sdt') walk(kid(c, 'sdtContent') || c);
        else if (n === 'fldSimple') {
          var tok = fieldToken(wa(c, 'instr') || '');
          if (tok) { var fr = kid(c, 'r'); parts.push(Object.assign({ f: fr ? runFormat(fr) : Object.assign({}, baseR) }, tok)); } else walk(c);
        }
      }
    }
    walk(p);
    return { parts: parts, boxes: boxes };
  }

  // $F{x} / $P{x} / $V{x} / {{x}} typed in the text → expressions.
  var PLACEHOLDER = /\$([FPV])\{([^}\s]+)\}|\{\{\s*([^}\s]+)\s*\}\}/g;
  function splitPlaceholders(ctx, parts) {
    var out = [];
    parts.forEach(function (pt) {
      if (pt.text == null) { out.push(pt); return; }
      var last = 0, m;
      PLACEHOLDER.lastIndex = 0;
      while ((m = PLACEHOLDER.exec(pt.text))) {
        if (m.index > last) out.push({ text: pt.text.slice(last, m.index), f: pt.f });
        var kind = m[1] || 'F', name = m[2] || m[3];
        out.push({ expr: '$' + kind + '{' + (kind === 'P' ? ctx.paramName(name) : kind === 'V' ? name : ctx.fieldName(name)) + '}', f: pt.f });
        last = m.index + m[0].length;
      }
      if (last < pt.text.length) out.push({ text: pt.text.slice(last), f: pt.f });
    });
    return out;
  }

  var javaString = function (s) { return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'; };
  function expression(parts) {
    var out = [], buf = '';
    parts.forEach(function (p) {
      if (p.text != null) buf += p.text;
      else if (p.expr) { if (buf) out.push(javaString(buf)); buf = ''; out.push(p.expr); }
    });
    if (buf) out.push(javaString(buf));
    return out.length ? out.join(' + ') : '""';
  }
  var plain = function (parts) { return parts.map(function (p) { return p.text != null ? p.text : p.expr ? p.expr : ''; }).join(''); };

  // ─── layout ─────────────────────────────────────────────────────────────────
  // A flow places blocks top to bottom in one band: { x, width, y, els: [], pages: [[els]] }.
  function textElement(ctx, parts, fmt, box) {
    var hasExpr = parts.some(function (p) { return p.expr; });
    var el = JD.newElement(hasExpr ? 'textField' : 'staticText', {
      x: Math.round(box.x), y: Math.round(box.y), width: Math.max(4, Math.round(box.width)), height: Math.max(4, Math.round(box.height)),
      fontName: fmt.font === ctx.design.font.name ? '' : fmt.font, fontSize: fmt.size === ctx.design.font.size ? 0 : fmt.size,
      bold: fmt.bold, italic: fmt.italic, underline: fmt.underline, strike: fmt.strike, forecolor: fmt.color,
      hAlign: box.hAlign || 'Left', vAlign: box.vAlign || 'Top'
    });
    if (hasExpr) { el.expression = expression(parts); el.textAdjust = 'StretchHeight'; } else el.text = plain(parts);
    if (box.fill) { el.backcolor = box.fill; el.opaque = true; }
    if (box.pad) el.box.pad = box.pad;
    if (box.borders) ['top', 'left', 'bottom', 'right'].forEach(function (s) { if (box.borders[s]) el.box.sides[s] = box.borders[s]; });
    return el;
  }
  // The format most of the text uses (Jasper gives one format per text element).
  function mainFormat(ctx, parts) {
    var tally = {}, best = null, bestN = -1, mixed = false, first = null;
    parts.forEach(function (p) {
      if (p.text == null && !p.expr) return;
      var text = p.text != null ? p.text : 'xxxxxx';
      if (!text.trim() && p.text != null) return;
      var fmt = textFormat(ctx, p.f, text), key = JSON.stringify(fmt);
      if (first && first !== key) mixed = true;
      first = first || key;
      tally[key] = (tally[key] || 0) + text.length;
      if (tally[key] > bestN) { bestN = tally[key]; best = fmt; }
    });
    return { fmt: best, mixed: mixed };
  }
  var JC = { left: 'Left', start: 'Left', center: 'Center', right: 'Right', end: 'Right', both: 'Justified', distribute: 'Justified', thaiDistribute: 'Justified', lowKashida: 'Justified', mediumKashida: 'Justified', highKashida: 'Justified' };

  function paragraphFormat(ctx, p, tableBase) {
    var pf = {}, rf = {};
    applyPPr(pf, ctx.styles.pPr); applyRPr(rf, ctx.styles.rPr);
    if (tableBase) { tableBase.forEach(function (st) { applyPPr(pf, st.pPr); applyRPr(rf, st.rPr); }); }
    var pPr = kid(p, 'pPr');
    var styleId = wa(kid(pPr, 'pStyle'), 'val') || ctx.styles.defaultPara;
    chain(ctx.styles, styleId).forEach(function (st) { applyPPr(pf, st.pPr); applyRPr(rf, st.rPr); });
    applyPPr(pf, pPr);
    return { p: pf, r: rf };
  }

  // Lays out one paragraph into the flow; returns nothing (moves flow.y).
  function paragraph(ctx, flow, p, opts) {
    opts = opts || {};
    var fm = paragraphFormat(ctx, p, opts.tableBase), pf = fm.p;
    var res = paragraphParts(ctx, p, fm.r);
    var parts = splitPlaceholders(ctx, res.parts);
    var label = pf.numId ? listLabel(ctx, pf.numId, pf.ilvl) : null;
    if (label && label.pPr) { var lp = applyPPr({}, label.pPr); ['left', 'hanging', 'firstLine'].forEach(function (k) { if (pf[k] == null && lp[k] != null) pf[k] = lp[k]; }); }
    if (pf.pageBreakBefore && !opts.inCell) newPage(flow);
    // Split at page breaks: each piece is laid out on its own page.
    var pieces = [[]];
    parts.forEach(function (pt) { if (pt.pageBreak) pieces.push([]); else pieces[pieces.length - 1].push(pt); });
    pieces.forEach(function (piece, i) {
      if (i > 0) { if (opts.inCell) return; newPage(flow); }
      layoutPiece(ctx, flow, piece, pf, fm.r, i === 0 ? label : null, opts);
    });
    res.boxes.forEach(function (box) {
      ctx.warn('Text boxes became normal paragraphs; move them where they belong.');
      kids(box, 'p').forEach(function (bp) { paragraph(ctx, flow, bp, opts); });
    });
  }

  function layoutPiece(ctx, flow, parts, pf, baseR, label, opts) {
    var left = (pf.left || 0), right = (pf.right || 0);
    var x = flow.x + left - (pf.hanging || 0), width = flow.width - left - right + (pf.hanging || 0);
    if (width < 20) { x = flow.x; width = flow.width; }
    var hAlign = JC[pf.jc] || 'Left';
    var before = pf.contextual && flow.lastStyle === pf ? 0 : (pf.before || 0);
    var lineFactor = pf.line && pf.lineRule === 'auto' ? Math.max(1, pf.line / 240) : 1;
    flow.y += opts.inCell ? 0 : before;
    // Pictures: floating ones are placed where Word anchors them; inline ones get their own row.
    var inline = [];
    parts.forEach(function (pt) { if (pt.image) (pt.image.floating ? placeFloating(ctx, flow, pt.image) : inline.push(pt.image)); });
    if (inline.length) {
      var rowW = inline.reduce(function (s, im) { return s + im.width; }, 0) + (inline.length - 1) * 4;
      var scale = rowW > width ? width / rowW : 1;
      var ix = hAlign === 'Center' ? x + (width - rowW * scale) / 2 : hAlign === 'Right' ? x + width - rowW * scale : x;
      var rowH = 0;
      inline.forEach(function (im) {
        var el = imageElement(ctx, im, ix, flow.y, im.width * scale, im.height * scale);
        if (el) { flow.els.push(el); ix += el.width + 4; rowH = Math.max(rowH, el.height); }
      });
      flow.y += rowH;
    }
    var textParts = parts.filter(function (pt) { return !pt.image; });
    if (label && label.text) textParts.unshift({ text: label.text + '  ', f: baseR });
    if (pf.firstLine > 0) textParts.unshift({ text: new Array(Math.min(40, Math.round(pf.firstLine / 4)) + 1).join(' '), f: baseR });
    var hasContent = textParts.some(function (pt) { return pt.expr || (pt.text && pt.text.trim()); });
    var mf = mainFormat(ctx, textParts);
    var fmt = mf.fmt || textFormat(ctx, Object.assign({}, baseR, pf.markRPr ? applyRPr({}, pf.markRPr) : {}), '');
    if (!hasContent) {
      if (!inline.length) {
        var h = Math.round(lineHeight(fmt) * lineFactor);
        if (pf.fill || pf.borders) flow.els.push(textElement(ctx, [], fmt, { x: x, y: flow.y, width: width, height: h, fill: pf.fill, borders: pf.borders }));
        flow.y += h;
      }
    } else {
      if (mf.mixed) ctx.simplified++;
      var totals = textParts.filter(function (pt) { return pt.total; });
      var height = textHeight(plain(textParts), fmt, width, lineFactor);
      if (totals.length) pageXofY(ctx, flow, textParts, fmt, { x: x, width: width, height: height, hAlign: hAlign });
      else flow.els.push(textElement(ctx, textParts, fmt, { x: x, y: flow.y, width: width, height: height, hAlign: hAlign, fill: pf.fill, borders: pf.borders, pad: { top: 0, left: 2, bottom: 0, right: 2 } }));
      flow.y += height;
    }
    flow.y += opts.inCell ? 0 : (pf.after || 0);
    flow.lastStyle = pf;
  }

  // "Page X of Y": Y needs evaluation time Report, so it is a second text field next to the first.
  function pageXofY(ctx, flow, parts, fmt, box) {
    var i = parts.findIndex(function (p) { return p.total; });
    var a = parts.slice(0, i), b = parts.slice(i).map(function (p) { return p.total ? { expr: p.expr, f: p.f } : p; });
    var wa2 = Math.min(box.width / 2, textWidth(plain(a).replace(/\$V\{PAGE_NUMBER\}/g, '999'), fmt) + 8);
    var wb = Math.min(box.width / 2, textWidth(plain(b).replace(/\$V\{PAGE_NUMBER\}/g, '999'), fmt) + 8);
    var start = box.hAlign === 'Center' ? box.x + (box.width - wa2 - wb) / 2 : box.hAlign === 'Right' ? box.x + box.width - wa2 - wb : box.x;
    var ea = textElement(ctx, a, fmt, { x: start, y: flow.y, width: wa2, height: box.height, hAlign: 'Right' });
    var eb = textElement(ctx, b, fmt, { x: start + wa2, y: flow.y, width: wb, height: box.height, hAlign: 'Left' });
    eb.evaluationTime = 'Report';
    flow.els.push(ea, eb);
  }

  function placeFloating(ctx, flow, im) {
    var x = im.dx, y = im.dy;
    if (im.hFrom === 'page') x -= ctx.marginLeft;
    if (im.hAlign) x = im.hAlign === 'center' ? (flow.width - im.width) / 2 : im.hAlign === 'right' ? flow.width - im.width : 0;
    x += flow.x;
    if (im.vFrom === 'page') y = y - ctx.marginTop;
    else if (im.vFrom === 'margin' || im.vFrom === 'topMargin') y = y;
    else y = flow.y + y;                                       // paragraph / line
    var el = imageElement(ctx, im, x, Math.max(0, y), im.width, im.height);
    if (el) { flow.els.push(el); flow.floatBottom = Math.max(flow.floatBottom || 0, el.y + el.height); }
  }

  function imageElement(ctx, im, x, y, w, h) {
    var name = ctx.imageFor(im.rid, ctx.part);
    if (!name) return null;
    return JD.newElement('image', { x: Math.round(x), y: Math.round(y), width: Math.max(4, Math.round(w)), height: Math.max(4, Math.round(h)), source: 'resource', resource: name, scale: 'RetainShape' });
  }

  function newPage(flow) {
    flow.pages.push({ els: flow.els, height: Math.max(flow.y, flow.floatBottom || 0) });
    flow.els = []; flow.y = 0; flow.floatBottom = 0; flow.lastStyle = null;
  }

  // ─── tables ─────────────────────────────────────────────────────────────────
  function table(ctx, flow, tbl) {
    var tblPr = kid(tbl, 'tblPr');
    var styleChain = chain(ctx.styles, wa(kid(tblPr, 'tblStyle'), 'val') || ctx.styles.defaultTable);
    var borders = {}, mar = { top: 0, bottom: 0, left: 5.4, right: 5.4 };
    function readBorders(pr) {
      var b = kid(pr, 'tblBorders');
      if (b) ['top', 'left', 'bottom', 'right', 'insideH', 'insideV', 'start', 'end'].forEach(function (s) { var e = kid(b, s); if (e) borders[s === 'start' ? 'left' : s === 'end' ? 'right' : s] = pen(e); });
      var m = kid(pr, 'tblCellMar');
      if (m) ['top', 'bottom', 'left', 'right', 'start', 'end'].forEach(function (s) { var e = kid(m, s); if (e && wa(e, 'w') != null) mar[s === 'start' ? 'left' : s === 'end' ? 'right' : s] = tw(wa(e, 'w')); });
    }
    styleChain.forEach(function (st) { readBorders(st.tblPr); });
    readBorders(tblPr);
    var cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map(function (g) { return tw(wa(g, 'w')) || 0; });
    var rows = kids(tbl, 'tr');
    if (!cols.length || cols.every(function (c) { return !c; })) {
      var n = Math.max.apply(null, rows.map(function (r) { return kids(r, 'tc').reduce(function (s, tc) { return s + Number(wa(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val') || 1); }, 0); }).concat([1]));
      cols = []; for (var c = 0; c < n; c++) cols.push(flow.width / n);
    }
    var total = cols.reduce(function (s, w) { return s + w; }, 0);
    var scale = total > flow.width ? flow.width / total : 1;
    cols = cols.map(function (w) { return w * scale; });
    total *= scale;
    var x0 = flow.x + (tw(wa(kid(tblPr, 'tblInd'), 'w')) || 0) * (wa(kid(tblPr, 'tblInd'), 'type') === 'pct' ? 0 : 1);
    var jc = wa(kid(tblPr, 'jc'), 'val');
    if (jc === 'center') x0 = flow.x + (flow.width - total) / 2; else if (jc === 'right' || jc === 'end') x0 = flow.x + flow.width - total;
    x0 = Math.max(flow.x, Math.min(x0, flow.x + flow.width - total));
    var colX = [x0]; cols.forEach(function (w, i) { colX.push(colX[i] + w); });

    // Pass 1: the cells of each row (grid position, span, merge) and the height their content needs.
    var grid = [], open = {};
    rows.forEach(function (tr, ri) {
      var trPr = kid(tr, 'trPr'), th = kid(trPr, 'trHeight');
      var row = { min: tw(wa(th, 'val')) || 0, exact: wa(th, 'hRule') === 'exact', cells: [], height: 0 };
      var col = Number(wa(kid(trPr, 'gridBefore'), 'val') || 0);
      kids(tr, 'tc').forEach(function (tc) {
        var tcPr = kid(tc, 'tcPr');
        var span = Number(wa(kid(tcPr, 'gridSpan'), 'val') || 1);
        var vm = kid(tcPr, 'vMerge');
        if (vm && wa(vm, 'val') !== 'restart') {               // continues the merged cell above
          if (open[col]) { open[col].rows++; row.cells.push({ cont: true, col: col, span: span }); }
          col += span;
          return;
        }
        var cell = { tc: tc, tcPr: tcPr, row: ri, col: col, span: span, rows: 1 };
        cell.width = (colX[Math.min(col + span, cols.length)] || colX[colX.length - 1]) - colX[Math.min(col, cols.length)];
        cell.layout = cellLayout(ctx, cell, mar, styleChain);
        if (vm) open[col] = cell; else delete open[col];
        row.cells.push(cell);
        col += span;
      });
      // A cell column with no vMerge in this row ends any merge there.
      Object.keys(open).forEach(function (k) { if (!row.cells.some(function (c) { return c.col === Number(k); })) delete open[k]; });
      grid.push(row);
    });
    grid.forEach(function (row) {
      row.height = row.min;
      if (!row.exact) row.cells.forEach(function (c) { if (!c.cont && c.rows === 1) row.height = Math.max(row.height, c.layout.height); });
      row.height = Math.max(row.height, 8);
    });
    // Merged cells: grow the last row they cover when their content needs more room.
    grid.forEach(function (row, ri) {
      row.cells.forEach(function (c) {
        if (c.cont || c.rows === 1) return;
        var h = 0; for (var k = ri; k < ri + c.rows && k < grid.length; k++) h += grid[k].height;
        if (c.layout.height > h && !grid[Math.min(ri + c.rows, grid.length) - 1].exact) grid[Math.min(ri + c.rows, grid.length) - 1].height += c.layout.height - h;
      });
    });

    // Pass 2: place the cells.
    var rowY = [flow.y]; grid.forEach(function (row, i) { rowY.push(rowY[i] + row.height); });
    var lastRow = grid.length - 1;
    grid.forEach(function (row, ri) {
      row.cells.forEach(function (c) {
        if (c.cont) return;
        var x = colX[Math.min(c.col, cols.length)], y = rowY[ri], h = rowY[Math.min(ri + c.rows, grid.length)] - y;
        var endCol = c.col + c.span, endRow = ri + c.rows - 1;
        var side = function (s) {
          if (s === 'top') return ri === 0 ? borders.top : borders.insideH;
          if (s === 'bottom') return endRow >= lastRow ? borders.bottom : borders.insideH;
          if (s === 'left') return c.col === 0 ? borders.left : borders.insideV;
          return endCol >= cols.length ? borders.right : borders.insideV;
        };
        var b = {}, tcB = kid(c.tcPr, 'tcBorders');
        ['top', 'left', 'bottom', 'right'].forEach(function (s) {
          var own = kid(tcB, s) || kid(tcB, s === 'left' ? 'start' : s === 'right' ? 'end' : '');
          b[s] = own ? pen(own) : side(s) || null;
        });
        placeCell(ctx, flow, c, { x: x, y: y, width: c.width, height: h, borders: b });
      });
    });
    flow.y = rowY[rowY.length - 1];
  }

  // What a cell holds: its text (paragraphs joined by line breaks), pictures and the height they need.
  function cellLayout(ctx, cell, mar, styleChain) {
    var tcPr = cell.tcPr, m = Object.assign({}, mar), cm = kid(tcPr, 'tcMar');
    if (cm) ['top', 'bottom', 'left', 'right', 'start', 'end'].forEach(function (s) { var e = kid(cm, s); if (e && wa(e, 'w') != null) m[s === 'start' ? 'left' : s === 'end' ? 'right' : s] = tw(wa(e, 'w')); });
    var inner = Math.max(10, cell.width - m.left - m.right);
    var parts = [], images = [], fmt = null, hAlign = null, first = true, nested = false;
    function addParagraph(p) {
      var fm = paragraphFormat(ctx, p, styleChain), res = paragraphParts(ctx, p, fm.r);
      var ps = splitPlaceholders(ctx, res.parts).filter(function (pt) { return !pt.pageBreak; });
      var label = fm.p.numId ? listLabel(ctx, fm.p.numId, fm.p.ilvl) : null;
      ps.forEach(function (pt) { if (pt.image) images.push(pt.image); });
      var text = ps.filter(function (pt) { return !pt.image; });
      if (label && label.text) text.unshift({ text: label.text + ' ', f: fm.r });
      if (!first) parts.push({ text: '\n', f: fm.r });
      first = false;
      parts = parts.concat(text);
      if (!hAlign && text.some(function (pt) { return pt.expr || (pt.text && pt.text.trim()); })) hAlign = JC[fm.p.jc] || 'Left';
      if (!fmt) fmt = textFormat(ctx, Object.assign({}, fm.r, fm.p.markRPr ? applyRPr({}, fm.p.markRPr) : {}), '');
    }
    for (var c = cell.tc.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === 'p') addParagraph(c);
      else if (c.localName === 'sdt') kids(kid(c, 'sdtContent'), 'p').forEach(addParagraph);
      else if (c.localName === 'tbl') {
        nested = true;
        kids(c, 'tr').forEach(function (tr) {
          var cellsText = kids(tr, 'tc').map(function (tc) { return Array.prototype.map.call(tc.getElementsByTagNameNS(W, 't'), function (t) { return t.textContent; }).join(''); });
          parts.push({ text: (first ? '' : '\n') + cellsText.join('  |  '), f: {} });
          first = false;
        });
      }
    }
    if (nested) ctx.warn('A table inside a table cell became plain text in that cell.');
    while (parts.length && parts[parts.length - 1].text === '\n') parts.pop();
    var mf = mainFormat(ctx, parts);
    if (mf.mixed) ctx.simplified++;
    fmt = mf.fmt || fmt || textFormat(ctx, {}, '');
    var hasText = parts.some(function (pt) { return pt.expr || (pt.text && pt.text.trim()); });
    var imgH = 0;
    images.forEach(function (im) { var s = im.width > inner ? inner / im.width : 1; im.cw = im.width * s; im.ch = im.height * s; imgH += im.ch + 2; });
    var textH = hasText ? textHeight(plain(parts), fmt, inner) : 0;
    var va = wa(kid(tcPr, 'vAlign'), 'val');
    var shd = kid(tcPr, 'shd');
    return {
      parts: parts, fmt: fmt, hasText: hasText, images: images, imgH: imgH, mar: m,
      height: Math.ceil(imgH + textH + m.top + m.bottom + (hasText || images.length ? 0 : lineHeight(fmt))),
      hAlign: hAlign || 'Left', vAlign: va === 'center' ? 'Middle' : va === 'bottom' ? 'Bottom' : 'Top',
      fill: shd && /^[0-9A-Fa-f]{6}$/.test(wa(shd, 'fill') || '') && wa(shd, 'fill').toUpperCase() !== 'FFFFFF' ? '#' + wa(shd, 'fill').toUpperCase() : null
    };
  }

  function placeCell(ctx, flow, c, box) {
    var L = c.layout, m = L.mar;
    var iy = box.y + m.top;
    L.images.forEach(function (im) {
      var inner = box.width - m.left - m.right;
      var ix = L.hAlign === 'Center' ? box.x + m.left + (inner - im.cw) / 2 : L.hAlign === 'Right' ? box.x + box.width - m.right - im.cw : box.x + m.left;
      var el = imageElement(ctx, im, ix, iy, im.cw, im.ch);
      if (el) flow.els.push(el);
      iy += im.ch + 2;
    });
    var anyBorder = ['top', 'left', 'bottom', 'right'].some(function (s) { return box.borders[s]; });
    if (!L.hasText && !anyBorder && !L.fill) return;
    var top = L.images.length ? iy - box.y : m.top;
    var el = textElement(ctx, L.hasText ? L.parts : [], L.fmt, {
      x: box.x, y: box.y, width: box.width, height: box.height, hAlign: L.hAlign, vAlign: L.vAlign, fill: L.fill, borders: box.borders,
      pad: { top: Math.round(top), left: Math.round(m.left), bottom: Math.round(m.bottom), right: Math.round(m.right) }
    });
    // A cell with pictures above its text: the text element starts below them, the borders stay on the whole cell.
    flow.els.push(el);
  }

  // ─── document parts ─────────────────────────────────────────────────────────
  function layoutBody(ctx, body, width) {
    var flow = { x: 0, width: width, y: 0, els: [], pages: [], floatBottom: 0 };
    (function walk(el) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (c.namespaceURI !== W) continue;
        if (c.localName === 'p') {
          paragraph(ctx, flow, c);
          if (kid(kid(c, 'pPr'), 'sectPr')) { ctx.sections++; newPage(flow); }
        } else if (c.localName === 'tbl') table(ctx, flow, c);
        else if (c.localName === 'sdt') walk(kid(c, 'sdtContent') || c);
        else if (c.localName === 'customXml') walk(c);
      }
    })(body);
    newPage(flow);
    return flow.pages.filter(function (pg, i, all) { return pg.els.length || (i === 0 && all.length === 1); });
  }

  function parse(buffer, fileName) {
    if (!window.JSZip) return Promise.reject(new Error('The ZIP library is not loaded.'));
    var ctx = { warnings: [], unknownFonts: {}, simplified: 0, sections: 0, counters: {}, images: {}, imageNames: {}, skippedImages: 0, fields: {}, params: {}, count: 0 };
    ctx.warn = function (m) { if (ctx.warnings.indexOf(m) < 0) ctx.warnings.push(m); };
    var zip;
    return JSZip.loadAsync(buffer).catch(function () { throw new Error('This is not a .docx file (Word 2007 or later). Old .doc files must be saved as .docx first.'); })
      .then(function (z) {
        zip = z;
        var read = function (p) { var f = zip.file(p); return f ? f.async('string') : Promise.resolve(null); };
        return Promise.all(['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels'].map(read));
      })
      .then(function (files) {
        if (!files[0]) throw new Error('This .docx has no document (word/document.xml).');
        var doc = xml(files[0]);
        ctx.styles = readStyles(files[1] && xml(files[1]));
        ctx.numbering = readNumbering(files[2] && xml(files[2]));
        ctx.rels = { 'word/document.xml': relsOf(files[3] && xml(files[3])) };
        var body = kid(doc.documentElement, 'body');
        var sect = kid(body, 'sectPr');
        // Header/footer parts used by the (last) section, with their relationships.
        var refs = {};
        ['header', 'footer'].forEach(function (k) {
          kids(sect, k + 'Reference').forEach(function (ref) {
            var type = wa(ref, 'type') || 'default', rel = ctx.rels['word/document.xml'][ref.getAttributeNS(R, 'id') || ref.getAttribute('r:id')];
            if (rel) (refs[k] = refs[k] || {})[type] = partPath('word/document.xml', rel.target);
          });
        });
        var parts = [];
        ['header', 'footer'].forEach(function (k) {
          var p = refs[k] && (refs[k]['default'] || refs[k].first);
          if (refs[k] && refs[k].first && refs[k]['default'] && onOff(kid(sect, 'titlePg'))) ctx.warn('The first page has its own ' + k + ' in Word; the normal ' + k + ' is used on every page.');
          if (p) parts.push({ kind: k, path: p });
        });
        return Promise.all(parts.map(function (pt) {
          var relPath = pt.path.replace(/([^/]+)$/, '_rels/$1.rels');
          return Promise.all([zip.file(pt.path) ? zip.file(pt.path).async('string') : null, zip.file(relPath) ? zip.file(relPath).async('string') : null])
            .then(function (t) { pt.doc = t[0] && xml(t[0]); ctx.rels[pt.path] = relsOf(t[1] && xml(t[1])); return pt; });
        })).then(function (hf) { return { body: body, sect: sect, hf: hf }; });
      })
      .then(function (d) {
        // Report name from the file name (a Thai file name has no English letters left: Word_Report).
        var name = JD.sanitize({ name: String(fileName || '').replace(/\.docx$/i, '') }).name;
        var design = JD.newDesign(name === 'New_Report' || /^_*$/.test(name) ? 'Word_Report' : name);
        ctx.design = design;
        // Page: size, orientation, margins. The Word header/footer sit inside the top/bottom margins,
        // so the Jasper margins become the header/footer distances and the bands fill the rest.
        var pgSz = kid(d.sect, 'pgSz'), pgMar = kid(d.sect, 'pgMar');
        var pw = tw(wa(pgSz, 'w')) || 595, ph = tw(wa(pgSz, 'h')) || 842;
        var landscape = wa(pgSz, 'orient') === 'landscape' || pw > ph;
        var size = 'Custom';
        Object.keys(JD.PAGES).forEach(function (k) {
          var s = JD.PAGES[k], a = landscape ? [s[1], s[0]] : s;
          if (Math.abs(a[0] - pw) < 3 && Math.abs(a[1] - ph) < 3) size = k;
        });
        design.page.size = size; design.page.orientation = landscape ? 'landscape' : 'portrait';
        design.page.width = Math.round(pw); design.page.height = Math.round(ph);
        var mg = function (k, def) { var v = tw(wa(pgMar, k)); return v == null ? def : Math.abs(v); };
        var mTop = mg('top', 72), mBottom = mg('bottom', 72), mLeft = mg('left', 72), mRight = mg('right', 72);
        var hDist = mg('header', 36), fDist = mg('footer', 36);
        ctx.marginLeft = mLeft; ctx.marginTop = mTop;
        design.page.margins = { top: Math.round(mTop), right: Math.round(mRight), bottom: Math.round(mBottom), left: Math.round(mLeft) };
        // Default font: the body text's (Normal style) font and size.
        var nf = {}; applyRPr(nf, ctx.styles.rPr); chain(ctx.styles, ctx.styles.defaultPara).forEach(function (st) { applyRPr(nf, st.rPr); });
        design.font = { name: 'TH SarabunPSK', size: Math.round(nf.sizeCs || nf.size || 14) };
        design.font.name = mapFont(ctx, nf.csFont || nf.latinFont || 'TH SarabunPSK');
        var colW = design.page.width - mLeft - mRight;

        ctx.fieldName = function (raw) {
          var n = String(raw).trim();
          if (!JD.NAME_RE.test(n)) {
            var known = Object.keys(ctx.fields).filter(function (k) { return ctx.fields[k] === n; })[0];
            if (known) return known;
            var i = 1; while (ctx.fields['field_' + i] !== undefined) i++;
            ctx.warn('Merge fields with Thai or other non-English names were renamed to field_1, field_2, … (the Word name is kept as the field description).');
            ctx.fields['field_' + i] = n;
            return 'field_' + i;
          }
          if (ctx.fields[n] === undefined) ctx.fields[n] = '';
          return n;
        };
        ctx.paramName = function (raw) { var n = String(raw).trim(); if (!JD.NAME_RE.test(n)) n = n.replace(/[^\w$.\-]/g, '_').replace(/^[^A-Za-z_$]/, '_'); ctx.params[n] = true; return n; };
        ctx.imageFor = function (rid, part) {
          var rel = (ctx.rels[part] || {})[rid];
          if (!rel || rel.mode === 'External') { ctx.warn('A linked (not embedded) picture was left out.'); return null; }
          var p = partPath(part, rel.target);
          if (ctx.imageNames[p] !== undefined) return ctx.imageNames[p];
          var ext = (p.split('.').pop() || '').toLowerCase();
          if (!IMAGE_TYPES[ext]) { ctx.imageNames[p] = null; ctx.skippedImages++; ctx.warn('Pictures that are not PNG, JPEG or GIF (e.g. EMF, WMF, SVG) were left out. Save them as PNG and add them in the designer.'); return null; }
          var base = 'docx_' + p.split('/').pop().replace(/[^A-Za-z0-9_.-]/g, '_');
          ctx.imageNames[p] = base;
          ctx.pendingImages.push({ name: base, path: p, mime: IMAGE_TYPES[ext] });
          return base;
        };
        ctx.pendingImages = [];

        // Header and footer bands.
        var bandHeights = { pageHeader: 0, pageFooter: 0 };
        var bandEls = { pageHeader: [], pageFooter: [] };
        d.hf.forEach(function (pt) {
          if (!pt.doc) return;
          ctx.part = pt.path;
          ctx.counters = {};
          var pages = layoutBody(ctx, pt.doc.documentElement, colW);
          var els = [], h = 0;
          pages.forEach(function (pg) { pg.els.forEach(function (e) { e.y += h; els.push(e); }); h += pg.height; });
          var key = pt.kind === 'header' ? 'pageHeader' : 'pageFooter';
          bandEls[key] = els;
          bandHeights[key] = Math.ceil(h);
        });
        ctx.part = 'word/document.xml';
        ctx.counters = {};
        // Header: from the header distance down to the Word top margin (or its content, if taller).
        if (bandEls.pageHeader.length) {
          var hh = Math.max(bandHeights.pageHeader, mTop - hDist);
          design.page.margins.top = Math.round(Math.min(hDist, mTop));
          design.bands.pageHeader = { height: Math.ceil(hh), elements: bandEls.pageHeader, props: [] };
        } else design.bands.pageHeader = { height: 0, elements: [], props: [], hidden: true };
        if (bandEls.pageFooter.length) {
          var fh = Math.max(bandHeights.pageFooter, mBottom - fDist);
          design.page.margins.bottom = Math.round(Math.min(fDist, mBottom));
          var shift = fh - bandHeights.pageFooter;                     // Word footers grow upwards from the footer distance
          bandEls.pageFooter.forEach(function (e) { e.y += Math.round(shift); });
          design.bands.pageFooter = { height: Math.ceil(fh), elements: bandEls.pageFooter, props: [] };
        } else design.bands.pageFooter = { height: 0, elements: [], props: [], hidden: true };

        // Body: each page → its own detail band (Detail 1, Detail 2, …), under the page header on every page.
        var pages = layoutBody(ctx, d.body, colW);
        var room = design.page.height - design.page.margins.top - design.page.margins.bottom -
          (design.bands.pageHeader.hidden ? 0 : design.bands.pageHeader.height) - (design.bands.pageFooter.hidden ? 0 : design.bands.pageFooter.height);
        var placed = JD.pagesToDetailBands(design, pages, room);
        placed.warnings.forEach(ctx.warn);
        ctx.pages = placed.pages;

        design.fields = Object.keys(ctx.fields).map(function (n) { return { name: n, cls: 'java.lang.String', desc: ctx.fields[n] }; });
        design.params = Object.keys(ctx.params).map(function (n) { return { name: n, cls: 'java.lang.String', def: '', desc: '', prompt: true }; });

        if (ctx.simplified) ctx.warn(ctx.simplified + ' paragraph' + (ctx.simplified > 1 ? 's' : '') + ' or table cell' + (ctx.simplified > 1 ? 's' : '') + ' mixed bold, italic, size or colour; each now uses the format of most of its text.');
        var fonts = Object.keys(ctx.unknownFonts);
        if (fonts.length) ctx.warn('Font' + (fonts.length > 1 ? 's' : '') + ' ' + fonts.join(', ') + (fonts.length > 1 ? ' are' : ' is') + ' not available in JasperServer here; ' + design.font.name + ' is used instead.');
        if (ctx.sections > 0) ctx.warn('The document has ' + (ctx.sections + 1) + ' sections; all use the page settings of the last one.');
        ctx.warn('Check text heights in the designer: Word wraps text a little differently from JasperReports.');

        // Pictures as data URLs (the designer keeps images that way).
        var total = 0;
        return Promise.all(ctx.pendingImages.map(function (im) {
          return zip.file(im.path) ? zip.file(im.path).async('base64').then(function (b64) {
            var size = Math.floor(b64.length * 3 / 4);
            if (size > MAX_IMAGE || total + size > 18 * 1024 * 1024) { ctx.warn('Picture ' + im.name + ' is larger than 5 MB (or the pictures together are too large) and was left out.'); return null; }
            total += size;
            return [im.name, 'data:' + im.mime + ';base64,' + b64];
          }) : null;
        })).then(function (list) {
          var images = {};
          list.forEach(function (x) { if (x) images[x[0]] = x[1]; });
          // Drop image elements whose picture could not be read.
          JD.bandList(design).forEach(function (b) {
            var band = design.bands[b[0]];
            band.elements = band.elements.filter(function (el) { return el.type !== 'image' || images[el.resource]; });
          });
          var clean = JD.sanitize(design);
          var count = 0;
          JD.bandList(clean).forEach(function (b) { count += clean.bands[b[0]].elements.length; });
          return { design: clean, images: images, count: count, warnings: ctx.warnings, fields: design.fields.length };
        });
      });
  }

  window.DocxImport = { parse: parse };
})();
