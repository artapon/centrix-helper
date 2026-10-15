// E-Learning: what every page of the add-on shares. Loaded by each view before the page mounts.
//   ELearn.md(text)        Markdown -> HTML (everything typed is escaped first, so v-html is safe)
//   ELearn.post / getJson  JSON requests that throw the server's { error } as an Error
//   <el-player :player>    a lesson's video: an iframe (YouTube, Google Drive) or a <video> (shared folder)
//   <el-md-editor v-model> a Markdown textarea with a toolbar and a preview
(function () {
  'use strict';

  // The add-on's styles, once per page
  if (!document.getElementById('el-css')) {
    var link = document.createElement('link');
    link.id = 'el-css';
    link.rel = 'stylesheet';
    link.href = '/e-learning/assets/elearning.css?v=3';
    document.head.appendChild(link);
  }

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var unesc = function (s) {
    return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  };
  // Links and images: web addresses, mail and paths of this site only (never javascript: and the like)
  var safeUrl = function (u) {
    u = String(u || '').trim();
    return /^(https?:\/\/|mailto:)/i.test(u) || /^\/(?!\/)/.test(u) ? u : null;
  };

  // ---- Markdown (a practical subset) ----
  function inlineText(s) {
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
      var u = safeUrl(unesc(url));
      return u ? '<img src="' + esc(u) + '" alt="' + alt + '" loading="lazy">' : m;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      var u = safeUrl(unesc(url));
      return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : m;
    });
    s = s.replace(/(^|[\s(])(https?:\/\/(?:(?!&quot;|&#39;)[^\s<])+[^\s<.,;:!?)&])/g, function (m, pre, url) {
      return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
    return s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>');
  }
  function inline(s) {
    return String(s).split(/(`[^`]+`)/).map(function (part, i) {
      return i % 2 ? '<code>' + esc(part.slice(1, -1)) + '</code>' : inlineText(part);
    }).join('');
  }
  function md(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], i = 0;
    var flush = function () { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    while (i < lines.length) {
      var line = lines[i], m;
      if (/^\s*```/.test(line)) {
        flush();
        var code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        flush();
        var n = m[1].length + 1;
        out.push('<h' + n + '>' + inline(m[2].replace(/\s+#+\s*$/, '')) + '</h' + n + '>');
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        flush();
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push('<blockquote>' + md(quote.join('\n')) + '</blockquote>');
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        var ordered = /^\s*\d/.test(line), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) && /^\s*\d/.test(lines[i]) === ordered) {
          var item = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
          var task = /^\[( |x)\]\s+/i.exec(item);
          items.push(task
            ? '<li class="is-task"><i class="' + (task[1] === ' ' ? 'far fa-square' : 'fas fa-check-square') + '" aria-hidden="true"></i> ' + inline(item.slice(task[0].length)) + '</li>'
            : '<li>' + inline(item) + '</li>');
        }
        out.push(ordered ? '<ol>' + items.join('') + '</ol>' : '<ul>' + items.join('') + '</ul>');
        continue;
      }
      para.push(line);
      i++;
    }
    flush();
    return out.join('\n');
  }

  // ---- requests ----
  var json = function (r) {
    return r.json().catch(function () { return { error: r.status === 413 ? 'This is too large to save.' : 'The server answered ' + r.status + '.' }; })
      .then(function (d) { if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status)); return d; });
  };
  var post = function (url, body, asText) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': asText ? 'text/plain' : 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {})
    }).then(json);
  };
  var getJson = function (url) { return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(json); };

  // ---- formatting ----
  var LEVELS = { all: 'All levels', beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
  var SOURCES = { youtube: 'YouTube', gdrive: 'Google Drive', share: 'Shared folder' };
  var duration = function (min) {
    min = +min || 0;
    if (!min) return '';
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + ' h' + (m ? ' ' + m + ' min' : '') : m + ' min';
  };
  var hue = function (s) {
    var h = 0;
    String(s || '').split('').forEach(function (ch) { h = (h * 31 + ch.charCodeAt(0)) % 360; });
    return h;
  };
  // A course without a thumbnail gets a gradient of its category's own colour
  var cover = function (c) {
    var h = hue(c.category || c.title);
    return 'background: linear-gradient(135deg, hsl(' + h + ', 70%, 55%), hsl(' + ((h + 40) % 360) + ', 70%, 42%))';
  };
  var initials = function (name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };
  var when = function (iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  var pct = function (done, total) { return total ? Math.round(done * 100 / total) : 0; };
  var size = function (b) {
    if (b == null) return '';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (i ? b.toFixed(b < 10 ? 1 : 0) : b) + ' ' + u[i];
  };

  window.ELearn = {
    esc: esc, md: md, post: post, getJson: getJson, LEVELS: LEVELS, SOURCES: SOURCES,
    duration: duration, cover: cover, initials: initials, when: when, pct: pct, size: size
  };

  if (!window.Vue) return;

  Vue.component('el-player', {
    props: { player: { type: Object, default: null } },
    template:
      '<div class="el-player-box" :class="{ \'is-audio\': player && player.audio }">' +
        '<iframe v-if="player && player.kind === \'iframe\'" :src="player.src" title="Lesson video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
        '<template v-else-if="player && player.kind === \'file\'">' +
          '<audio v-if="player.audio" ref="media" controls preload="metadata" :src="player.src" @loadedmetadata="meta" @error="failed"></audio>' +
          '<video v-else ref="media" controls preload="metadata" playsinline controlslist="nodownload" :src="player.src" @loadedmetadata="meta" @error="failed"></video>' +
          '<div v-if="error" class="el-player-err"><i class="fas fa-exclamation-triangle" aria-hidden="true"></i><span>{{ error }}</span></div>' +
        '</template>' +
      '</div>',
    data: function () { return { error: '' }; },
    watch: { player: function () { this.error = ''; } },
    methods: {
      meta: function () {
        var d = this.$refs.media && this.$refs.media.duration;
        if (d && isFinite(d)) this.$emit('duration', d);
      },
      failed: function () {
        var e = this.$refs.media && this.$refs.media.error;
        this.error = e && e.code === 4
          ? 'This browser cannot play this video file (or the server cannot read it). MP4 (H.264) and WebM play everywhere.'
          : 'The video could not be loaded.';
      }
    }
  });

  var TOOLS = [
    { icon: 'fas fa-heading', title: 'Heading', line: '## ' },
    { icon: 'fas fa-bold', title: 'Bold', wrap: ['**', '**'], ph: 'bold text' },
    { icon: 'fas fa-italic', title: 'Italic', wrap: ['*', '*'], ph: 'italic text' },
    { icon: 'fas fa-highlighter', title: 'Highlight', wrap: ['==', '=='], ph: 'highlighted' },
    { sep: true },
    { icon: 'fas fa-list-ul', title: 'Bulleted list', line: '- ' },
    { icon: 'fas fa-list-ol', title: 'Numbered list', line: '1. ' },
    { icon: 'far fa-check-square', title: 'Checklist', line: '- [ ] ' },
    { icon: 'fas fa-quote-right', title: 'Quote / note', line: '> ' },
    { sep: true },
    { icon: 'fas fa-link', title: 'Link', wrap: ['[', '](https://)'], ph: 'link text' },
    { icon: 'far fa-image', title: 'Image (web address)', wrap: ['![', '](https://)'], ph: 'description' },
    { icon: 'fas fa-code', title: 'Code', wrap: ['`', '`'], ph: 'code', block: '```\n', blockEnd: '\n```' },
    { icon: 'fas fa-minus', title: 'Divider', insert: '\n---\n' }
  ];

  Vue.component('el-md-editor', {
    props: { value: { type: String, default: '' }, rows: { type: Number, default: 10 }, placeholder: { type: String, default: '' } },
    data: function () { return { tab: 'write', TOOLS: TOOLS }; },
    computed: { html: function () { return md(this.value); } },
    template:
      '<div class="el-mde">' +
        '<div class="el-mde-bar">' +
          '<div class="el-mde-tabs" role="tablist">' +
            '<button type="button" role="tab" :aria-selected="tab === \'write\'" :class="{ \'is-on\': tab === \'write\' }" @click="tab = \'write\'">Write</button>' +
            '<button type="button" role="tab" :aria-selected="tab === \'preview\'" :class="{ \'is-on\': tab === \'preview\' }" @click="tab = \'preview\'">Preview</button>' +
          '</div>' +
          '<div v-show="tab === \'write\'" class="el-mde-tools">' +
            '<template v-for="(t, i) in TOOLS"><span v-if="t.sep" :key="i" class="el-mde-sep"></span>' +
            '<button v-else :key="i" type="button" :title="t.title" :aria-label="t.title" @click="apply(t)"><i :class="t.icon" aria-hidden="true"></i></button></template>' +
          '</div>' +
          '<a class="el-mde-help" href="https://www.markdownguide.org/basic-syntax/" target="_blank" rel="noopener" title="Markdown help"><i class="fab fa-markdown" aria-hidden="true"></i> Markdown</a>' +
        '</div>' +
        '<textarea v-show="tab === \'write\'" ref="ta" :rows="rows" :value="value" :placeholder="placeholder" @input="$emit(\'input\', $event.target.value)" @keydown="keys"></textarea>' +
        '<div v-show="tab === \'preview\'" class="el-mde-preview el-md" :style="{ minHeight: (rows * 22) + \'px\' }">' +
          '<div v-if="value.trim()" v-html="html"></div><p v-else class="el-muted">Nothing to preview yet.</p>' +
        '</div>' +
      '</div>',
    methods: {
      set: function (text, selStart, selEnd) {
        var ta = this.$refs.ta;
        this.$emit('input', text);
        this.$nextTick(function () { ta.focus(); ta.setSelectionRange(selStart, selEnd); });
      },
      apply: function (t) {
        var ta = this.$refs.ta, v = this.value, a = ta.selectionStart, b = ta.selectionEnd, sel = v.slice(a, b);
        if (t.insert) return this.set(v.slice(0, a) + t.insert + v.slice(b), a + t.insert.length, a + t.insert.length);
        if (t.line) {
          // every selected line gets the prefix (numbered lists count up)
          var start = v.lastIndexOf('\n', a - 1) + 1, block = v.slice(start, b), n = 0;
          var lines = block.split('\n').map(function (l) { n++; return (t.line === '1. ' ? n + '. ' : t.line) + l; }).join('\n');
          return this.set(v.slice(0, start) + lines + v.slice(b), start + lines.length, start + lines.length);
        }
        if (t.block && sel.indexOf('\n') >= 0) {
          var blk = t.block + sel + t.blockEnd;
          return this.set(v.slice(0, a) + blk + v.slice(b), a + blk.length, a + blk.length);
        }
        var text = sel || t.ph;
        var out = v.slice(0, a) + t.wrap[0] + text + t.wrap[1] + v.slice(b);
        return this.set(out, a + t.wrap[0].length, a + t.wrap[0].length + text.length);
      },
      keys: function (e) {
        if (!(e.ctrlKey || e.metaKey)) return;
        var k = e.key.toLowerCase();
        if (k === 'b' || k === 'i') { e.preventDefault(); this.apply(TOOLS[k === 'b' ? 1 : 2]); }
      }
    }
  });
})();
