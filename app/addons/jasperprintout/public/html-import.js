// Jasper Designer: HTML form → design (browser only). The HTML is laid out by the browser in a
// hidden, script-free iframe as wide as the report's column, and what it draws is measured:
//   text → text elements at the measured position, font, size, weight, style, colour and alignment
//          (a line of runs keeps each run's own format; text that wraps becomes one element);
//   borders and backgrounds → boxes (rounded ones → rectangles); <hr> → lines;
//   <img> → image elements (SVG/WebP are converted to PNG); list bullets and numbers;
//   <input>/<textarea>/<select> → their box plus a text field $F{name} (or the value when the
//          name is not a valid field name); checkboxes and radio buttons → small boxes;
//   $F{x} / $P{x} / $V{x} / {{x}} in the text → text fields;
//   @page size and margins; CSS page breaks (break-before/after: page).
// Page 1 goes to the Title band and later pages to the Summary band (as the Word import does).
// Scripts in the HTML never run (the iframe is sandboxed without allow-scripts).
(function () {
  'use strict';
  var JD = window.JrxmlDesign;
  var PT = 0.75;                                        // CSS px → points
  var SARABUN_WEB = 1 / 0.67;                           // web Sarabun glyphs are 1.5× TH Sarabun's at the same size
  var THAI = /[฀-๿]/;
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1, BUTTON: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, MAP: 1 };
  var MM = 72 / 25.4;

  // ─── small helpers ──────────────────────────────────────────────────────────
  function rgb(c) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(c || '');
    if (!m) return null;
    var a = m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 0.1) return null;
    var hex = function (v) { return ('0' + Math.round(Number(v)).toString(16)).slice(-2); };
    return ('#' + hex(m[1]) + hex(m[2]) + hex(m[3])).toUpperCase();
  }
  function length(v, def) {                              // CSS length → points
    var m = /^(-?[\d.]+)\s*(mm|cm|in|pt|px|pc)?$/.exec(String(v || '').trim());
    if (!m) return def;
    var n = parseFloat(m[1]);
    return { mm: n * MM, cm: n * MM * 10, in: n * 72, pt: n, pc: n * 12, px: n * PT }[m[2] || 'px'];
  }
  var javaString = function (s) { return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'; };
  var PLACEHOLDER = /\$([FPV])\{([^}\s]+)\}|\{\{\s*([^}\s]+)\s*\}\}/g;

  function isBlock(cs) { return !/^inline/.test(cs.display) && cs.display !== 'contents' && cs.display !== 'none'; }
  function hidden(el, cs) { return cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || Number(cs.opacity) === 0 || el.hidden; }

  // ─── fonts ──────────────────────────────────────────────────────────────────
  // Computed font → { font, factor } (factor turns the measured CSS size into the Jasper size).
  function mapFont(family, text) {
    var list = String(family || '').split(',').map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); });
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (/^TH\s*Sarabun\s*New/i.test(f)) return { font: 'TH Sarabun New', factor: 1 };
      if (/^TH\s*Sarabun/i.test(f)) return { font: 'TH SarabunPSK', factor: 1 };
      if (/sarabun/i.test(f)) return { font: 'TH SarabunPSK', factor: SARABUN_WEB };
      if (/^tahoma$/i.test(f)) return { font: 'Tahoma', factor: 1 };
      if (/^(arial|helvetica)/i.test(f)) return THAI.test(text) ? { font: 'TH SarabunPSK', factor: SARABUN_WEB } : { font: 'Arial', factor: 1 };
      if (/^(times|georgia|cambria|serif$)/i.test(f)) return THAI.test(text) ? { font: 'TH SarabunPSK', factor: SARABUN_WEB } : { font: 'Serif', factor: 1 };
      if (/(courier|consolas|mono)/i.test(f)) return { font: 'Monospaced', factor: 1 };
    }
    return THAI.test(text) ? { font: 'TH SarabunPSK', factor: SARABUN_WEB } : { font: 'SansSerif', factor: 1 };
  }

  // ─── page setup from @page ──────────────────────────────────────────────────
  function pageRule(doc) {
    var out = {};
    Array.prototype.forEach.call(doc.styleSheets, function (sheet) {
      var rules;
      try { rules = sheet.cssRules; } catch (e) { return; }                   // cross-origin stylesheet
      Array.prototype.forEach.call(rules || [], function (r) {
        if (r.type !== 6 || r.selectorText) return;                            // CSSPageRule without :first / :left
        var size = r.style.getPropertyValue('size'), margin = r.style.getPropertyValue('margin');
        if (size) out.size = size.trim();
        if (margin) out.margin = margin.trim();
        ['top', 'right', 'bottom', 'left'].forEach(function (k) { var v = r.style.getPropertyValue('margin-' + k); if (v) (out.m = out.m || {})[k] = v; });
      });
    });
    return out;
  }
  function pageSetup(rule, choice) {
    var page = { size: 'A4', orientation: 'portrait', width: 595, height: 842, margins: { top: 28, right: 28, bottom: 28, left: 28 } };
    var size = choice && choice !== 'auto' ? choice : rule.size || '';
    var tokens = size.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.indexOf('landscape') >= 0) page.orientation = 'landscape';
    var named = Object.keys(JD.PAGES).filter(function (k) { return tokens.indexOf(k.toLowerCase()) >= 0; })[0];
    var lens = tokens.map(function (t) { return length(t, null); }).filter(function (v) { return v != null; });
    if (named) page.size = named;
    else if (lens.length === 2) { page.size = 'Custom'; page.width = Math.round(lens[0]); page.height = Math.round(lens[1]); page.orientation = lens[0] > lens[1] ? 'landscape' : 'portrait'; }
    if (page.size !== 'Custom') {
      var wh = JD.PAGES[page.size];
      page.width = page.orientation === 'landscape' ? wh[1] : wh[0];
      page.height = page.orientation === 'landscape' ? wh[0] : wh[1];
    }
    if (rule.margin) {
      var m = rule.margin.split(/\s+/).map(function (t) { return length(t, 28); });
      var t = m[0], r = m[1] != null ? m[1] : t, b = m[2] != null ? m[2] : t, l = m[3] != null ? m[3] : r;
      page.margins = { top: t, right: r, bottom: b, left: l };
    }
    if (rule.m) Object.keys(rule.m).forEach(function (k) { page.margins[k] = length(rule.m[k], page.margins[k]); });
    Object.keys(page.margins).forEach(function (k) { page.margins[k] = Math.max(0, Math.round(page.margins[k])); });
    return page;
  }

  // ─── rendering ──────────────────────────────────────────────────────────────
  function render(html, widthPx, heightPx) {
    return new Promise(function (resolve, reject) {
      var frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-same-origin');                      // no scripts
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;left:-30000px;top:0;width:' + widthPx + 'px;height:' + (heightPx || 1123) + 'px;border:0;opacity:0;pointer-events:none';
      // body margin 0: the report margins replace the page margins of the HTML.
      var inject = '<style>html,body{margin:0 !important}</style>';
      var doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function (m) { return m + inject; }) : inject + html;
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; frame.remove(); reject(new Error('The HTML took too long to load.')); } }, 20000);
      frame.onload = function () {
        if (done) return;
        var d = frame.contentDocument;
        var imgs = Array.prototype.slice.call(d.images).map(function (im) {
          return im.complete ? Promise.resolve() : new Promise(function (ok) { im.onload = im.onerror = ok; setTimeout(ok, 6000); });
        });
        Promise.all(imgs.concat([d.fonts ? d.fonts.ready.catch(function () {}) : Promise.resolve()])).then(function () {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve(frame);
        });
      };
      frame.srcdoc = doc;
      document.body.appendChild(frame);
    });
  }

  // ─── image data ─────────────────────────────────────────────────────────────
  function imageData(img) {
    var src = img.currentSrc || img.src || '';
    var ok = /^data:image\/(png|jpeg|gif);base64,/i;
    if (ok.test(src)) return Promise.resolve(src.replace(/^data:image\/(\w+)/i, function (m, t) { return 'data:image/' + t.toLowerCase(); }));
    function viaCanvas() {
      try {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
        if (!c.width || !c.height) return null;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.toDataURL('image/png');
      } catch (e) { return null; }                                           // cross-origin picture
    }
    if (/^data:/i.test(src) || /^blob:/i.test(src)) return Promise.resolve(viaCanvas());
    return fetch(src).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); }).then(function (b) {
      if (!/^image\/(png|jpeg|gif)$/.test(b.type)) return viaCanvas();
      return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(b); });
    }).catch(function () { return viaCanvas(); });
  }

  // ─── measuring ──────────────────────────────────────────────────────────────
  function parse(html, opts) {
    opts = opts || {};
    var warnings = [];
    var warn = function (m) { if (warnings.indexOf(m) < 0) warnings.push(m); };
    if (!/<[a-z!]/i.test(String(html || ''))) return Promise.reject(new Error('That does not look like HTML.'));
    // First pass at A4 to read @page, then lay out at the real column width.
    var frame;
    return render(html, 794).then(function (f) {
      var rule = pageRule(f.contentDocument);
      f.remove();
      var page = pageSetup(rule, opts.pageSize);
      var colPt = page.width - page.margins.left - page.margins.right;
      var colPx = Math.round(colPt / PT);
      return render(html, colPx, Math.round((page.height - page.margins.top - page.margins.bottom) / PT)).then(function (f2) { frame = f2; return measure(f2, page, colPx, opts, warn); });
    }).then(function (r) {
      frame.remove();
      r.warnings = warnings;
      return r;
    }, function (err) { if (frame) frame.remove(); throw err; });
  }

  function measure(frame, page, colPx, opts, warn) {
    var win = frame.contentWindow, doc = frame.contentDocument, body = doc.body;
    if (!body) throw new Error('The HTML has no body.');
    var fullW = Math.max(colPx, doc.documentElement.scrollWidth, body.scrollWidth);
    var scale = colPx / fullW;                            // a page wider than the column is scaled down to fit
    if (scale < 0.98) warn('The HTML is ' + fullW + ' px wide and was scaled to ' + Math.round(scale * 100) + '% to fit the page.');
    var k = PT * scale;
    var origin = doc.documentElement.getBoundingClientRect();
    var P = function (v) { return v * k; };
    var X = function (v) { return (v - origin.left) * k; };
    var Y = function (v) { return (v - origin.top) * k; };

    var name = JD.sanitize({ name: String(opts.fileName || '').replace(/\.html?$/i, '') }).name;
    var design = JD.newDesign(name === 'New_Report' || /^_*$/.test(name) ? 'HTML_Report' : name);
    design.page = page;
    var els = [], breaks = [], images = {}, pending = [], fields = {}, params = {}, counts = { thaiFields: 0, mixed: 0, svg: 0, bgImage: 0, pseudo: 0 };
    var fontTally = {};

    function fieldName(raw) {
      var n = String(raw).trim();
      if (JD.NAME_RE.test(n)) { if (fields[n] === undefined) fields[n] = ''; return n; }
      var known = Object.keys(fields).filter(function (f) { return fields[f] === n; })[0];
      if (known) return known;
      var i = 1; while (fields['field_' + i] !== undefined) i++;
      fields['field_' + i] = n; counts.thaiFields++;
      return 'field_' + i;
    }
    function paramName(raw) { var n = String(raw).trim(); if (!JD.NAME_RE.test(n)) n = n.replace(/[^\w$.\-]/g, '_').replace(/^[^A-Za-z_$]/, '_'); params[n] = true; return n; }
    // Text with placeholders → expression, or null when there are none.
    function toExpression(text) {
      PLACEHOLDER.lastIndex = 0;
      if (!PLACEHOLDER.test(text)) return null;
      var out = [], last = 0, m;
      PLACEHOLDER.lastIndex = 0;
      while ((m = PLACEHOLDER.exec(text))) {
        if (m.index > last) out.push(javaString(text.slice(last, m.index)));
        var kind = m[1] || 'F', nm = m[2] || m[3];
        out.push('$' + kind + '{' + (kind === 'P' ? paramName(nm) : kind === 'V' ? nm : fieldName(nm)) + '}');
        last = m.index + m[0].length;
      }
      if (last < text.length) out.push(javaString(text.slice(last)));
      return out.join(' + ');
    }
    function format(cs, text) {
      var f = mapFont(cs.fontFamily, text);
      var size = Math.max(4, Math.round(parseFloat(cs.fontSize) * k * f.factor * 2) / 2);
      fontTally[f.font + '|' + size] = (fontTally[f.font + '|' + size] || 0) + text.length;
      var deco = cs.textDecorationLine || cs.textDecoration || '';
      return {
        font: f.font, size: size, bold: Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold', italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
        underline: /underline/.test(deco), strike: /line-through/.test(deco), color: rgb(cs.color) || '#000000',
        transform: cs.textTransform
      };
    }
    function textEl(text, fmt, box) {
      if (fmt.transform === 'uppercase') text = text.toUpperCase(); else if (fmt.transform === 'lowercase') text = text.toLowerCase();
      var expr = toExpression(text);
      // Jasper leaves out lines that do not fit, so the box is at least as tall as its lines.
      var need = (box.lines || 1) * fmt.size * (/sarabun/i.test(fmt.font) ? 1.13 : 1.18) + 1;
      if (box.height < need) { box.y -= (need - box.height) / 2; box.height = need; box.y = Math.max(0, box.y); }
      var el = JD.newElement(expr ? 'textField' : 'staticText', {
        x: Math.round(box.x), y: Math.round(box.y), width: Math.max(4, Math.round(box.width)), height: Math.max(4, Math.round(box.height)),
        fontName: fmt.font, fontSize: fmt.size, bold: fmt.bold, italic: fmt.italic, underline: fmt.underline, strike: fmt.strike,
        forecolor: fmt.color, hAlign: box.hAlign || 'Left', vAlign: box.vAlign || 'Middle'
      });
      el.box.pad = { top: 0, left: 1, bottom: 0, right: 1 };
      if (expr) { el.expression = expr; if (box.stretch) el.textAdjust = 'StretchHeight'; } else el.text = text;
      return el;
    }
    var ALIGN = { left: 'Left', start: 'Left', center: 'Center', '-webkit-center': 'Center', right: 'Right', end: 'Right', justify: 'Justified', '-webkit-right': 'Right' };
    function align(cs) { var a = ALIGN[cs.textAlign] || 'Left'; return cs.direction === 'rtl' && (cs.textAlign === 'start') ? 'Right' : a; }

    // Borders and background of an element → a box (or a rounded rectangle).
    function boxOf(el, cs, r) {
      if (el === body || el === doc.documentElement) {
        if (rgb(cs.backgroundColor) && rgb(cs.backgroundColor) !== '#FFFFFF') warn('The page background colour was left out.');
        return;
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') counts.bgImage++;
      var sides = {}, any = false;
      ['top', 'left', 'bottom', 'right'].forEach(function (s) {
        var w = parseFloat(cs['border' + s[0].toUpperCase() + s.slice(1) + 'Width']) || 0, st = cs['border' + s[0].toUpperCase() + s.slice(1) + 'Style'];
        var c = rgb(cs['border' + s[0].toUpperCase() + s.slice(1) + 'Color']);
        if (w > 0 && c && st !== 'none' && st !== 'hidden') {
          sides[s] = { w: Math.max(0.25, Math.round(P(w) * 4) / 4), s: st === 'dashed' ? 'Dashed' : st === 'dotted' ? 'Dotted' : st === 'double' ? 'Double' : 'Solid', c: c };
          any = true;
        }
      });
      var bg = rgb(cs.backgroundColor);
      if (bg === '#FFFFFF' && !any) bg = null;
      if (!any && !bg) return;
      var box = { x: X(r.left), y: Y(r.top), width: P(r.width), height: P(r.height) };
      if (box.width < 0.5 || box.height < 0.5) return;
      var radius = parseFloat(cs.borderTopLeftRadius) || 0;
      var uniform = any && ['left', 'bottom', 'right'].every(function (s) { return sides[s] && sides.top && sides[s].w === sides.top.w && sides[s].c === sides.top.c && sides[s].s === sides.top.s; });
      var e;
      if (radius > 1 && (uniform || !any)) {
        e = JD.newElement('rectangle', { radius: Math.round(P(radius)), lineWidth: any ? sides.top.w : 0, lineColor: any ? sides.top.c : '#000000', lineStyle: any ? sides.top.s : 'Solid' });
      } else {
        e = JD.newElement('staticText', { text: '', box: JD.emptyBox() });
        ['top', 'left', 'bottom', 'right'].forEach(function (s) { if (sides[s]) e.box.sides[s] = sides[s]; });
      }
      Object.assign(e, { x: Math.round(box.x), y: Math.round(box.y), width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) });
      if (bg) { e.backcolor = bg; e.opaque = true; }
      els.push(e);
    }

    // The text of a block (its own text nodes and <br>s, not those of nested blocks), as runs.
    function runsOf(block) {
      var runs = [];
      (function walk(node) {
        for (var n = node.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3) {
            var data = n.data, pcs = win.getComputedStyle(n.parentNode);
            if (!/pre/.test(pcs.whiteSpace)) data = data.replace(/\s+/g, ' ');
            if (!data.trim()) { if (runs.length && data) runs.push({ space: true }); continue; }
            var range = doc.createRange(); range.selectNodeContents(n);
            var rects = Array.prototype.filter.call(range.getClientRects(), function (q) { return q.width > 0.5 && q.height > 0.5; });
            if (!rects.length) continue;
            runs.push({ text: data, cs: pcs, rects: rects, node: n });
          } else if (n.nodeType === 1) {
            if (n.tagName === 'BR') { runs.push({ br: true }); continue; }
            if (SKIP[n.tagName] || /^(INPUT|TEXTAREA|SELECT|IMG|SVG|HR)$/i.test(n.tagName)) continue;
            var cs = win.getComputedStyle(n);
            if (hidden(n, cs) || isBlock(cs) || cs.position === 'absolute' || cs.position === 'fixed') continue;   // its own block
            walk(n);
          }
        }
      })(block);
      return runs;
    }

    function blockText(block, cs) {
      var runs = runsOf(block);
      var real = runs.filter(function (r) { return r.text; });
      if (!real.length) return;
      var content = block.getBoundingClientRect();
      var padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), padR = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
      var cLeft = content.left + padL, cRight = content.right - padR;
      var hAlign = align(cs);
      var wraps = real.some(function (r) { return r.rects.length > 1; }) || runs.some(function (r) { return r.br; });
      var lineTops = {};
      real.forEach(function (r) { lineTops[Math.round(r.rects[0].top)] = true; });
      var lines = Object.keys(lineTops).length;
      if (!wraps) {
        // One element per run on each line: exact positions, each run with its own format.
        var byLine = {};
        real.forEach(function (r) { var key = Math.round(r.rects[0].top + r.rects[0].height / 2); (byLine[key] = byLine[key] || []).push(r); });
        Object.keys(byLine).forEach(function (key) {
          var line = byLine[key].sort(function (a, b) { return a.rects[0].left - b.rects[0].left; });
          // Runs of the same format next to each other are joined (e.g. text split by an empty <span>).
          var merged = [];
          line.forEach(function (r) {
            var fmt = format(r.cs, r.text), last = merged[merged.length - 1];
            if (last && JSON.stringify(last.fmt) === JSON.stringify(fmt) && r.rects[0].left - last.right < 3) {
              last.text += (r.rects[0].left - last.right > 1 && !/\s$/.test(last.text) ? ' ' : '') + r.text; last.right = r.rects[0].right;
              last.top = Math.min(last.top, r.rects[0].top); last.bottom = Math.max(last.bottom, r.rects[0].bottom);
            } else merged.push({ text: r.text, fmt: fmt, left: r.rects[0].left, right: r.rects[0].right, top: r.rects[0].top, bottom: r.rects[0].bottom });
          });
          merged.forEach(function (m, i) {
            var text = m.text.trim();
            if (!text) return;
            var leftLimit = i ? merged[i - 1].right + 1 : cLeft, rightLimit = i < merged.length - 1 ? merged[i + 1].left - 1 : cRight;
            var x0, x1, ha;
            if (merged.length === 1 && (hAlign === 'Center' || hAlign === 'Justified')) { x0 = cLeft; x1 = cRight; ha = hAlign; }   // alone on its line: the block's width
            else if (hAlign === 'Right' && i === merged.length - 1) { x0 = merged.length === 1 ? cLeft : leftLimit; x1 = m.right + 1; ha = 'Right'; }
            else if (hAlign === 'Center') { var slack = Math.min(m.left - leftLimit, rightLimit - m.right); x0 = m.left - slack; x1 = m.right + slack; ha = 'Center'; }
            else { x0 = m.left - 1; x1 = rightLimit; ha = 'Left'; }                                     // starts where the text starts (e.g. after a checkbox)
            if (x1 - x0 < m.right - m.left) { x0 = m.left - 1; x1 = m.right + 1; }
            // A line of text must stay one line: Jasper's fonts measure a little wider than the browser's,
            // so a box as tight as the text gets room past its end (empty box space draws nothing).
            var room = Math.max(6, (m.right - m.left) * 0.12) - ((x1 - x0) - (m.right - m.left));
            if (room > 0) { if (ha === 'Right') x0 -= room; else if (ha === 'Center') { x0 -= room / 2; x1 += room / 2; } else x1 += room; }
            els.push(textEl(text, m.fmt, { x: X(x0), y: Y(m.top), width: P(x1 - x0), height: P(m.bottom - m.top) + 1, hAlign: ha, vAlign: 'Middle' }));
          });
        });
        return;
      }
      // Wrapping text: one element over all its lines, in the format of most of its text.
      var text = '', tally = {}, best = null, top = Infinity, bottom = -Infinity;
      runs.forEach(function (r) {
        if (r.br) { text = text.replace(/ $/, '') + '\n'; return; }
        if (r.space) { if (text && !/[\s\n]$/.test(text)) text += ' '; return; }
        var t = /\n$/.test(text) || !text ? r.text.replace(/^ /, '') : r.text;
        text += t;
        var fmt = format(r.cs, r.text), key = JSON.stringify(fmt);
        tally[key] = (tally[key] || 0) + r.text.length;
        if (!best || tally[key] > tally[JSON.stringify(best)]) best = fmt;
        r.rects.forEach(function (q) { top = Math.min(top, q.top); bottom = Math.max(bottom, q.bottom); });
      });
      if (Object.keys(tally).length > 1) counts.mixed++;
      text = text.replace(/[ \t]+\n/g, '\n').trim();
      if (!text) return;
      var extra = Math.max(2, (bottom - top) / Math.max(1, lines) * 0.25);   // a little room: Jasper wraps a bit differently
      els.push(textEl(text, best, { x: X(cLeft), y: Y(top), width: P(cRight - cLeft), height: P(bottom - top + extra), hAlign: hAlign, vAlign: 'Top', stretch: true, lines: Math.max(lines, text.split('\n').length) }));
    }

    function listMarker(li, cs) {
      var type = cs.listStyleType;
      if (!type || type === 'none' || cs.listStylePosition === 'inside') return;
      var first = runsOf(li).filter(function (r) { return r.text; })[0];
      var r = li.getBoundingClientRect(), top = first ? first.rects[0].top : r.top, h = first ? first.rects[0].height : parseFloat(cs.fontSize) * 1.2;
      var text = { disc: '•', circle: '◦', square: '▪' }[type];
      if (!text) {
        var list = li.parentNode, start = list && list.tagName === 'OL' && list.getAttribute('start') ? Number(list.getAttribute('start')) : 1;
        var idx = li.value || (Array.prototype.filter.call(list ? list.children : [], function (c) { return c.tagName === 'LI'; }).indexOf(li) + start);
        text = type === 'lower-alpha' || type === 'lower-latin' ? String.fromCharCode(96 + idx) + '.' :
          type === 'upper-alpha' || type === 'upper-latin' ? String.fromCharCode(64 + idx) + '.' :
            type === 'thai' ? String(idx).replace(/\d/g, function (d) { return String.fromCharCode(0x0E50 + Number(d)); }) + '.' :
              type === 'lower-roman' ? ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][idx - 1] + '.' : idx + '.';
      }
      var w = parseFloat(cs.fontSize) * 2;
      els.push(textEl(text, format(cs, text), { x: X(r.left - w - 2), y: Y(top), width: P(w), height: P(h) + 1, hAlign: 'Right', vAlign: 'Middle' }));
    }

    function formControl(el, cs, r) {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (el.tagName === 'INPUT' && /^(hidden|submit|reset|button|image|file)$/.test(type)) return;
      boxOf(el, cs, r);
      var box = { x: X(r.left), y: Y(r.top), width: P(r.width), height: P(r.height) };
      if (type === 'checkbox' || type === 'radio') {
        if (!(parseFloat(cs.borderTopWidth) > 0)) {                            // native control: draw its box
          var b = JD.newElement('rectangle', { x: Math.round(box.x), y: Math.round(box.y), width: Math.max(6, Math.round(box.width)), height: Math.max(6, Math.round(box.height)), radius: type === 'radio' ? Math.round(box.width / 2) : 1, lineWidth: 0.75 });
          els.push(b);
        }
        if (el.checked) els.push(textEl('X', { font: 'SansSerif', size: Math.max(5, Math.round(box.height * 0.8)), bold: true, color: '#000000' }, { x: box.x, y: box.y, width: Math.max(6, box.width), height: Math.max(6, box.height), hAlign: 'Center', vAlign: 'Middle' }));
        return;
      }
      var nm = el.getAttribute('name') || el.id || '';
      var value = el.tagName === 'SELECT' ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '') : el.value;
      var pad = { l: parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), r: parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth) };
      var inner = { x: X(r.left + pad.l), y: box.y, width: P(r.width - pad.l - pad.r), height: box.height, hAlign: align(cs), vAlign: el.tagName === 'TEXTAREA' ? 'Top' : 'Middle', stretch: el.tagName === 'TEXTAREA' };
      var fmt = format(cs, value || nm || 'x');
      // Named input → a text field for that name (a Thai name becomes field_N); otherwise its value.
      var text = nm && (JD.NAME_RE.test(nm) || !value) ? '$F{' + nm + '}' : value;
      if (!text) return;
      els.push(textEl(text, fmt, inner));
    }

    // Walk the page in document order (boxes before their text, so text stays on top).
    (function walk(el) {
      for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (SKIP[c.tagName]) continue;
        var cs = win.getComputedStyle(c);
        if (hidden(c, cs)) continue;
        var r = c.getBoundingClientRect();
        if (/^(always|page|left|right|recto|verso)$/.test(cs.breakBefore) || cs.pageBreakBefore === 'always') breaks.push(Y(r.top));
        if (c.tagName === 'svg' || c.tagName === 'SVG') { counts.svg++; continue; }
        if (c.tagName === 'IMG') {
          if (r.width > 0 && r.height > 0) pending.push({ img: c, box: { x: X(r.left), y: Y(r.top), width: P(r.width), height: P(r.height) }, index: els.length });
          els.push(null);                                                    // keeps its place in the drawing order
          continue;
        }
        if (c.tagName === 'HR') {
          var col = rgb(cs.borderTopColor) || '#999999';
          els.push(JD.newElement('line', { x: Math.round(X(r.left)), y: Math.round(Y(r.top + r.height / 2)), width: Math.max(1, Math.round(P(r.width))), height: 1, lineWidth: Math.max(0.5, Math.round(P(parseFloat(cs.borderTopWidth) || 1) * 4) / 4), lineColor: col }));
          continue;
        }
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(c.tagName)) { formControl(c, cs, r); continue; }
        try { if (win.getComputedStyle(c, '::before').content !== 'none' || win.getComputedStyle(c, '::after').content !== 'none') counts.pseudo++; } catch (e) { /* ignore */ }
        boxOf(c, cs, r);
        if (isBlock(cs) || cs.position === 'absolute' || cs.position === 'fixed') {
          if (cs.display === 'list-item') listMarker(c, cs);
          blockText(c, cs);
        }
        walk(c);
        if (/^(always|page|left|right|recto|verso)$/.test(cs.breakAfter) || cs.pageBreakAfter === 'always') breaks.push(Y(r.bottom));
      }
    })(body);
    blockText(body, win.getComputedStyle(body));

    // Pictures (in the order they are drawn).
    var n = 0;
    return Promise.all(pending.map(function (p) {
      return imageData(p.img).then(function (url) {
        if (!url) { warn('Some pictures could not be read (another site\'s picture or a broken link) and were left out. Use pictures embedded as data: URLs, or add them in the designer.'); return; }
        if (url.length * 0.75 > 5 * 1024 * 1024) { warn('Pictures larger than 5 MB were left out.'); return; }
        var ext = /^data:image\/(png|jpeg|gif)/.exec(url)[1].replace('jpeg', 'jpg');
        var nm = 'html_image' + (++n) + '.' + ext;
        images[nm] = url;
        els[p.index] = JD.newElement('image', { x: Math.round(p.box.x), y: Math.round(p.box.y), width: Math.max(2, Math.round(p.box.width)), height: Math.max(2, Math.round(p.box.height)), source: 'resource', resource: nm, scale: 'FillFrame' });
      });
    })).then(function () {
      els = els.filter(Boolean);
      // Most used font → the report's default font.
      var top = Object.keys(fontTally).sort(function (a, b) { return fontTally[b] - fontTally[a]; })[0];
      if (top) { var fs = top.split('|'); design.font = { name: fs[0], size: Math.round(Number(fs[1])) }; }
      var colW = page.width - page.margins.left - page.margins.right;
      els.forEach(function (e) {
        // Inside the column (the extra room given to text may reach past its edges).
        if (e.x < 0) { e.width += e.x; e.x = 0; }
        if (e.x + e.width > colW) e.width = Math.max(2, colW - e.x);
        if (e.x >= colW) e.x = Math.max(0, colW - e.width);
        if (e.type !== 'staticText' && e.type !== 'textField') return;
        if (e.fontName === design.font.name) e.fontName = '';
        if (e.fontSize === design.font.size) e.fontSize = 0;
      });

      // Pages: CSS page breaks, then anything taller than a page is split.
      var room = page.height - page.margins.top - page.margins.bottom;
      var cuts = breaks.filter(function (b) { return b > 1; }).sort(function (a, b) { return a - b; });
      var pages = [], from = 0;
      cuts.concat([Infinity]).forEach(function (cut) {
        // By its middle: a text box grown to fit its font may start a little above the break.
        var part = els.filter(function (e) { var mid = e.y + e.height / 2; return mid >= from && mid < cut; });
        if (part.length || !pages.length) {
          var h = 0;
          part.forEach(function (e) { e.y = Math.max(0, Math.round(e.y - from)); h = Math.max(h, e.y + e.height); });
          pages.push({ els: part, height: h });
        }
        from = cut;
      });
      // Each page → its own detail band (Detail 1, Detail 2, …).
      ['pageHeader', 'pageFooter'].forEach(function (b) { design.bands[b] = { height: 0, elements: [], props: [], hidden: true }; });
      JD.pagesToDetailBands(design, pages, room).warnings.forEach(warn);
      design.fields = Object.keys(fields).map(function (f) { return { name: f, cls: 'java.lang.String', desc: fields[f] }; });
      design.params = Object.keys(params).map(function (p) { return { name: p, cls: 'java.lang.String', def: '', desc: '', prompt: true }; });

      if (counts.thaiFields) warn('Fields with Thai or other non-English names were renamed to field_1, field_2, … (the original name is kept as the field description).');
      if (counts.mixed) warn(counts.mixed + ' wrapping paragraph' + (counts.mixed > 1 ? 's' : '') + ' mixed bold, italic, size or colour; each now uses the format of most of its text.');
      if (counts.svg) warn('Inline SVG drawings were left out. Use <img> with a PNG instead, or add the picture in the designer.');
      if (counts.bgImage) warn('CSS background images were left out.');
      if (counts.pseudo) warn('Text from CSS ::before / ::after was left out.');
      var count = 0;
      var clean = JD.sanitize(design);
      JD.bandList(clean).forEach(function (b) { count += clean.bands[b[0]].elements.length; if (design.bands[b[0]] && design.bands[b[0]].elements.length > 2000) warn('A band had more than 2000 elements; the rest were left out.'); });
      return { design: clean, images: images, count: count, fields: design.fields.length };
    });
  }

  window.HtmlImport = { parse: parse };
})();
