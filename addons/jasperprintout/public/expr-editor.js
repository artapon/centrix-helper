// <jd-expr>: JasperReports expression editor for the Designer's Properties popup, modelled on the
// Jaspersoft Studio Expression Editor: syntax colouring for $F{…} / $P{…} / $V{…}, strings and
// functions, and content assist (Ctrl+Space, or typing "$", "$F{", "." or a word) offering the
// report's fields, parameters and variables, the function library (Logical, Date/Time, Text, Math),
// Java helpers and the methods of the value before the dot (String, Number, Date, Boolean).
// Only what the local preview (jrxml-fill.js) can evaluate is offered.
//
//   <jd-expr v-model="sel.expression" :catalog="exprCatalog" @change="commit" :rows="3"></jd-expr>
//   catalog: { fields: [{ name, cls }], params: [{ name, cls, builtin }], vars: [{ name, cls, builtin }] }
// Falls back to a plain textarea when CodeMirror is not loaded.
(function () {
  'use strict';

  if (!window.Vue) return;
  var CM = window.CodeMirror;

  // ─── Function library (Jaspersoft Studio's categories) ────────────────────
  // sig: shown in the list; text: inserted (the cursor goes inside the first "()" that has arguments).
  var FUNCTIONS = [
    ['Logical', 'IF', 'IF(condition, then, else)', 'Returns then when condition is true, else otherwise'],
    ['Logical', 'AND', 'AND(a, b, …)', 'True when every value is true'],
    ['Logical', 'OR', 'OR(a, b, …)', 'True when any value is true'],
    ['Logical', 'NOT', 'NOT(value)', 'Inverts a Boolean'],
    ['Logical', 'EQUALS', 'EQUALS(a, b)', 'True when both values are equal (null-safe)'],
    ['Logical', 'ISNULL', 'ISNULL(value)', 'True when the value is null'],
    ['Date/Time', 'TODAY', 'TODAY()', 'Today at 00:00'],
    ['Date/Time', 'NOW', 'NOW()', 'The current date and time'],
    ['Date/Time', 'DATE', 'DATE(year, month, day)', 'A date from its parts (month 1–12)'],
    ['Date/Time', 'DATEFORMAT', 'DATEFORMAT(date, "dd/MM/yyyy")', 'Formats a date with a pattern'],
    ['Date/Time', 'DATEVALUE', 'DATEVALUE(value)', 'Converts a string or number to a date'],
    ['Date/Time', 'DAY', 'DAY(date)', 'Day of the month (1–31)'],
    ['Date/Time', 'MONTH', 'MONTH(date)', 'Month (1–12)'],
    ['Date/Time', 'YEAR', 'YEAR(date)', 'Year'],
    ['Date/Time', 'WEEKDAY', 'WEEKDAY(date)', 'Day of the week (1 = Sunday)'],
    ['Date/Time', 'DAYS', 'DAYS(from, to)', 'Whole days between two dates'],
    ['Date/Time', 'MONTHS', 'MONTHS(from, to)', 'Whole months between two dates'],
    ['Date/Time', 'YEARS', 'YEARS(from, to)', 'Whole years between two dates (e.g. age)'],
    ['Date/Time', 'EDATE', 'EDATE(date, months)', 'The date moved by a number of months'],
    ['Text', 'CONCATENATE', 'CONCATENATE(a, b, …)', 'Joins values as text (null = empty)'],
    ['Text', 'LEN', 'LEN(text)', 'Number of characters'],
    ['Text', 'LOWER', 'LOWER(text)', 'Lower case'],
    ['Text', 'UPPER', 'UPPER(text)', 'Upper case'],
    ['Text', 'TRIM', 'TRIM(text)', 'Removes extra spaces'],
    ['Text', 'LEFT', 'LEFT(text, count)', 'The first characters'],
    ['Text', 'RIGHT', 'RIGHT(text, count)', 'The last characters'],
    ['Text', 'MID', 'MID(text, start, count)', 'Characters from a 1-based position'],
    ['Text', 'FIND', 'FIND(search, text)', '1-based position of search in text, 0 if absent'],
    ['Text', 'REPLACE', 'REPLACE(text, start, count, newText)', 'Replaces characters by position'],
    ['Text', 'SUBSTITUTE', 'SUBSTITUTE(text, old, new)', 'Replaces every occurrence of old'],
    ['Text', 'REPT', 'REPT(text, times)', 'Repeats text'],
    ['Text', 'TEXT', 'TEXT(number, "#,##0.00")', 'Formats a number with a pattern'],
    ['Math', 'ABS', 'ABS(number)', 'Absolute value'],
    ['Math', 'FLOOR', 'FLOOR(number)', 'Rounds down'],
    ['Math', 'CEIL', 'CEIL(number)', 'Rounds up'],
    ['Math', 'SQRT', 'SQRT(number)', 'Square root'],
    ['Math', 'POWER', 'POWER(number, exponent)', 'Raises to a power'],
    ['Math', 'ISEVEN', 'ISEVEN(number)', 'True for even numbers'],
    ['Math', 'ISODD', 'ISODD(number)', 'True for odd numbers'],
    ['Math', 'SUM', 'SUM(a, b, …)', 'Adds numbers'],
    ['Math', 'PRODUCT', 'PRODUCT(a, b, …)', 'Multiplies numbers']
  ].map(function (f) { return { cat: f[0], name: f[1], sig: f[2], doc: f[3], text: f[1] + '()' }; });
  var FUNC_NAMES = {};
  FUNCTIONS.forEach(function (f) { FUNC_NAMES[f.name] = 1; });

  // Java helpers (Miscellaneous). name: what typing matches.
  var JAVA = [
    ['Date', 'new java.util.Date()', 'The current date and time'],
    ['SimpleDateFormat', 'new java.text.SimpleDateFormat("dd/MM/yyyy").format()', 'Formats a date with a pattern'],
    ['DecimalFormat', 'new java.text.DecimalFormat("#,##0.00").format()', 'Formats a number with a pattern'],
    ['String.valueOf', 'String.valueOf()', 'Any value as text'],
    ['String.format', 'String.format("%s", )', 'printf-style formatting'],
    ['Integer.parseInt', 'Integer.parseInt()', 'Text to a whole number'],
    ['Double.parseDouble', 'Double.parseDouble()', 'Text to a decimal number'],
    ['Math.round', 'Math.round()', 'Rounds to the nearest whole number'],
    ['Math.max', 'Math.max(a, b)', 'The larger of two numbers'],
    ['Math.min', 'Math.min(a, b)', 'The smaller of two numbers'],
    ['Objects.toString', 'Objects.toString(value, "")', 'Text, or the fallback when null'],
    ['Boolean.TRUE', 'Boolean.TRUE', 'true as a Boolean object'],
    ['Boolean.FALSE', 'Boolean.FALSE', 'false as a Boolean object']
  ].map(function (j) { return { cat: 'Java', name: j[0], sig: j[1], doc: j[2], text: j[1].replace(/\(a, b\)$|\(value, ""\)$/, '()') }; });
  // "String.format(\"%s\", )" keeps its pattern; the cursor lands before the final ")".
  JAVA.forEach(function (j) { if (j.name === 'String.format') j.text = 'String.format("%s", )'; });

  var KEYWORDS = ['null', 'true', 'false', 'new', 'instanceof'];
  var STATICS = {
    String: ['valueOf()', 'format("%s", )'], Integer: ['parseInt()', 'valueOf()', 'MAX_VALUE', 'MIN_VALUE'],
    Long: ['parseLong()', 'valueOf()'], Double: ['parseDouble()', 'valueOf()'], Float: ['parseFloat()'],
    Boolean: ['TRUE', 'FALSE', 'valueOf()', 'parseBoolean()'], Math: ['round()', 'abs()', 'max(a, b)', 'min(a, b)', 'floor()', 'ceil()', 'pow(a, b)', 'PI'],
    Objects: ['isNull()', 'nonNull()', 'toString(value, "")'], BigDecimal: ['valueOf()']
  };

  // Methods of a value, by kind (the ones the local preview evaluates).
  var M = function (sig, doc, ret) { return { sig: sig, doc: doc, ret: ret }; };
  var METHODS = {
    String: [
      M('toUpperCase()', 'Upper case', 'String'), M('toLowerCase()', 'Lower case', 'String'), M('trim()', 'Without leading/trailing spaces', 'String'),
      M('substring(begin, end)', 'Part of the text (0-based, end excluded)', 'String'), M('length()', 'Number of characters', 'int'),
      M('isEmpty()', 'True when ""', 'boolean'), M('isBlank()', 'True when empty or only spaces', 'boolean'),
      M('equals(other)', 'Same text', 'boolean'), M('equalsIgnoreCase(other)', 'Same text ignoring case', 'boolean'),
      M('contains(text)', 'Contains the text', 'boolean'), M('startsWith(prefix)', 'Starts with', 'boolean'), M('endsWith(suffix)', 'Ends with', 'boolean'),
      M('indexOf(text)', '0-based position, -1 if absent', 'int'), M('lastIndexOf(text)', 'Last 0-based position', 'int'),
      M('charAt(index)', 'One character', 'char'), M('concat(text)', 'Appends text', 'String'),
      M('replace(old, new)', 'Replaces every occurrence', 'String'), M('replaceAll(regex, replacement)', 'Replaces regex matches', 'String'),
      M('replaceFirst(regex, replacement)', 'Replaces the first regex match', 'String'), M('matches(regex)', 'Whole text matches the regex', 'boolean'),
      M('split(regex)', 'Splits into an array', 'String[]'), M('compareTo(other)', 'Sort order (<0, 0, >0)', 'int'), M('toString()', 'The text', 'String')
    ],
    Number: [
      M('intValue()', 'As a whole number', 'int'), M('longValue()', 'As a long', 'long'), M('doubleValue()', 'As a decimal', 'double'),
      M('floatValue()', 'As a float', 'float'), M('setScale(decimals)', 'Rounded to decimals (BigDecimal)', 'BigDecimal'),
      M('compareTo(other)', 'Sort order (<0, 0, >0)', 'int'), M('equals(other)', 'Same value and type', 'boolean'), M('toString()', 'As text', 'String')
    ],
    Date: [
      M('getTime()', 'Milliseconds since 1970', 'long'), M('before(date)', 'Earlier than', 'boolean'), M('after(date)', 'Later than', 'boolean'),
      M('compareTo(date)', 'Sort order (<0, 0, >0)', 'int'), M('getYear()', 'Year − 1900', 'int'), M('getMonth()', 'Month 0–11', 'int'),
      M('getDate()', 'Day of the month', 'int'), M('getDay()', 'Day of the week 0–6', 'int'), M('getHours()', 'Hour', 'int'),
      M('getMinutes()', 'Minutes', 'int'), M('getSeconds()', 'Seconds', 'int'), M('equals(other)', 'Same instant', 'boolean'), M('toString()', 'As text', 'String')
    ],
    Boolean: [M('booleanValue()', 'As boolean', 'boolean'), M('equals(other)', 'Same value', 'boolean'), M('toString()', 'As text', 'String')],
    Format: [M('format(value)', 'Formats the value', 'String')]
  };

  function kindOf(cls) {
    var c = String(cls || '').replace(/^.*\./, '');
    if (c === 'String') return 'String';
    if (/^(Date|Timestamp|Time|LocalDate|LocalDateTime)$/.test(c)) return 'Date';
    if (/^(Integer|Long|Short|Byte|Double|Float|BigDecimal|BigInteger|Number)$/.test(c)) return 'Number';
    if (c === 'Boolean') return 'Boolean';
    return null;
  }
  var shortCls = function (cls) { return String(cls || '').replace(/^java\.(lang|util|math|sql)\./, ''); };

  // ─── Syntax colouring ──────────────────────────────────────────────────────
  if (CM && !CM.modes.jrexpr) {
    CM.defineMode('jrexpr', function () {
      return {
        token: function (stream) {
          if (stream.eatSpace()) return null;
          var m = stream.match(/^\$([FPVR])\{[^}]*\}?/);
          if (m) return 'jr-' + m[1].toLowerCase();
          if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string';
          if (stream.match(/^\/\/.*/)) return 'comment';
          if (stream.match(/^\d+(?:\.\d+)?[LlDdFf]?/)) return 'number';
          m = stream.match(/^[A-Za-z_]\w*/);
          if (m) {
            if (KEYWORDS.indexOf(m[0]) >= 0) return 'keyword';
            if (FUNC_NAMES[m[0]] && stream.match(/^\s*\(/, false)) return 'builtin';
            return /^[A-Z]/.test(m[0]) ? 'variable-2' : 'variable';
          }
          if (stream.match(/^[+\-*\/%=!<>&|?:]+/)) return 'operator';
          stream.next();
          return null;
        },
        lineComment: '//'
      };
    });
  }

  // ─── Content assist ────────────────────────────────────────────────────────
  // After inserting: the cursor goes before the last ")" when the call takes arguments, else at the end.
  function insertText(cm, from, to, text, hasArgs) {
    cm.replaceRange(text, from, to, '+complete');
    var off = hasArgs && text.lastIndexOf(')') > 0 ? text.lastIndexOf(')') : text.length;
    cm.setCursor(cm.posFromIndex(cm.indexFromPos(from) + off));
  }

  function rank(items, word, key) {
    var w = word.toLowerCase();
    if (!w) return items.slice();
    var pre = [], mid = [];
    items.forEach(function (it) {
      var k = String(key(it)).toLowerCase(), i = k.indexOf(w);
      if (i === 0) pre.push(it); else if (i > 0) mid.push(it);
    });
    return pre.concat(mid);
  }

  function render(el, self, d) {
    var a = document.createElement('span'); a.className = 'jd-hint-name'; a.textContent = d.label;
    el.appendChild(a);
    if (d.detail) { var b = document.createElement('span'); b.className = 'jd-hint-detail'; b.textContent = d.detail; el.appendChild(b); }
    if (d.tag) { var c = document.createElement('span'); c.className = 'jd-hint-tag jd-hint-' + d.tagKind; c.textContent = d.tag; el.appendChild(c); }
    if (d.doc) el.title = d.doc;
  }

  function item(label, text, opts) {
    var d = { text: text, displayText: label, label: label, render: render };
    for (var k in opts) d[k] = opts[k];
    d.hint = function (cm, data, cur) { insertText(cm, data.from, data.to, cur.text, cur.hasArgs); };
    return d;
  }

  var REF_KIND = { F: 'Field', P: 'Parameter', V: 'Variable' };
  function refItems(catalog, kind) {
    var list = kind === 'F' ? catalog.fields : kind === 'P' ? catalog.params : catalog.vars;
    return (list || []).map(function (r) {
      var t = '$' + kind + '{' + r.name + '}';
      return item(t, t, { name: r.name, detail: shortCls(r.cls), tag: REF_KIND[kind] + (r.builtin ? ' · built-in' : ''), tagKind: kind.toLowerCase(),
        doc: (r.desc ? r.desc + ' — ' : '') + (r.cls || ''), builtin: !!r.builtin, cls: r.cls });
    });
  }
  function allRefs(catalog) {
    var user = [], builtin = [];
    ['F', 'P', 'V'].forEach(function (k) { refItems(catalog, k).forEach(function (r) { (r.builtin ? builtin : user).push(r); }); });
    return user.concat(builtin);
  }
  function funcItems() {
    return FUNCTIONS.map(function (f) { return item(f.sig, f.text, { name: f.name, tag: f.cat, tagKind: 'fn', doc: f.doc, hasArgs: !/\(\)$/.test(f.sig) }); })
      .concat(JAVA.map(function (j) { return item(j.sig, j.text, { name: j.name, tag: 'Java', tagKind: 'java', doc: j.doc, hasArgs: !/\(\)$/.test(j.sig) || /format\(\)$/.test(j.sig) }); }));
  }
  function methodItems(kind) {
    var kinds = kind ? [kind] : ['String', 'Number', 'Date', 'Boolean', 'Format'], seen = {}, out = [];
    kinds.forEach(function (k) {
      METHODS[k].forEach(function (m) {
        if (seen[m.sig]) return;
        seen[m.sig] = 1;
        var name = m.sig.replace(/\(.*$/, ''), args = !/\(\)$/.test(m.sig);
        out.push(item(m.sig, name + '()', { name: name, detail: m.ret, tag: kind ? k : k + ' method', tagKind: 'm', doc: m.doc, hasArgs: args }));
      });
    });
    return out;
  }

  // The hint source: what fits the text before the cursor.
  function hinter(catalog) {
    return function (cm) {
      var cur = cm.getCursor(), line = cm.getLine(cur.line), before = line.slice(0, cur.ch), m, list, from, to = cur;

      // Inside $F{…} / $P{…} / $V{…}: that kind's names (a closing "}" after the cursor is replaced too).
      if ((m = /\$([FPVR])\{([^}"]*)$/.exec(before))) {
        var kind = m[1] === 'R' ? null : m[1];
        if (!kind) return null;
        from = CM.Pos(cur.line, cur.ch - m[0].length);
        var end = line.slice(cur.ch).match(/^[^}\s"]*\}?/)[0];
        to = CM.Pos(cur.line, cur.ch + end.length);
        list = rank(refItems(catalog, kind), m[2], function (r) { return r.name; });
        return list.length ? { list: list, from: from, to: to } : null;
      }
      // "$", "$F", …: fields, parameters and variables.
      if ((m = /\$([FPV]?)$/.exec(before))) {
        from = CM.Pos(cur.line, cur.ch - m[0].length);
        list = m[1] ? refItems(catalog, m[1]) : allRefs(catalog);
        return list.length ? { list: list, from: from, to: to } : null;
      }
      // After a dot: methods of the value before it, or a class's static members.
      if ((m = /(\$([FPV])\{([^}]*)\}|"(?:[^"\\]|\\.)*"|\)|\b([A-Za-z_]\w*))\s*\.(\w*)$/.exec(before))) {
        var word = m[5];
        from = CM.Pos(cur.line, cur.ch - word.length);
        if (m[4] && STATICS[m[4]]) {
          list = STATICS[m[4]].map(function (s) {
            var name = s.replace(/\(.*$/, '');
            return item(m[4] + '.' + s, /\(/.test(s) ? name + s.slice(name.length).replace(/^\((a, b|value, "")\)$/, '()') : s,
              { name: name, tag: m[4], tagKind: 'java', hasArgs: /\(./.test(s) || /\(\)$/.test(s) });
          });
        } else if (m[4]) {
          return null; // package names (java.util.…) and unknown identifiers
        } else {
          var k = null;
          if (m[2]) {
            var refs = m[2] === 'F' ? catalog.fields : m[2] === 'P' ? catalog.params : catalog.vars;
            var ref = (refs || []).filter(function (r) { return r.name === m[3]; })[0];
            k = ref ? kindOf(ref.cls) : null;
          } else if (m[1].charAt(0) === '"') k = 'String';
          else if (/Format\([^()]*\)\s*\.\w*$/.test(before)) k = 'Format';
          list = methodItems(k);
        }
        list = rank(list, word, function (r) { return r.name; });
        return list.length ? { list: list, from: from, to: to } : null;
      }
      // A word: references whose name matches, functions, Java helpers and keywords.
      m = /[A-Za-z_]\w*$/.exec(before);
      var w = m ? m[0] : '';
      if (w && /["']/.test(before.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/[^"]/g, ''))) return null; // inside a string
      from = CM.Pos(cur.line, cur.ch - w.length);
      var kw = KEYWORDS.map(function (k) { return item(k, k, { name: k, tag: 'keyword', tagKind: 'kw' }); });
      list = w ? rank(allRefs(catalog), w, function (r) { return r.name; }).concat(rank(funcItems().concat(kw), w, function (r) { return r.name; }))
        : allRefs(catalog).concat(funcItems());
      return list.length ? { list: list, from: from, to: to } : null;
    };
  }

  // ─── The component ─────────────────────────────────────────────────────────
  window.Vue.component('jd-expr', {
    props: {
      value: { type: String, default: '' },
      catalog: { type: Object, default: function () { return { fields: [], params: [], vars: [] }; } },
      rows: { type: Number, default: 3 },
      placeholder: { type: String, default: '' },
      toolbar: { type: Boolean, default: true },
      label: { type: String, default: 'Expression' }
    },
    data: function () { return { hasCM: !!CM, focused: false }; },
    computed: {
      groups: function () {
        var c = this.catalog, g = [];
        var refs = function (list, k) { return (list || []).map(function (r) { return { v: '$' + k + '{' + r.name + '}', t: '$' + k + '{' + r.name + '}' + (r.builtin ? '' : '  · ' + shortCls(r.cls)) }; }); };
        if (c.fields && c.fields.length) g.push({ label: 'Fields', items: refs(c.fields, 'F') });
        var up = (c.params || []).filter(function (p) { return !p.builtin; }), bp = (c.params || []).filter(function (p) { return p.builtin; });
        if (up.length) g.push({ label: 'Parameters', items: refs(up, 'P') });
        g.push({ label: 'Variables', items: refs(c.vars, 'V') });
        ['Logical', 'Date/Time', 'Text', 'Math'].forEach(function (cat) {
          g.push({ label: 'Functions · ' + cat, items: FUNCTIONS.filter(function (f) { return f.cat === cat; }).map(function (f) { return { v: 'fn:' + f.name, t: f.sig }; }) });
        });
        g.push({ label: 'Java', items: JAVA.map(function (j) { return { v: 'java:' + j.name, t: j.sig }; }) });
        if (bp.length) g.push({ label: 'Built-in parameters', items: refs(bp, 'P') });
        return g;
      },
      minHeight: function () { return Math.round(this.rows * 18 + 10) + 'px'; }
    },
    watch: {
      value: function (v) {
        v = v == null ? '' : String(v);
        if (this._cm && v !== this._cm.getValue()) {
          this._quiet = true;
          this._cm.setValue(v);
          this._cm.clearHistory();
          this._quiet = false;
        }
      }
    },
    mounted: function () {
      var vm = this;
      if (!CM) return;
      var cm = vm._cm = CM(vm.$refs.host, {
        value: vm.value || '', mode: 'jrexpr', lineWrapping: true, matchBrackets: true, viewportMargin: Infinity,
        autoCloseBrackets: { pairs: '()[]{}""', explode: '' }, tabSize: 2, indentUnit: 2,
        extraKeys: {
          'Ctrl-Space': function (c) { vm.complete(); },
          'Cmd-Space': function (c) { vm.complete(); },
          Tab: false, 'Shift-Tab': false // leave Tab for moving between fields
        }
      });
      cm.on('change', function (c, ch) {
        if (vm._quiet) return;
        vm.$emit('input', c.getValue());
        // Typing opens the suggestions; closebrackets inserts "{}" without the '+input' origin, so this
        // listens to every typed change rather than to inputRead.
        if (!c.hasFocus() || ch.origin === '+complete' || ch.origin === 'setValue' || /^\+delete|^undo|^redo|^paste/.test(ch.origin || '')) return;
        var t = ch.text.join('\n');
        if (!/^(\$|\.|\{\}?|\w)$/.test(t)) return;
        setTimeout(function () {
          if (c.state.completionActive || !c.hasFocus()) return;
          var pos = c.getCursor(), before = c.getLine(pos.line).slice(0, pos.ch);
          if (/\$$|\.$|\$[FPV]\{[^}]*$/.test(before) || (/^\w$/.test(t) && /(^|[^\w$."])[A-Za-z_]\w$/.test(before))) vm.complete();
        }, 0);
      });
      cm.on('focus', function () { vm.focused = true; });
      cm.on('blur', function () { vm.focused = false; vm.$emit('change', cm.getValue()); });
      // Escape closes the suggestion list without closing the Properties popup.
      cm.on('keydown', function (c, e) { if (e.key === 'Escape' && c.state.completionActive) e.stopPropagation(); });
      vm._ro = window.ResizeObserver ? new ResizeObserver(function () { if (vm.$refs.host && vm.$refs.host.offsetWidth) cm.refresh(); }) : null;
      if (vm._ro) vm._ro.observe(vm.$refs.host);
    },
    beforeDestroy: function () {
      if (this._ro) this._ro.disconnect();
      if (this._cm && this._cm.state.completionActive) this._cm.closeHint();
    },
    methods: {
      complete: function () {
        var cm = this._cm;
        if (!cm || !cm.showHint) return;
        cm.showHint({ hint: hinter(this.catalog), completeSingle: false, closeCharacters: /[\s()\[\];:>,+\-*\/=!&|?]/, container: document.body });
      },
      focus: function () {
        if (this._cm) { this._cm.focus(); this._cm.setCursor(this._cm.lineCount(), 0); }
        else if (this.$refs.ta) this.$refs.ta.focus();
      },
      // From the Insert… list: at the cursor, replacing a selection.
      insert: function (e) {
        var v = e.target.value;
        e.target.value = '';
        if (!v) return;
        var text = v, hasArgs = false;
        if (v.indexOf('fn:') === 0) { var f = FUNCTIONS.filter(function (x) { return 'fn:' + x.name === v; })[0]; text = f.text; hasArgs = !/\(\)$/.test(f.sig); }
        else if (v.indexOf('java:') === 0) { var j = JAVA.filter(function (x) { return 'java:' + x.name === v; })[0]; text = j.text; hasArgs = !/\(\)$/.test(j.sig) || /format\(\)$/.test(j.sig); }
        var cm = this._cm;
        if (cm) {
          var cur = String(this.value || '');
          // A new Text Field's placeholder text is replaced rather than appended to.
          if (cur === '""' || cur === '"Text Field"') cm.setValue('');
          insertText(cm, cm.getCursor('from'), cm.getCursor('to'), text, hasArgs);
          cm.focus();
          this.$emit('change', cm.getValue());
        } else {
          var ta = this.$refs.ta, s = ta.selectionStart, val = ta.value;
          this.$emit('input', val.slice(0, s) + text + val.slice(ta.selectionEnd));
          this.$emit('change');
        }
      }
    },
    template:
      '<div class="jd-expr" :class="{ \'is-focus\': focused }">' +
        '<div v-if="hasCM" ref="host" class="jd-expr-cm" :style="{ \'--jd-expr-min\': minHeight }"></div>' +
        '<textarea v-else ref="ta" class="jd-mono" :rows="rows" :value="value" :placeholder="placeholder" spellcheck="false" :aria-label="label"' +
          ' @input="$emit(\'input\', $event.target.value)" @change="$emit(\'change\')"></textarea>' +
        '<div v-if="toolbar" class="jd-expr-bar">' +
          '<select @change="insert" :aria-label="\'Insert into \' + label">' +
            '<option value="">Insert field, parameter, variable or function…</option>' +
            '<optgroup v-for="g in groups" :key="g.label" :label="g.label"><option v-for="o in g.items" :key="o.v" :value="o.v">{{ o.t }}</option></optgroup>' +
          '</select>' +
          '<span v-if="hasCM" class="jd-expr-tip"><kbd>Ctrl</kbd>+<kbd>Space</kbd> suggestions · type <code>$</code> or <code>.</code></span>' +
        '</div>' +
      '</div>'
  });
})();
