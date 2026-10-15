/* Jasper Designer: local preview. Fills a design with rows and lays its bands out into pages,
 * the way JasperReports does in outline, so a report can be checked without JasperServer.
 *
 *   JrxmlFill.fill(design, rows, { params: { name: 'text' }, locale: 'en_US', images: { name: dataUrl } })
 *     → { pages: [{ num, width, height, items: [{ el, band, x, y, w, h, text, src }] }], warnings, empty }
 *   JrxmlFill.evaluate(expression, ctx)
 *
 * Expressions are read by a small parser (never eval): $F{} $P{} $V{} $R{}, string/number literals,
 * + - * / % == != < > <= >= && || ! ?:, casts, the JasperReports functions (IF, DATEFORMAT, YEARS, …),
 * common Java String/Number/Date methods, new java.util.Date(), SimpleDateFormat and DecimalFormat.
 * What it cannot read is reported as a note and the element is left empty.
 * Not drawn: groups, subreports, charts, crosstabs, stretching text (the frame height is kept).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JrxmlFill = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── tokens ─────────────────────────────────────────────────────────────
  function fail(msg) { var e = new Error(msg); e.jd = true; return e; }

  function tokenize(src) {
    var out = [], i = 0, n = src.length, m;
    while (i < n) {
      var c = src[i], rest;
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { var e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '$' && /[FPVR]/.test(src[i + 1]) && src[i + 2] === '{') {
        var close = src.indexOf('}', i + 3);
        if (close < 0) throw fail('A $' + src[i + 1] + '{ is not closed.');
        out.push({ t: 'ref', k: src[i + 1], v: src.slice(i + 3, close) });
        i = close + 1; continue;
      }
      if (c === '"' || c === "'") {
        var s = '', j = i + 1;
        while (j < n && src[j] !== c) {
          if (src[j] === '\\') {
            var x = src[j + 1];
            if (x === 'u') { s += String.fromCharCode(parseInt(src.substr(j + 2, 4), 16)); j += 6; continue; }
            s += x === 'n' ? '\n' : x === 't' ? '\t' : x === 'r' ? '\r' : x === 'b' ? '\b' : x === 'f' ? '\f' : x;
            j += 2; continue;
          }
          s += src[j++];
        }
        if (j >= n) throw fail('A text in quotes is not closed.');
        out.push({ t: 'str', v: s });
        i = j + 1; continue;
      }
      rest = src.slice(i);
      if ((m = /^(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)[LlDdFf]?/.exec(rest))) {
        out.push({ t: 'num', v: Number(m[0].replace(/[LlDdFf]$/, '')) });
        i += m[0].length; continue;
      }
      if ((m = /^[A-Za-z_][\w]*/.exec(rest))) { out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      var two = src.substr(i, 2);
      if (['==', '!=', '<=', '>=', '&&', '||'].indexOf(two) >= 0) { out.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/%<>!?:(),.[]'.indexOf(c) >= 0) { out.push({ t: 'op', v: c }); i++; continue; }
      throw fail('"' + c + '" cannot be read here.');
    }
    return out;
  }

  // ─── parser → tree ──────────────────────────────────────────────────────
  var BIN = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  var PRIMITIVE = /^(int|long|short|byte|double|float|boolean|char)$/;

  function parse(src) {
    var toks = tokenize(src), pos = 0;
    var peek = function (o) { return toks[pos + (o || 0)]; };
    var isOp = function (v, o) { var t = peek(o); return t && t.t === 'op' && t.v === v; };
    var eat = function (v) { if (!isOp(v)) throw fail('"' + v + '" expected' + (peek() ? ' before "' + (peek().v) + '"' : ' at the end') + '.'); pos++; };
    var startsPrimary = function (t) { return t && (t.t !== 'op' || t.v === '(' || t.v === '!'); };

    function expr() {
      var c = binary(0);
      if (isOp('?')) { pos++; var a = expr(); eat(':'); var b = expr(); return { k: 'cond', c: c, a: a, b: b }; }
      return c;
    }
    function binary(level) {
      if (level >= BIN.length) return unary();
      var left = binary(level + 1);
      while (peek() && peek().t === 'op' && BIN[level].indexOf(peek().v) >= 0) {
        var op = toks[pos++].v;
        left = { k: 'bin', op: op, a: left, b: binary(level + 1) };
      }
      return left;
    }
    function unary() {
      if (isOp('!')) { pos++; return { k: 'un', op: '!', a: unary() }; }
      if (isOp('-')) { pos++; return { k: 'un', op: '-', a: unary() }; }
      if (isOp('+')) { pos++; return unary(); }
      return postfix(primary());
    }
    function args() {
      eat('(');
      var list = [];
      if (!isOp(')')) { do { list.push(expr()); } while (isOp(',') && ++pos); }
      eat(')');
      return list;
    }
    function path() {
      var names = [toks[pos++].v];
      while (isOp('.') && peek(1) && peek(1).t === 'id') { names.push(peek(1).v); pos += 2; }
      return names;
    }
    function primary() {
      var t = peek();
      if (!t) throw fail('The expression ends too early.');
      if (t.t === 'str' || t.t === 'num') { pos++; return { k: 'lit', v: t.v }; }
      if (t.t === 'ref') { pos++; return { k: 'ref', r: t.k, n: t.v }; }
      if (isOp('(')) {
        // (Type) value: a Java cast; the value is used as it is.
        var j = pos + 1;
        if (toks[j] && toks[j].t === 'id') {
          j++;
          while (toks[j] && toks[j].t === 'op' && toks[j].v === '.' && toks[j + 1] && toks[j + 1].t === 'id') j += 2;
          var name = toks[pos + 1].v;
          if (toks[j] && toks[j].t === 'op' && toks[j].v === ')' && startsPrimary(toks[j + 1]) && (/^[A-Z]/.test(name) || PRIMITIVE.test(name) || name === 'java')) {
            pos = j + 1;
            return { k: 'cast', to: name, a: unary() };
          }
        }
        pos++;
        var inner = expr();
        eat(')');
        return inner;
      }
      if (t.t === 'id') {
        if (t.v === 'true' || t.v === 'false') { pos++; return { k: 'lit', v: t.v === 'true' }; }
        if (t.v === 'null') { pos++; return { k: 'lit', v: null }; }
        if (t.v === 'new') { pos++; var cls = path().join('.'); return { k: 'new', cls: cls, args: args() }; }
        var names = path();
        if (isOp('(')) return { k: 'call', name: names.join('.'), args: args() };
        return { k: 'static', name: names.join('.') };
      }
      throw fail('"' + t.v + '" is not expected here.');
    }
    function postfix(node) {
      for (;;) {
        if (isOp('.') && peek(1) && peek(1).t === 'id') {
          var name = peek(1).v; pos += 2;
          node = isOp('(') ? { k: 'meth', o: node, name: name, args: args() } : { k: 'prop', o: node, name: name };
        } else if (isOp('[')) {
          pos++; var ix = expr(); eat(']');
          node = { k: 'index', o: node, i: ix };
        } else return node;
      }
    }
    var tree = expr();
    if (pos < toks.length) throw fail('"' + toks[pos].v + '" is not expected here.');
    return tree;
  }

  var cache = {};
  function compile(src) {
    if (!Object.prototype.hasOwnProperty.call(cache, src)) {
      try { cache[src] = { tree: parse(src) }; } catch (e) { cache[src] = { error: e }; }
    }
    if (cache[src].error) throw cache[src].error;
    return cache[src].tree;
  }

  // ─── values ─────────────────────────────────────────────────────────────
  var EN = {
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    dy: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ampm: ['AM', 'PM'], era: 'AD', yearOffset: 0
  };
  // Java's th_TH locale uses the Buddhist calendar (year + 543).
  var TH = {
    months: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
    mon: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
    days: ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'],
    dy: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'], ampm: ['ก่อนเที่ยง', 'หลังเที่ยง'], era: 'พ.ศ.', yearOffset: 543
  };
  var names = function (locale) { return /^th/i.test(locale || '') ? TH : EN; };
  var pad = function (v, n) { v = String(v); while (v.length < n) v = '0' + v; return v; };

  function tzName(d) {
    var off = -d.getTimezoneOffset();
    if (off === 420) return 'ICT';
    return 'GMT' + (off >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(off) / 60), 2) + ':' + pad(Math.abs(off) % 60, 2);
  }

  // java.text.SimpleDateFormat
  function formatDate(d, pattern, locale) {
    if (!(d instanceof Date) || isNaN(d)) return '';
    var L = names(locale), out = '', i = 0, p = String(pattern);
    while (i < p.length) {
      var c = p[i];
      if (c === "'") {
        if (p[i + 1] === "'") { out += "'"; i += 2; continue; }
        var e = p.indexOf("'", i + 1);
        out += p.slice(i + 1, e < 0 ? p.length : e);
        i = e < 0 ? p.length : e + 1; continue;
      }
      if (!/[A-Za-z]/.test(c)) { out += c; i++; continue; }
      var n = 1;
      while (p[i + n] === c) n++;
      i += n;
      var y = d.getFullYear() + L.yearOffset, h = d.getHours(), off = -d.getTimezoneOffset();
      switch (c) {
        case 'G': out += L.era; break;
        case 'y': case 'Y': out += n === 2 ? pad(y % 100, 2) : pad(y, n); break;
        case 'M': case 'L': out += n >= 4 ? L.months[d.getMonth()] : n === 3 ? L.mon[d.getMonth()] : pad(d.getMonth() + 1, n); break;
        case 'd': out += pad(d.getDate(), n); break;
        case 'E': out += n >= 4 ? L.days[d.getDay()] : L.dy[d.getDay()]; break;
        case 'u': out += pad(d.getDay() || 7, n); break;
        case 'a': out += L.ampm[h < 12 ? 0 : 1]; break;
        case 'H': out += pad(h, n); break;
        case 'k': out += pad(h || 24, n); break;
        case 'K': out += pad(h % 12, n); break;
        case 'h': out += pad(h % 12 || 12, n); break;
        case 'm': out += pad(d.getMinutes(), n); break;
        case 's': out += pad(d.getSeconds(), n); break;
        case 'S': out += pad(d.getMilliseconds(), Math.max(n, 3)).slice(0, Math.max(n, 3)); break;
        case 'D': out += pad(Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 864e5) + 1, n); break;
        case 'z': out += tzName(d); break;
        case 'Z': out += (off >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(off) / 60), 2) + pad(Math.abs(off) % 60, 2); break;
        case 'X': out += (off >= 0 ? '+' : '-') + pad(Math.floor(Math.abs(off) / 60), 2) + (n > 1 ? (n > 2 ? ':' : '') + pad(Math.abs(off) % 60, 2) : ''); break;
        default: throw fail('The date pattern letter "' + c + '" is not supported.');
      }
    }
    return out;
  }

  // java.text.DecimalFormat (the positive part of the pattern)
  function formatNumber(v, pattern) {
    var num = Number(v);
    if (!isFinite(num)) return String(v);
    var p = String(pattern).split(';')[0];
    var m = /^([^#0,.]*)([#0,]*)(?:\.([#0]*))?(.*)$/.exec(p);
    if (!m || !m[2]) return String(num);
    var prefix = m[1].replace(/'/g, ''), suffix = m[4].replace(/'/g, ''), intPart = m[2], frac = m[3] || '';
    if (suffix.indexOf('%') >= 0 || prefix.indexOf('%') >= 0) num *= 100;
    var minInt = (intPart.replace(/,/g, '').match(/0/g) || []).length;
    var lastComma = intPart.lastIndexOf(','), group = lastComma >= 0 ? intPart.length - lastComma - 1 : 0;
    var minFrac = (frac.match(/0/g) || []).length, maxFrac = frac.length;
    var neg = num < 0, s = Math.abs(num).toFixed(maxFrac);
    var parts = s.split('.'), ip = parts[0], fp = parts[1] || '';
    while (fp.length > minFrac && fp[fp.length - 1] === '0') fp = fp.slice(0, -1);
    while (ip.length < minInt) ip = '0' + ip;
    if (!minInt && ip === '0' && fp) ip = '';
    if (group > 0) ip = ip.replace(new RegExp('\\B(?=(\\d{' + group + '})+(?!\\d))', 'g'), ',');
    return (neg ? '-' : '') + prefix + ip + (fp ? '.' + fp : '') + suffix;
  }

  function isDate(v) { return v instanceof Date; }
  function javaString(v, locale) {
    if (v === null || v === undefined) return 'null';
    if (isDate(v)) return formatDate(v, 'EEE MMM dd HH:mm:ss zzz yyyy', 'en');
    if (Array.isArray(v)) return '[' + v.map(function (x) { return javaString(x, locale); }).join(', ') + ']';
    if (v && v.$fmt) return v.$fmt;
    return String(v);
  }
  function toNumber(v, what) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
    if (isDate(v)) return v.getTime();
    if (typeof v === 'boolean') throw fail((what || 'A value') + ' is true/false, not a number.');
    throw fail((what || 'A value') + ' is ' + (v === null || v === undefined ? 'null' : '"' + v + '"') + ', not a number.');
  }
  function same(a, b) {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
    if (isDate(a) && isDate(b)) return a.getTime() === b.getTime();
    if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
    return String(a) === String(b);
  }
  function compare(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) throw fail('Cannot compare with null.');
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    var x = toNumber(a), y = toNumber(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (v === null || v === undefined) throw fail('A condition is null.');
    if (v === 'true' || v === 'false') return v === 'true';
    throw fail('A condition is "' + javaString(v) + '", not true/false.');
  }
  function toDate(v) {
    if (v === null || v === undefined) return null;
    if (isDate(v)) return v;
    if (typeof v === 'number') return new Date(v);
    var d = new Date(v);
    if (isNaN(d)) throw fail('"' + v + '" is not a date.');
    return d;
  }
  var startOfDay = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  function monthsBetween(a, b) {
    var m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    if (b.getDate() < a.getDate()) m--;
    return m;
  }
  var str = function (v) { return v === null || v === undefined ? null : typeof v === 'string' ? v : javaString(v); };

  // JasperReports built-in functions (the ones a MongoDB report uses most).
  var FUNCS = {
    IF: null, // lazy, handled in evaluate
    AND: function (a) { return a.every(truthy); },
    OR: function (a) { return a.some(truthy); },
    NOT: function (a) { return !truthy(a[0]); },
    EQUALS: function (a) { return same(a[0], a[1]); },
    ISNULL: function (a) { return a[0] === null || a[0] === undefined; },
    TODAY: function () { return startOfDay(new Date()); },
    NOW: function () { return new Date(); },
    DATE: function (a) { return new Date(toNumber(a[0]), toNumber(a[1]) - 1, toNumber(a[2])); },
    DATEFORMAT: function (a, ctx) { var d = toDate(a[0]); return d ? formatDate(d, a[1], ctx.locale) : null; },
    DATEVALUE: function (a) { return toDate(a[0]); },
    DAY: function (a) { var d = toDate(a[0]); return d ? d.getDate() : null; },
    MONTH: function (a) { var d = toDate(a[0]); return d ? d.getMonth() + 1 : null; },
    YEAR: function (a) { var d = toDate(a[0]); return d ? d.getFullYear() : null; },
    DAYS: function (a) { var x = toDate(a[0]), y = toDate(a[1]); return x && y ? Math.round((startOfDay(y) - startOfDay(x)) / 864e5) : null; },
    MONTHS: function (a) { var x = toDate(a[0]), y = toDate(a[1]); return x && y ? monthsBetween(x, y) : null; },
    YEARS: function (a) { var x = toDate(a[0]), y = toDate(a[1]); return x && y ? Math.trunc(monthsBetween(x, y) / 12) : null; },
    WEEKDAY: function (a) { var d = toDate(a[0]); return d ? d.getDay() + 1 : null; },
    EDATE: function (a) { var d = toDate(a[0]); if (!d) return null; var r = new Date(d); r.setMonth(r.getMonth() + toNumber(a[1])); return r; },
    CONCATENATE: function (a) { return a.map(function (x) { return x === null || x === undefined ? '' : javaString(x); }).join(''); },
    LEN: function (a) { return a[0] === null || a[0] === undefined ? 0 : str(a[0]).length; },
    LOWER: function (a) { var s = str(a[0]); return s === null ? null : s.toLowerCase(); },
    UPPER: function (a) { var s = str(a[0]); return s === null ? null : s.toUpperCase(); },
    TRIM: function (a) { var s = str(a[0]); return s === null ? null : s.trim().replace(/\s+/g, ' '); },
    LEFT: function (a) { var s = str(a[0]); return s === null ? null : s.slice(0, toNumber(a[1])); },
    RIGHT: function (a) { var s = str(a[0]); return s === null ? null : s.slice(Math.max(0, s.length - toNumber(a[1]))); },
    MID: function (a) { var s = str(a[0]); return s === null ? null : s.substr(toNumber(a[1]) - 1, toNumber(a[2])); },
    FIND: function (a) { var s = str(a[1]); return s === null ? -1 : s.indexOf(str(a[0]), a.length > 2 ? toNumber(a[2]) - 1 : 0) + 1; },
    REPLACE: function (a) { var s = str(a[0]); if (s === null) return null; var st = toNumber(a[1]) - 1; return s.slice(0, st) + str(a[3]) + s.slice(st + toNumber(a[2])); },
    SUBSTITUTE: function (a) { var s = str(a[0]); return s === null ? null : s.split(str(a[1])).join(str(a[2])); },
    REPT: function (a) { return new Array(Math.max(0, toNumber(a[1])) + 1).join(str(a[0])); },
    TEXT: function (a) { return formatNumber(a[0], a[1]); },
    ABS: function (a) { return Math.abs(toNumber(a[0])); },
    FLOOR: function (a) { return Math.floor(toNumber(a[0])); },
    CEIL: function (a) { return Math.ceil(toNumber(a[0])); },
    SQRT: function (a) { return Math.sqrt(toNumber(a[0])); },
    POWER: function (a) { return Math.pow(toNumber(a[0]), toNumber(a[1])); },
    ISEVEN: function (a) { return toNumber(a[0]) % 2 === 0; },
    ISODD: function (a) { return Math.abs(toNumber(a[0]) % 2) === 1; },
    SUM: function (a) { return a.reduce(function (s, x) { return s + toNumber(x); }, 0); },
    PRODUCT: function (a) { return a.reduce(function (s, x) { return s * toNumber(x); }, 1); }
  };

  var JAVA_PKG = /^(java\.(lang|util|text|math|sql)\.)/;
  var bare = function (name) { return name.replace(JAVA_PKG, ''); };

  function staticCall(name, a, ctx) {
    switch (bare(name)) {
      case 'String.valueOf': return javaString(a[0], ctx.locale);
      case 'String.format': {
        var k = 1;
        return String(a[0]).replace(/%(-?\d*)(?:\.(\d+))?([sdfn%])/g, function (all, w, prec, t) {
          if (t === '%') return '%';
          if (t === 'n') return '\n';
          var v = a[k++];
          var s = t === 'd' ? String(Math.trunc(toNumber(v))) : t === 'f' ? toNumber(v).toFixed(prec ? +prec : 6) : javaString(v);
          var width = Math.abs(parseInt(w, 10) || 0);
          while (s.length < width) s = w[0] === '-' ? s + ' ' : ' ' + s;
          return s;
        });
      }
      case 'Integer.parseInt': case 'Integer.valueOf': case 'Long.parseLong': case 'Long.valueOf': case 'Short.parseShort':
        { var n = parseInt(String(a[0]).trim(), a[1] ? toNumber(a[1]) : 10); if (isNaN(n)) throw fail('"' + a[0] + '" is not a whole number.'); return n; }
      case 'Double.parseDouble': case 'Double.valueOf': case 'Float.parseFloat': case 'Float.valueOf': case 'BigDecimal.valueOf':
        return toNumber(a[0]);
      case 'Boolean.valueOf': case 'Boolean.parseBoolean': return a[0] === true || String(a[0]).toLowerCase() === 'true';
      case 'Math.round': return Math.round(toNumber(a[0]));
      case 'Math.abs': return Math.abs(toNumber(a[0]));
      case 'Math.max': return Math.max(toNumber(a[0]), toNumber(a[1]));
      case 'Math.min': return Math.min(toNumber(a[0]), toNumber(a[1]));
      case 'Math.floor': return Math.floor(toNumber(a[0]));
      case 'Math.ceil': return Math.ceil(toNumber(a[0]));
      case 'Math.pow': return Math.pow(toNumber(a[0]), toNumber(a[1]));
      case 'Objects.isNull': return a[0] === null || a[0] === undefined;
      case 'Objects.nonNull': return !(a[0] === null || a[0] === undefined);
      case 'Objects.toString': return a[0] === null || a[0] === undefined ? (a.length > 1 ? a[1] : 'null') : javaString(a[0]);
      default: throw fail(name + '() is not supported in the local preview.');
    }
  }

  function construct(cls, a, ctx) {
    switch (bare(cls)) {
      case 'Date': case 'Timestamp': return a.length ? toDate(a[0]) : new Date();
      case 'SimpleDateFormat': { var p = String(a[0] || 'dd/MM/yy HH:mm'); var loc = a[1] && a[1].$locale ? a[1].$locale : ctx.locale; return { $format: function (v) { return formatDate(toDate(v), p, loc); } }; }
      case 'DecimalFormat': { var q = String(a[0] || '#,##0.###'); return { $format: function (v) { return formatNumber(v, q); } }; }
      case 'Locale': return { $locale: a.map(String).join('_'), $fmt: a.map(String).join('_') };
      case 'String': return a.length ? javaString(a[0]) : '';
      case 'Integer': case 'Long': case 'Short': return Math.trunc(toNumber(a[0]));
      case 'Double': case 'Float': case 'BigDecimal': case 'BigInteger': return toNumber(a[0]);
      case 'Boolean': return a[0] === true || String(a[0]).toLowerCase() === 'true';
      case 'StringBuilder': case 'StringBuffer': return a.length ? javaString(a[0]) : '';
      default: throw fail('new ' + cls + '() is not supported in the local preview.');
    }
  }

  function staticValue(name, ctx) {
    switch (bare(name)) {
      case 'Boolean.TRUE': return true;
      case 'Boolean.FALSE': return false;
      case 'Locale.US': case 'Locale.ENGLISH': return { $locale: 'en_US', $fmt: 'en_US' };
      case 'Integer.MAX_VALUE': return 2147483647;
      case 'Integer.MIN_VALUE': return -2147483648;
      case 'Math.PI': return Math.PI;
      default: throw fail('"' + name + '" is not known here.');
    }
  }

  function method(o, name, a, ctx) {
    if (o && typeof o.$format === 'function' && name === 'format') return o.$format(a[0]);
    if (o === null || o === undefined) throw fail('.' + name + '() was called on null.');
    switch (name) {
      case 'toString': return javaString(o, ctx.locale);
      case 'equals': return o !== null && same(o, a[0]) && typeof o === typeof a[0];
      case 'hashCode': return 0;
    }
    if (typeof o === 'string') {
      switch (name) {
        case 'equalsIgnoreCase': return a[0] !== null && a[0] !== undefined && o.toLowerCase() === String(a[0]).toLowerCase();
        case 'isEmpty': return o.length === 0;
        case 'isBlank': return o.trim().length === 0;
        case 'length': return o.length;
        case 'trim': case 'strip': return o.trim();
        case 'toUpperCase': return o.toUpperCase();
        case 'toLowerCase': return o.toLowerCase();
        case 'substring': return a.length > 1 ? o.substring(toNumber(a[0]), toNumber(a[1])) : o.substring(toNumber(a[0]));
        case 'charAt': return o.charAt(toNumber(a[0]));
        case 'contains': return o.indexOf(javaString(a[0])) >= 0;
        case 'startsWith': return o.indexOf(javaString(a[0])) === 0;
        case 'endsWith': { var e = javaString(a[0]); return o.slice(o.length - e.length) === e; }
        case 'indexOf': return o.indexOf(javaString(a[0]), a.length > 1 ? toNumber(a[1]) : 0);
        case 'lastIndexOf': return o.lastIndexOf(javaString(a[0]));
        case 'concat': return o + javaString(a[0]);
        case 'replace': return o.split(javaString(a[0])).join(javaString(a[1]));
        case 'replaceAll': return o.replace(new RegExp(String(a[0]), 'g'), String(a[1]));
        case 'replaceFirst': return o.replace(new RegExp(String(a[0])), String(a[1]));
        case 'matches': return new RegExp('^(?:' + a[0] + ')$').test(o);
        case 'split': return o.split(new RegExp(String(a[0])));
        case 'compareTo': return compare(o, a[0]);
        case 'append': return o + javaString(a[0]);
      }
    }
    if (typeof o === 'number') {
      switch (name) {
        case 'intValue': case 'longValue': case 'shortValue': return Math.trunc(o);
        case 'doubleValue': case 'floatValue': return o;
        case 'compareTo': return compare(o, a[0]);
        case 'setScale': return Number(o.toFixed(toNumber(a[0])));
      }
    }
    if (typeof o === 'boolean' && name === 'booleanValue') return o;
    if (isDate(o)) {
      switch (name) {
        case 'getTime': return o.getTime();
        case 'before': return o.getTime() < toDate(a[0]).getTime();
        case 'after': return o.getTime() > toDate(a[0]).getTime();
        case 'compareTo': return compare(o, toDate(a[0]));
        case 'getYear': return o.getFullYear() - 1900;
        case 'getMonth': return o.getMonth();
        case 'getDate': return o.getDate();
        case 'getDay': return o.getDay();
        case 'getHours': return o.getHours();
        case 'getMinutes': return o.getMinutes();
        case 'getSeconds': return o.getSeconds();
      }
    }
    if (Array.isArray(o)) {
      switch (name) {
        case 'size': return o.length;
        case 'isEmpty': return o.length === 0;
        case 'get': return o[toNumber(a[0])];
        case 'contains': return o.some(function (x) { return same(x, a[0]); });
      }
    }
    throw fail('.' + name + '() is not supported in the local preview.');
  }

  function ev(n, ctx) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'ref': {
        if (n.r === 'F') {
          if (!ctx.row || !Object.prototype.hasOwnProperty.call(ctx.row, n.n)) {
            if (ctx.fieldNames && !ctx.fieldNames[n.n]) throw fail('The field "' + n.n + '" is not in the dataset.');
            return null;
          }
          return ctx.row[n.n];
        }
        if (n.r === 'P') {
          if (!Object.prototype.hasOwnProperty.call(ctx.params, n.n)) throw fail('The parameter "' + n.n + '" is not defined.');
          return ctx.params[n.n];
        }
        if (n.r === 'V') {
          if (!Object.prototype.hasOwnProperty.call(ctx.vars, n.n)) throw fail('The variable "' + n.n + '" is not defined.');
          return ctx.vars[n.n];
        }
        return n.n; // $R{key}: the key itself (no resource bundle here)
      }
      case 'cond': return truthy(ev(n.c, ctx)) ? ev(n.a, ctx) : ev(n.b, ctx);
      case 'un': {
        var u = ev(n.a, ctx);
        return n.op === '!' ? !truthy(u) : -toNumber(u);
      }
      case 'bin': {
        if (n.op === '&&') return truthy(ev(n.a, ctx)) && truthy(ev(n.b, ctx));
        if (n.op === '||') return truthy(ev(n.a, ctx)) || truthy(ev(n.b, ctx));
        var a = ev(n.a, ctx), b = ev(n.b, ctx);
        switch (n.op) {
          case '+':
            if (typeof a === 'string' || typeof b === 'string') return javaString(a, ctx.locale) + javaString(b, ctx.locale);
            if (a === null || a === undefined || b === null || b === undefined) throw fail('A null value was added (NullPointerException).');
            return toNumber(a) + toNumber(b);
          case '-': return toNumber(a) - toNumber(b);
          case '*': return toNumber(a) * toNumber(b);
          case '/': { var dv = toNumber(b); if (dv === 0) throw fail('Division by zero.'); return toNumber(a) / dv; }
          case '%': return toNumber(a) % toNumber(b);
          case '==': return same(a, b);
          case '!=': return !same(a, b);
          case '<': return compare(a, b) < 0;
          case '>': return compare(a, b) > 0;
          case '<=': return compare(a, b) <= 0;
          case '>=': return compare(a, b) >= 0;
        }
        throw fail('Operator ' + n.op + ' is not supported.');
      }
      case 'cast': {
        var c = ev(n.a, ctx), to = n.to;
        if (/^(int|long|short|byte)$/.test(to)) return Math.trunc(toNumber(c));
        if (/^(double|float)$/.test(to)) return toNumber(c);
        return c;
      }
      case 'call': {
        var name = n.name;
        if (name === 'IF') {
          if (n.args.length !== 3) throw fail('IF needs 3 values: IF(condition, then, else).');
          return truthy(ev(n.args[0], ctx)) ? ev(n.args[1], ctx) : ev(n.args[2], ctx);
        }
        var args = n.args.map(function (x) { return ev(x, ctx); });
        if (Object.prototype.hasOwnProperty.call(FUNCS, name) && FUNCS[name]) return FUNCS[name](args, ctx);
        if (name.indexOf('.') < 0) throw fail(name + '() is not a JasperReports function the local preview knows.');
        return staticCall(name, args, ctx);
      }
      case 'static': return staticValue(n.name, ctx);
      case 'new': return construct(n.cls, n.args.map(function (x) { return ev(x, ctx); }), ctx);
      case 'meth': return method(ev(n.o, ctx), n.name, n.args.map(function (x) { return ev(x, ctx); }), ctx);
      case 'prop': {
        var o = ev(n.o, ctx);
        if (Array.isArray(o) && n.name === 'length') return o.length;
        throw fail('.' + n.name + ' is not supported in the local preview.');
      }
      case 'index': { var arr = ev(n.o, ctx); if (!Array.isArray(arr)) throw fail('[ ] is used on a value that is not a list.'); return arr[toNumber(ev(n.i, ctx))]; }
    }
    throw fail('This expression cannot be read.');
  }

  function evaluate(src, ctx) {
    var s = String(src === null || src === undefined ? '' : src).trim();
    if (!s) return null;
    return ev(compile(s), ctx);
  }

  // ─── fill ───────────────────────────────────────────────────────────────
  var MAX_PAGES = 500;

  function paramValue(cls, text) {
    var t = String(text);
    if (/(Integer|Long|Short|Byte)$/.test(cls)) { var n = parseInt(t, 10); if (isNaN(n)) throw fail('"' + t + '" is not a whole number.'); return n; }
    if (/(Double|Float|BigDecimal|Number)$/.test(cls)) return toNumber(t, '"' + t + '"');
    if (/Boolean$/.test(cls)) return t === 'true' || t === true;
    if (/(Date|Timestamp)$/.test(cls)) return toDate(t);
    return t;
  }

  // Report variables kept as XML from an imported JRXML: a sketch of their calculations.
  function readVariables(raw) {
    var list = [];
    (raw || []).forEach(function (x) {
      var head = /<variable\b([^>]*?)\/?>/.exec(x);
      if (!head) return;
      var at = function (n) { var m = new RegExp('\\b' + n + '="([^"]*)"').exec(head[1]); return m ? m[1] : ''; };
      var body = function (tag) { var m = new RegExp('<' + tag + '>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</' + tag + '>').exec(x); return m ? (m[1] !== undefined ? m[1] : (m[2] || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : ''; };
      list.push({ name: at('name'), calc: at('calculation') || 'Nothing', reset: at('resetType') || 'Report', expr: body('variableExpression'), init: body('initialValueExpression') });
    });
    return list.filter(function (v) { return v.name; });
  }

  function fill(design, rows, opts) {
    opts = opts || {};
    var d = design, m = d.page.margins, W = d.page.width, H = d.page.height, attrs = d.attrs || {};
    var notes = [], noteSeen = {};
    var note = function (msg) { if (!noteSeen[msg]) { noteSeen[msg] = 1; notes.push(msg); } };
    var fieldNames = {};
    (d.fields || []).forEach(function (f) { fieldNames[f.name] = 1; });
    var ctx = {
      row: {}, locale: opts.locale || 'en_US', fieldNames: fieldNames,
      vars: { PAGE_NUMBER: 1, COLUMN_NUMBER: 1, REPORT_COUNT: 0, PAGE_COUNT: 0, COLUMN_COUNT: 0 },
      params: { REPORT_LOCALE: { $locale: opts.locale || 'en_US', $fmt: opts.locale || 'en_US' }, REPORT_TIME_ZONE: null, REPORT_CONNECTION: null, REPORT_DATA_SOURCE: null,
        REPORT_PARAMETERS_MAP: null, REPORT_MAX_COUNT: null, REPORT_SCRIPTLET: null, REPORT_RESOURCE_BUNDLE: null, REPORT_VIRTUALIZER: null, IS_IGNORE_PAGINATION: attrs.isIgnorePagination === 'true',
        REPORT_CONTEXT: null, REPORT_FORMAT_FACTORY: null, REPORT_CLASS_LOADER: null, REPORT_URL_HANDLER_FACTORY: null, REPORT_FILE_RESOLVER: null, REPORT_TEMPLATES: null,
        SORT_FIELDS: null, FILTER: null, MONGO_QUERY_EXECUTER_COLLECTION: null, JASPER_REPORTS_CONTEXT: null }
    };
    // Parameters: the value typed in the preview, else the default expression.
    (d.params || []).forEach(function (p) {
      var typedIn = opts.params && Object.prototype.hasOwnProperty.call(opts.params, p.name) ? opts.params[p.name] : '';
      try {
        if (typedIn !== '' && typedIn !== null && typedIn !== undefined) ctx.params[p.name] = paramValue(p.cls, typedIn);
        else ctx.params[p.name] = p.def ? evaluate(p.def, ctx) : null;
      } catch (e) {
        ctx.params[p.name] = null;
        note('Parameter ' + p.name + ': ' + e.message);
      }
    });
    if ((d.raw && d.raw.groups || []).length) note('Groups are not drawn in the local preview; run on JasperServer to see them.');
    var vars = readVariables(d.raw && d.raw.variables);
    vars.forEach(function (v) { ctx.vars[v.name] = null; });
    var resetVars = function (kind) {
      vars.forEach(function (v) {
        if (v.reset !== kind && !(kind === 'Report')) return;
        v.count = 0; v.sum = 0; v.seen = {}; v.distinct = 0; v.first = true;
        try { ctx.vars[v.name] = v.init ? evaluate(v.init, ctx) : (v.calc === 'Count' || v.calc === 'DistinctCount' ? 0 : null); }
        catch (e) { ctx.vars[v.name] = null; note('Variable ' + v.name + ': ' + e.message); }
      });
    };
    var stepVars = function () {
      vars.forEach(function (v) {
        var x;
        try { x = evaluate(v.expr, ctx); } catch (e) { note('Variable ' + v.name + ': ' + e.message); return; }
        var has = x !== null && x !== undefined;
        switch (v.calc) {
          case 'Count': if (has) v.count++; ctx.vars[v.name] = v.count; break;
          case 'DistinctCount': if (has && !v.seen[javaString(x)]) { v.seen[javaString(x)] = 1; v.distinct++; } ctx.vars[v.name] = v.distinct; break;
          case 'Sum': if (has) { v.sum += toNumber(x); v.count++; } ctx.vars[v.name] = v.count ? v.sum : ctx.vars[v.name]; break;
          case 'Average': if (has) { v.sum += toNumber(x); v.count++; } ctx.vars[v.name] = v.count ? v.sum / v.count : null; break;
          case 'Lowest': if (has && (ctx.vars[v.name] === null || compare(x, ctx.vars[v.name]) < 0)) ctx.vars[v.name] = x; break;
          case 'Highest': if (has && (ctx.vars[v.name] === null || compare(x, ctx.vars[v.name]) > 0)) ctx.vars[v.name] = x; break;
          case 'First': if (v.first) { ctx.vars[v.name] = x; v.first = false; } break;
          default: ctx.vars[v.name] = x;
        }
      });
    };

    var band = function (k) { var b = d.bands[k]; return b && !b.hidden && b.height > 0 ? b : null; };
    var bandLabel = function (k) { return { title: 'Title', pageHeader: 'Page Header', columnHeader: 'Column Header', detail: 'Detail', columnFooter: 'Column Footer', pageFooter: 'Page Footer', lastPageFooter: 'Last Page Footer', summary: 'Summary' }[k] || k.replace(/^detail(\d+)$/, 'Detail $1'); };
    // Detail 1, Detail 2, …: printed one after another for each record.
    var detailKeys = ['detail'].concat(Object.keys(d.bands).filter(function (k) { return /^detail\d+$/.test(k); })
      .sort(function (a, b) { return Number(a.slice(6)) - Number(b.slice(6)); }));
    var ignorePagination = attrs.isIgnorePagination === 'true';
    var pages = [], page = null, reportLater = [];

    var textOf = function (el, label) {
      if (el.type === 'staticText') return el.text;
      try {
        var v = evaluate(el.expression, ctx);
        if (v === null || v === undefined) return el.blankWhenNull ? '' : 'null';
        if (el.pattern && isDate(v)) return formatDate(v, el.pattern, ctx.locale);
        if (el.pattern && typeof v === 'number') return formatNumber(v, el.pattern);
        return javaString(v, ctx.locale);
      } catch (e) {
        note(label + ' · ' + String(el.expression).replace(/\s+/g, ' ').slice(0, 60) + ' → ' + e.message);
        return '';
      }
    };
    var imageOf = function (el, label) {
      var images = opts.images || {};
      if (el.source === 'resource') return images[el.resource] || null;
      try {
        var v = evaluate(el.expression, ctx);
        if (typeof v !== 'string') return null;
        var name = v.replace(/^repo:/, '').split('/').pop();
        if (images[name]) return images[name];
        if (/^(data:image\/|https?:\/\/)/.test(v)) return v;
        note(label + ' · image ' + v + ' is shown as a placeholder.');
      } catch (e) { note(label + ' · image → ' + e.message); }
      return null;
    };

    // Draws a band at y; returns where it ends (on the page it ends on), or false when its print-when
    // expression says no. With canBreak, a page break element moves what is below it to a new page
    // (not when nothing has been placed on the page yet, like JasperReports).
    var place = function (k, y, canBreak) {
      var b = band(k);
      if (!b) return false;
      if (b.printWhen) {
        try { if (!truthy(evaluate(b.printWhen, ctx))) return false; }
        catch (e) { note(bandLabel(k) + ' print-when → ' + e.message); }
      }
      var label = bandLabel(k);
      var cuts = b.elements.filter(function (el) { return el.type === 'break' && el.breakType !== 'Column'; }).map(function (el) { return el.y; })
        .sort(function (p, q) { return p - q; });
      if (!canBreak && cuts.length) { note(label + ': page breaks only work in the title, detail and summary bands.'); cuts = []; }
      if (b.elements.some(function (el) { return el.type === 'break' && el.breakType === 'Column'; })) note('Column breaks are not applied in the local preview.');
      var bounds = [0].concat(cuts, [Infinity]), offset = y, grow = 0;
      for (var s = 0; s < bounds.length - 1; s++) {
        if (s > 0 && offset + bounds[s] > page.top + 0.5) {
          if (pages.length >= MAX_PAGES) { note('The preview stops at ' + MAX_PAGES + ' pages.'); break; }
          endPage(false); newPage(); headers();
          offset = page.y - bounds[s];
        }
        var part = buildPart(b, k, label, offset, bounds[s], bounds[s + 1]);
        if (bounds.length === 2) grow = stretchBand(b, part, offset);       // a band with page breaks keeps its height
        part.forEach(function (it) {
          if (it.later) (it.el.evaluationTime === 'Report' ? reportLater : page.later).push(it);
          delete it.later;
          page.items.push(it);
        });
      }
      return offset + b.height + grow;
    };
    // How much a band grows for the text fields that stretch (Text adjust StretchHeight), without
    // drawing it: the detail loop needs it to decide whether the band still fits on the page.
    var stretchOf = function (k) {
      var b = band(k);
      if (!b) return 0;
      if (!layoutText && !b.elements.some(function (el) { return el.type === 'table'; })) return 0;      // nothing can grow
      if (b.elements.some(function (el) { return el.type === 'break' && el.breakType !== 'Column'; })) return 0;
      return stretchBand(b, buildPart(b, k, bandLabel(k), 0, 0, Infinity), 0);
    };
    // Stretched text fields make their band taller (like JasperReports): elements set to Float below
    // one move down by its growth; FixRelativeToBottom ones move with the band's bottom; ones that
    // stretch with the band (RelativeToBandHeight, ContainerHeight) get taller. Returns the growth.
    // Where an item sits in its band (a table header: in Column Header, not where the table is).
    var posY = function (it) { return it.gy != null ? it.gy : it.el.y; }, posH = function (it) { return it.gh != null ? it.gh : it.el.height; };
    var stretchBand = function (b, items, y) {
      var grown = items.filter(function (it) { return it.grow > 0; });
      if (!grown.length) return 0;
      items.forEach(function (it) {
        if (it.grow || it.el.positionType !== 'Float') return;
        var shift = 0;
        grown.forEach(function (g) { if (posY(it) >= posY(g) + posH(g)) shift = Math.max(shift, g.grow); });
        it.y += shift;
      });
      var origBottom = 0, newBottom = 0;
      items.forEach(function (it) {
        origBottom = Math.max(origBottom, posY(it) + posH(it));
        newBottom = Math.max(newBottom, it.y - y + it.h);
      });
      // The band keeps the space it had below its lowest element.
      var grow = Math.max(0, newBottom - origBottom);
      items.forEach(function (it) {
        if (it.grow) return;
        if (it.el.positionType === 'FixRelativeToBottom') it.y += grow;
        if (it.el.stretchType === 'RelativeToBandHeight' || it.el.stretchType === 'ContainerHeight') it.h += grow;
      });
      return grow;
    };

    // Text adjust, with the text measured by the page (opts.layoutText, the browser's fonts):
    // CutText keeps the box and only the lines that fit whole; ScaleFont makes the font smaller until
    // the text fits; StretchHeight makes the box taller (item.grow, see stretchBand). Without
    // opts.layoutText (on the server) the text is left as it is.
    var layoutText = typeof opts.layoutText === 'function' ? opts.layoutText : null;
    var fitText = function (item) {
      var el = item.el;
      if (!layoutText || item.text == null || item.text === '' || (el.type !== 'textField' && el.type !== 'staticText')) return;
      var pad = (el.box && el.box.pad) || { top: 0, right: 0, bottom: 0, left: 0 };
      var availW = Math.max(1, item.w - pad.left - pad.right), availH = Math.max(0, item.h - pad.top - pad.bottom);
      var adjust = el.type === 'textField' ? el.textAdjust || 'CutText' : 'CutText';
      var size = el.fontSize || d.font.size;
      var r = layoutText(el, item.text, availW, size, d.font.name);
      if (adjust === 'StretchHeight') {
        var need = r.lines.length * r.lineHeight + pad.top + pad.bottom;
        if (need > item.h + 0.5) { item.grow = need - item.h; item.h = need; }
        return;
      }
      if (adjust === 'ScaleFont') {
        while (r.lines.length * r.lineHeight > availH + 0.5 && size > 1) {
          size = Math.max(1, size - (size > 8 ? 0.5 : 0.25));
          r = layoutText(el, item.text, availW, size, d.font.name);
        }
        if (size !== (el.fontSize || d.font.size)) item.fontSize = size;
      }
      // CutText (and ScaleFont at its smallest): only the lines that fit whole are printed.
      var fit = Math.floor((availH + 0.5) / r.lineHeight);
      if (r.lines.length > fit) item.text = r.lines.slice(0, Math.max(0, fit)).join('\n');
    };

    // ─── Table ───────────────────────────────────────────────────────────
    // A table prints its row(s) in its band, like JasperReports does with the cells the designer writes:
    // in a Detail band one row for the record being printed; fixed rows: that many blank rows. Its header
    // prints in the Column Header band (tableHeaders). Each cell gets the table's Text adjust;
    // item.table = { rows: [[{ text, size }]], heights: [row heights], header: bool }.
    var tableCell = function (el, text, width, height, adjust, bold) {
      var cell = { text: text == null ? '' : String(text), size: 0 };
      if (!layoutText || !cell.text) return { cell: cell, need: height };
      var pad = el.padding || 0, availW = Math.max(1, width - 2 * pad), availH = Math.max(0, height - 2 * pad);
      var probe = { fontName: el.fontName, bold: !!bold, italic: false };
      var size = el.fontSize || d.font.size, r = layoutText(probe, cell.text, availW, size, d.font.name);
      if (adjust === 'StretchHeight') return { cell: cell, need: Math.max(height, r.lines.length * r.lineHeight + 2 * pad) };
      if (adjust === 'ScaleFont') {
        while (r.lines.length * r.lineHeight > availH + 0.5 && size > 1) {
          size = Math.max(1, size - (size > 8 ? 0.5 : 0.25));
          r = layoutText(probe, cell.text, availW, size, d.font.name);
        }
        if (size !== (el.fontSize || d.font.size)) cell.size = size;
      }
      var fit = Math.floor((availH + 0.5) / r.lineHeight);
      if (r.lines.length > fit) cell.text = r.lines.slice(0, Math.max(0, fit)).join('\n');
      return { cell: cell, need: height };
    };
    // One row of cells: [{ text, size }] and its height (the tallest stretched cell).
    var tableRow = function (el, texts, height, adjust, bold) {
      var h = height;
      var cells = el.columns.map(function (c, i) {
        var f = tableCell(el, texts[i], c.width, height, adjust, bold);
        h = Math.max(h, f.need);
        return f.cell;
      });
      return { cells: cells, height: h };
    };
    var tableRowsOf = function (item, label) {
      var el = item.el, fixed = el.rowSource === 'fixed';
      var keepCount = ctx.vars.REPORT_COUNT, rows = [], heights = [];
      var n = fixed ? el.rowCount : 1;
      for (var i = 0; i < n; i++) {
        if (fixed) ctx.vars.REPORT_COUNT = i + 1;
        var texts = el.columns.map(function (c) {
          if (!String(c.expression || '').trim()) return '';
          return textOf({ type: 'textField', expression: c.expression, pattern: c.pattern, blankWhenNull: true }, label);
        });
        var r = tableRow(el, texts, el.rowHeight, el.textAdjust, false);
        rows.push(r.cells); heights.push(r.height);
      }
      ctx.vars.REPORT_COUNT = keepCount;
      item.table = { rows: rows, heights: heights, header: false };
      var need = heights.reduce(function (s, h) { return s + h; }, 0);
      if (need > item.h + 0.5) { item.grow = need - item.h; item.h = need; }
    };
    // The header of every table, as items of the Column Header band at y.
    var tableHeaders = function (y) {
      var out = [];
      Object.keys(d.bands).forEach(function (k) {
        var b = d.bands[k];
        if (!b || b.hidden) return;
        b.elements.forEach(function (el) {
          if (el.type !== 'table' || !el.headerShow) return;
          var r = tableRow(el, el.columns.map(function (c) { return c.header; }), el.headerHeight, el.headerAdjust, el.headerBold);
          out.push({ el: el, band: 'columnHeader', x: m.left + el.x, y: y + el.headerY, w: el.width, h: r.height, text: null, src: null,
            table: { rows: [r.cells], heights: [r.height], header: true }, grow: r.height > el.headerHeight + 0.5 ? r.height - el.headerHeight : 0, gy: el.headerY, gh: el.headerHeight });
        });
      });
      return out;
    };

    // The items of a band (between its page breaks from..to) at y, not placed on the page yet.
    var buildPart = function (b, k, label, y, from, to) {
      var out = k === 'columnHeader' && from === 0 ? tableHeaders(y) : [];
      b.elements.forEach(function (el) {
        if (el.type === 'break' || el.y < from || el.y >= to) return;
        if (el.printWhen) {
          try { if (!truthy(evaluate(el.printWhen, ctx))) return; }
          catch (e) { note(label + ' · print-when → ' + e.message); }
        }
        var item = { el: el, band: k, x: m.left + el.x, y: y + el.y, w: el.width, h: el.height, text: null, src: null };
        if (el.type === 'textField' && (el.evaluationTime === 'Report' || el.evaluationTime === 'Page')) {
          item.later = true;              // filled in at the end of the page / report (see endPage, fill)
        } else if (el.type === 'textField' || el.type === 'staticText' || el.type === 'barcode') {
          item.text = el.type === 'barcode' ? textOf({ type: 'textField', expression: el.expression, blankWhenNull: true }, label) : textOf(el, label);
          if (el.type !== 'barcode') fitText(item);
        } else if (el.type === 'image') {
          item.src = imageOf(el, label);
        } else if (el.type === 'check') {
          item.checked = el.state === 'checked';
          if (el.state === 'expression') {
            try { item.checked = truthy(evaluate(el.checkedWhen, ctx)); }
            catch (e) { note(label + ' · checked when → ' + e.message); }
          }
        }
        if (el.type === 'table') tableRowsOf(item, label);
        if (el.type === 'subreport') note('Subreports are shown as a box in the local preview; run on JasperServer to see them.');
        if (el.type === 'textField' && el.textAdjust === 'StretchHeight' && item.later) note('Text adjust StretchHeight is not applied to text fields evaluated at the end of the page or report.');
        out.push(item);
      });
      return out;
    };
    var h = function (k) { var b = band(k); return b ? b.height : 0; };
    var bottom = function () { return ignorePagination ? Infinity : H - m.bottom; };
    var detailLimit = function () { return bottom() - h('pageFooter') - h('columnFooter'); };

    var newPage = function (bare) {
      page = { num: pages.length + 1, width: W, height: H, items: [], later: [], y: m.top, top: m.top, bare: !!bare };
      pages.push(page);
      ctx.vars.PAGE_NUMBER = page.num;
      ctx.vars.PAGE_COUNT = 0;
      resetVars('Page');
    };
    var headers = function () {
      if (place('pageHeader', page.y)) page.y += h('pageHeader');
      if (place('columnHeader', page.y)) page.y += h('columnHeader');
      page.top = page.y;
      page.headed = true;
    };
    var endPage = function (last) {
      if (!page.bare) {
        var foot = last && band('lastPageFooter') ? 'lastPageFooter' : 'pageFooter';
        var end = ignorePagination ? page.y + h('columnFooter') + h(foot) : bottom();
        if (ignorePagination) page.height = end + m.bottom;
        if (place('columnFooter', end - h(foot) - h('columnFooter')) && ignorePagination) page.y += h('columnFooter');
        place(foot, end - h(foot));
      }
      page.later.forEach(function (it) { it.text = textOf(it.el, bandLabel(it.band)); fitText(it); });
      delete page.later;
    };

    var list = rows || [];
    // Tables with rows from the query that print "No Data" without records. As in the JRXML (JD.noDataAttrs),
    // they make the report print all sections but the details then, and the row comes right under the headers.
    var noDataTables = [];
    Object.keys(d.bands).forEach(function (k) {
      var b = d.bands[k];
      if (!b || b.hidden || k.indexOf('detail') !== 0) return;
      b.elements.forEach(function (el) { if (el.type === 'table' && el.noDataShow && el.rowSource === 'query') noDataTables.push(el); });
    });
    if (!list.length) {
      var wnd = attrs.whenNoDataType || 'NoPages';
      if (noDataTables.length && wnd === 'NoPages') wnd = 'AllSectionsNoDetail';
      if (wnd === 'NoPages') return { pages: [], notes: notes, empty: 'The data source has no rows, and "When no data" is "No pages", so the report is empty. Change it in the report properties, or use "One empty record".' };
      if (wnd === 'BlankPage') return { pages: [{ num: 1, width: W, height: H, items: [] }], notes: notes };
      if (wnd === 'NoDataSection') {
        note('The No Data section is kept as JRXML and is not drawn in the local preview.');
        return { pages: [{ num: 1, width: W, height: H, items: [] }], notes: notes };
      }
    }

    resetVars('Report');
    ctx.row = list[0] || {};
    // Title (on its own page when "Title on its own page" is set), then the page headers.
    if (attrs.isTitleNewPage === 'true' && band('title')) {
      newPage(true); place('title', page.y, true); endPage(false); newPage(); headers();
    } else {
      newPage();
      var te = place('title', page.y, true);
      if (te !== false) page.y = te;
      if (!page.headed) headers();                    // a page break in the title already started a page with them
    }

    // No records: each "No Data" table gets one row across its width with its text.
    if (!list.length) noDataTables.forEach(function (el) {
      var one = Object.assign({}, el, { columns: [{ id: el.id + '-nd', width: el.width, hAlign: 'Center', header: '', expression: '', pattern: '' }] });
      var r = tableRow(one, [el.noDataText], el.rowHeight, el.textAdjust, false);
      page.items.push({ el: one, band: 'columnFooter', x: m.left + el.x, y: page.y, w: el.width, h: r.height, text: null, src: null,
        table: { rows: [r.cells], heights: [r.height], header: false } });
      page.y += r.height;
    });

    var titled = pages.length === 1 && !!band('title'), stop = false;
    for (var i = 0; i < list.length && !stop; i++) {
      ctx.row = list[i];
      ctx.vars.REPORT_COUNT = i + 1;
      ctx.vars.PAGE_COUNT++;
      ctx.vars.COLUMN_COUNT = ctx.vars.PAGE_COUNT;
      stepVars();
      detailKeys.forEach(function (k) {
        if (stop || !band(k)) return;
        var dh = h(k) + stretchOf(k);       // with this record's stretched text fields
        // A new page when the band does not fit, unless nothing has been placed below the headers yet.
        if (page.y + dh > detailLimit() && (page.y > page.top + 0.5 || (titled && page.num === 1))) {
          if (pages.length >= MAX_PAGES) { note('The preview stops at ' + MAX_PAGES + ' pages (' + i + ' of ' + list.length + ' rows).'); stop = true; return; }
          endPage(false); newPage(); headers();
        }
        var startPage = page;
        var de = place(k, page.y, true);
        if (de !== false) {
          if (page === startPage && de > detailLimit()) note(bandLabel(k) + ' is taller than the space on a page.');
          page.y = de;
          page.dets = (page.dets || 0) + 1;
        }
      });
    }

    // Summary: after the details, on a new page when it does not fit (or is set to).
    // Summary pages have the page header and footer only when "Summary with page header and footer" is set.
    if (band('summary')) {
      var withHF = attrs.isSummaryWithPageHeaderAndFooter === 'true';
      if (attrs.isSummaryNewPage === 'true' || page.y + h('summary') > detailLimit()) { endPage(false); newPage(!withHF); if (withHF) headers(); }
      var se = place('summary', page.y, true);
      if (se !== false) page.y = se;
    }
    endPage(true);

    // Values evaluated at the end of the report ("Page X of Y": the total).
    ctx.vars.PAGE_NUMBER = pages.length;
    reportLater.forEach(function (it) { it.text = textOf(it.el, bandLabel(it.band)); fitText(it); });
    pages.forEach(function (p) { delete p.y; delete p.top; delete p.headed; delete p.bare; delete p.dets; });
    return { pages: pages, notes: notes, empty: '' };
  }

  return { fill: fill, evaluate: evaluate, parse: parse, formatDate: formatDate, formatNumber: formatNumber, javaString: javaString, paramValue: paramValue, _readVariables: readVariables };
});
