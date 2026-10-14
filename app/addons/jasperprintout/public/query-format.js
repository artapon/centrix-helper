// Pretty-prints a Jaspersoft MongoDB query (JSON-like text): one key per line, two-space indent,
// short objects and arrays kept on one line. $P{…}/$P!{…}, strings (with their own quotes),
// ObjectId("…")-style calls and comments are kept exactly as written.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QueryFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var WIDTH = 90;

  function tokenize(src) {
    var out = [], i = 0, n = src.length;
    var err = function (msg) { var e = new Error(msg); e.pos = i; throw e; };
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { var e1 = src.indexOf('\n', i); e1 = e1 < 0 ? n : e1; out.push({ t: 'comment', v: src.slice(i, e1).trimEnd() }); i = e1; continue; }
      if (c === '/' && src[i + 1] === '*') { var e2 = src.indexOf('*/', i + 2); if (e2 < 0) err('A /* comment is not closed.'); out.push({ t: 'comment', v: src.slice(i, e2 + 2) }); i = e2 + 2; continue; }
      if (c === '"' || c === "'") {
        var j = i + 1;
        while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
        if (j >= n) err('A string starting with ' + c + ' is not closed.');
        out.push({ t: 'atom', v: src.slice(i, j + 1) }); i = j + 1; continue;
      }
      var m = /^\$[PFVRX]!?\{[^}]*\}/.exec(src.slice(i, i + 300));
      if (m) { out.push({ t: 'atom', v: m[0] }); i += m[0].length; continue; }
      if ('{}[],:'.indexOf(c) >= 0) { out.push({ t: c }); i++; continue; }
      // a word: number, identifier, true/false/null, or a call like ObjectId("…") taken whole
      var k = i;
      while (k < n && !/[\s{}\[\],:'"]/.test(src[k]) && !(src[k] === '/' && (src[k + 1] === '/' || src[k + 1] === '*'))) {
        if (src[k] === '$' && /^\$[PFVRX]!?\{/.test(src.slice(k, k + 4)) && k > i) break;
        if (src[k] === '(') {
          var depth = 0;
          for (; k < n; k++) {
            var ch = src[k];
            if (ch === '"' || ch === "'") { var q = ch; k++; while (k < n && src[k] !== q) { if (src[k] === '\\') k++; k++; } continue; }
            if (ch === '(') depth++;
            else if (ch === ')') { depth--; if (!depth) { k++; break; } }
          }
          if (depth) err('A ( is not closed.');
          break;
        }
        k++;
      }
      if (k === i) err('Unexpected "' + c + '".');
      out.push({ t: 'atom', v: src.slice(i, k) }); i = k;
    }
    return out;
  }

  function parse(tokens) {
    var p = 0;
    var peek = function () { return tokens[p]; };
    var fail = function (msg) { throw new Error(msg); };
    var comments = function (list) { while (peek() && peek().t === 'comment') list.push({ comment: tokens[p++].v }); };
    function value() {
      var t = peek();
      if (!t) fail('The query ends too early.');
      if (t.t === '{') return container('{', '}');
      if (t.t === '[') return container('[', ']');
      if (t.t === 'atom') {
        var parts = [tokens[p++].v];
        while (peek() && peek().t === 'atom') parts.push(tokens[p++].v);   // e.g. new Date("…")
        return { atom: parts.join(' ') };
      }
      fail('Unexpected "' + (t.v || t.t) + '".');
    }
    function container(open, close) {
      p++;
      var node = { open: open, close: close, items: [] };
      for (;;) {
        comments(node.items);
        if (!peek()) fail('A ' + open + ' is not closed.');
        if (peek().t === close) { p++; return node; }
        var item = {};
        if (open === '{') {
          var k = peek();
          if (!k || k.t !== 'atom') fail('Expected a key, found "' + (k ? k.v || k.t : 'the end') + '".');
          item.key = tokens[p++].v;
          if (!peek() || peek().t !== ':') fail('Expected ":" after ' + item.key + '.');
          p++;
        }
        item.value = value();
        node.items.push(item);
        comments(node.items);
        if (peek() && peek().t === ',') { p++; continue; }
        comments(node.items);
        if (peek() && peek().t === close) { p++; return node; }
        fail('Expected "," or "' + close + '" after ' + (item.key || 'a value') + '.');
      }
    }
    var lead = [];
    comments(lead);
    var root = value();
    var tail = [];
    comments(tail);
    if (p < tokens.length) fail('Unexpected text after the query: "' + (tokens[p].v || tokens[p].t) + '".');
    return { lead: lead, root: root, tail: tail };
  }

  function inline(node) {
    if (node.atom !== undefined) return node.atom;
    if (node.items.some(function (i) { return i.comment !== undefined; })) return null;
    var parts = [];
    for (var i = 0; i < node.items.length; i++) {
      var v = inline(node.items[i].value);
      if (v === null) return null;
      parts.push(node.items[i].key !== undefined ? node.items[i].key + ': ' + v : v);
    }
    if (!parts.length) return node.open + node.close;
    return node.open === '{' ? '{ ' + parts.join(', ') + ' }' : '[' + parts.join(', ') + ']';
  }

  function print(node, ind, prefixLen) {
    var flat = inline(node);
    if (flat !== null && ind.length + prefixLen + flat.length <= WIDTH) return flat;
    var inner = ind + '  ', lines = [];
    var real = node.items.filter(function (i) { return i.comment === undefined; });
    var seen = 0;
    node.items.forEach(function (it) {
      if (it.comment !== undefined) { lines.push(inner + it.comment); return; }
      seen++;
      var key = it.key !== undefined ? it.key + ': ' : '';
      lines.push(inner + key + print(it.value, inner, key.length) + (seen < real.length ? ',' : ''));
    });
    return node.open + '\n' + lines.join('\n') + '\n' + ind + node.close;
  }

  function format(src) {
    var tree = parse(tokenize(String(src || '')));
    var out = tree.lead.map(function (c) { return c.comment; });
    out.push(print(tree.root, '', 0));
    tree.tail.forEach(function (c) { out.push(c.comment); });
    return out.join('\n');
  }

  return { format: format };
});
