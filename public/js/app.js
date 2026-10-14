// Shared layout behaviour: sidebar, menu search, table quick filter, page-load progress,
// and the date pickers / helpers that views rely on.
(function ($) {
  var store = {
    get: function (key, fallback) {
      try {
        var value = window.localStorage.getItem(key);
        return value === null ? fallback : JSON.parse(value);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    }
  };

  var MOBILE = window.matchMedia('(max-width: 991.98px)');

  // Apply the remembered desktop sidebar state before first paint to avoid a flash.
  if (store.get('sidebarCollapsed', false)) document.documentElement.classList.add('sidebar-collapsed');

  // Views call toggleCells() from onclick to show/hide `.hideable` columns.
  window.toggleCells = function () {
    $('.hideable').each(function () {
      this.style.display = this.style.display === 'none' ? 'table-cell' : 'none';
    });
  };

  function initSidebar() {
    var root = document.documentElement;

    $(document).on('click', '[data-sidebar-toggle]', function () {
      if (MOBILE.matches) {
        root.classList.toggle('sidebar-open');
      } else {
        root.classList.toggle('sidebar-collapsed');
        store.set('sidebarCollapsed', root.classList.contains('sidebar-collapsed'));
      }
    });
    $(document).on('click', '[data-sidebar-close]', function () { root.classList.remove('sidebar-open'); });
    $(document).on('keydown', function (e) {
      if (e.key === 'Escape') root.classList.remove('sidebar-open');
    });

    // Groups: the one holding the current page is always open; others remember their state.
    var openGroups = store.get('navOpenGroups', []);
    $('.nav-group').each(function () {
      var $group = $(this);
      if (!$group.hasClass('has-active') && openGroups.indexOf($group.data('group')) >= 0) setGroupOpen($group, true);
    });

    $(document).on('click', '.nav-group-toggle', function () {
      var $group = $(this).closest('.nav-group');
      setGroupOpen($group, !$group.hasClass('is-open'));
      saveOpenGroups();
    });
    $(document).on('click', '[data-nav-collapse]', function () {
      $('.nav-group').not('.has-active').each(function () { setGroupOpen($(this), false); });
      saveOpenGroups();
    });

    var active = document.querySelector('.nav-item-link.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'center' });
  }

  function setGroupOpen($group, open) {
    $group.toggleClass('is-open', open);
    $group.find('.nav-group-toggle').attr('aria-expanded', open ? 'true' : 'false');
  }

  function saveOpenGroups() {
    store.set('navOpenGroups', $('.nav-group.is-open').map(function () { return $(this).data('group'); }).get());
  }

  function initNavSearch() {
    var $input = $('#nav-search');
    if (!$input.length) return;

    $input.on('input', function () {
      var q = this.value.trim().toLowerCase();
      var anyVisible = false;
      $('#sidebar-nav').toggleClass('is-searching', q.length > 0);
      $('.nav-group').each(function () {
        var $group = $(this);
        var groupMatches = $group.find('.nav-group-toggle span').text().toLowerCase().indexOf(q) >= 0;
        var visibleItems = 0;
        $group.find('.nav-group-items li').each(function () {
          var show = !q || groupMatches || $(this).text().toLowerCase().indexOf(q) >= 0;
          $(this).toggle(show);
          if (show) visibleItems++;
        });
        $group.toggle(visibleItems > 0);
        if (visibleItems) anyVisible = true;
      });
      $('.sidebar-empty').prop('hidden', anyVisible);
    });

    $input.on('keydown', function (e) {
      if (e.key === 'Escape') { this.value = ''; $input.trigger('input'); this.blur(); }
      if (e.key === 'Enter') {
        var first = $('#sidebar-nav .nav-group:visible .nav-group-items li:visible a').get(0);
        if (first) window.location.href = first.href;
      }
    });

    // "/" focuses the menu search from anywhere outside a form field.
    $(document).on('keydown', function (e) {
      if (e.key !== '/' || /input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return;
      e.preventDefault();
      if (MOBILE.matches) document.documentElement.classList.add('sidebar-open');
      $input.trigger('focus');
    });
  }

  // Adds a quick filter and an advanced search to the header of every card that holds a
  // data table. Cards that have their own search opt out with data-table-filter="off".
  //   quick:    one box that matches anywhere in the row
  //   advanced: conditions on a column (contains, equals, >, is empty, ...), all or any
  // Rows added or changed later (Vue updates, "load more") are filtered too.
  var OPS = [
    ['contains', 'contains'], ['notcontains', 'does not contain'], ['eq', 'equals'], ['ne', 'does not equal'],
    ['starts', 'starts with'], ['ends', 'ends with'], ['gt', '> greater than'], ['gte', '≥ at least'],
    ['lt', '< less than'], ['lte', '≤ at most'], ['empty', 'is empty'], ['notempty', 'is not empty']
  ];
  var NO_VALUE = { empty: true, notempty: true };
  var ANY = '*';   // condition column: anywhere in the row

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  // Numbers for > and <: plain numbers (1,234.50) or dates (dd/mm/yyyy [hh:mm], yyyy-mm-dd [hh:mm]).
  function comparable(s) {
    var d = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/.exec(s);
    if (d) return Date.UTC(+d[3], +d[2] - 1, +d[1], +(d[4] || 0), +(d[5] || 0));
    d = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
    if (d) return Date.UTC(+d[1], +d[2] - 1, +d[3], +(d[4] || 0), +(d[5] || 0));
    var n = Number(String(s).replace(/,/g, ''));
    return s !== '' && isFinite(n) ? n : NaN;
  }
  function test(op, a, b) {
    switch (op) {
      case 'contains': return a.indexOf(b) !== -1;
      case 'notcontains': return a.indexOf(b) === -1;
      case 'eq': return a === b;
      case 'ne': return a !== b;
      case 'starts': return a.lastIndexOf(b, 0) === 0;
      case 'ends': return a.slice(-b.length) === b;
      case 'empty': return a === '';
      case 'notempty': return a !== '';
      default:
        var x = comparable(a), y = comparable(b);
        if (isNaN(x) || isNaN(y)) return false;
        return op === 'gt' ? x > y : op === 'gte' ? x >= y : op === 'lt' ? x < y : x <= y;
    }
  }

  // Lower-cased text of a row and of each cell, read from the DOM once per row and
  // forgotten when the row changes (see the MutationObserver below).
  var rowCache = new WeakMap();
  function rowInfo(row) {
    var info = rowCache.get(row);
    if (!info) {
      var cells = [];
      for (var i = 0; i < row.cells.length; i++) cells.push(clean(row.cells[i].textContent).toLowerCase());
      info = { text: cells.join(' '), cells: cells, section: row.cells.length === 1 && row.cells[0].colSpan > 1 };
      rowCache.set(row, info);
    }
    return info;
  }
  function rowText(row) { return rowInfo(row).text; }

  // Column names from the last header row; a column is searchable on its own only when its
  // header cell spans one column (otherwise "Any column" still works).
  function columnsOf(table) {
    var head = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    if (!head) return [];
    var cols = [], index = 0;
    for (var i = 0; i < head.cells.length; i++) {
      var th = head.cells[i], label = clean(th.textContent);
      if (th.colSpan === 1 && label) cols.push({ index: index, label: label });
      index += th.colSpan || 1;
    }
    return cols;
  }

  function initTableFilters() {
    $('.card').not('[data-table-filter="off"]').each(function () {
      var $card = $(this);
      var $header = $card.children('.card-header').first();
      var $tables = $card.find('.table-responsive table').filter(function () { return $(this).children('thead').length; });
      if (!$header.length || !$tables.length || $header.find('.table-filter').length) return;

      var columns = columnsOf($tables[0]);
      var colOptions = '<option value="' + ANY + '">Any column</option>' + columns.map(function (c) {
        return '<option value="' + c.index + '">' + esc(c.label) + '</option>';
      }).join('');
      var opOptions = OPS.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join('');
      var listId = 'tf-values-' + Math.random().toString(36).slice(2, 9);

      var $filter = $(
        '<div class="table-filter">' +
          '<i class="fas fa-search"></i>' +
          '<input type="search" class="table-filter-input" placeholder="Filter rows…" aria-label="Filter table rows">' +
          '<button type="button" class="table-filter-adv" aria-expanded="false" title="Advanced search: conditions on columns">' +
            '<i class="fas fa-sliders-h"></i><span>Advanced</span><b class="table-filter-badge" hidden></b></button>' +
          '<span class="table-filter-count" hidden></span>' +
        '</div>'
      );
      var $panel = $(
        '<div class="table-adv" hidden>' +
          '<div class="table-adv-match">Show rows that match ' +
            '<select class="table-adv-all" aria-label="Match all or any condition"><option value="all">all</option><option value="any">any</option></select>' +
            ' of these conditions</div>' +
          '<div class="table-adv-list"></div>' +
          '<div class="table-adv-actions">' +
            '<button type="button" class="btn btn-sm btn-outline-primary table-adv-add"><i class="fas fa-plus mr-1"></i>Add condition</button>' +
            '<button type="button" class="btn btn-sm btn-light table-adv-clear"><i class="fas fa-times mr-1"></i>Clear</button>' +
          '</div>' +
          '<datalist id="' + listId + '"></datalist>' +
        '</div>'
      );
      $header.addClass('has-filter').append($filter);
      $header.after($panel);

      var $count = $filter.find('.table-filter-count');
      var $badge = $filter.find('.table-filter-badge');
      var $list = $panel.find('.table-adv-list');
      var $values = $panel.find('datalist');
      var quick = '';

      function addCondition() {
        var $row = $(
          '<div class="table-adv-cond">' +
            '<select class="table-adv-col" aria-label="Column">' + colOptions + '</select>' +
            '<select class="table-adv-op" aria-label="Operator">' + opOptions + '</select>' +
            '<input type="text" class="table-adv-val" list="' + listId + '" placeholder="value" aria-label="Value">' +
            '<button type="button" class="table-adv-remove" title="Remove condition" aria-label="Remove condition"><i class="fas fa-trash-alt"></i></button>' +
          '</div>'
        );
        if (columns.length) $row.find('.table-adv-col').val(String(columns[0].index));
        $list.append($row);
        return $row;
      }

      function conditions() {
        var out = [];
        $list.children('.table-adv-cond').each(function () {
          var $c = $(this), op = $c.find('.table-adv-op').val(), value = clean($c.find('.table-adv-val').val()).toLowerCase();
          $c.find('.table-adv-val').prop('hidden', !!NO_VALUE[op]);
          if (NO_VALUE[op] || value !== '') out.push({ col: $c.find('.table-adv-col').val(), op: op, value: value });
        });
        return out;
      }

      // Suggestions for the value box: up to 200 distinct values of the chosen column.
      function suggest(col) {
        var seen = {}, out = [];
        $tables.children('tbody').children('tr').each(function () {
          if (out.length >= 200) return false;
          var info = rowInfo(this);
          if (info.section || col === ANY) return;
          var v = clean(this.cells[+col] ? this.cells[+col].textContent : '');
          if (v && v.length <= 80 && !seen[v]) { seen[v] = true; out.push(v); }
        });
        $values.html(out.sort().map(function (v) { return '<option value="' + esc(v) + '">'; }).join(''));
      }

      var apply = function () {
        var conds = conditions(), all = $panel.find('.table-adv-all').val() !== 'any';
        var active = !!quick || conds.length > 0;
        var shown = 0, total = 0;
        $tables.children('tbody').children('tr').each(function () {
          var info = rowInfo(this);
          if (info.section) { this.classList.toggle('is-filtered-out', active); return; }   // group headings/totals
          total++;
          var match = !quick || info.text.indexOf(quick) >= 0;
          if (match && conds.length) {
            var hit = function (c) { return test(c.op, c.col === ANY ? info.text : (info.cells[+c.col] || ''), c.value); };
            match = all ? conds.every(hit) : conds.some(hit);
          }
          this.classList.toggle('is-filtered-out', !match);
          if (match) shown++;
        });
        $count.prop('hidden', !active).text(shown + ' / ' + total);
        $badge.prop('hidden', !conds.length).text(conds.length);
      };

      // Debounced: large tables are re-filtered once typing pauses, not on every key.
      var timer = null;
      var later = function () { clearTimeout(timer); timer = setTimeout(apply, 150); };
      $filter.find('.table-filter-input').on('input', function () { quick = clean(this.value).toLowerCase(); later(); });
      $filter.find('.table-filter-adv').on('click', function () {
        var open = $panel.prop('hidden');
        $panel.prop('hidden', !open);
        this.setAttribute('aria-expanded', open ? 'true' : 'false');
        $(this).toggleClass('is-active', open);
        if (open && !$list.children().length) addCondition();
        if (open) $list.find('.table-adv-val').first().trigger('focus');
      });
      $panel.on('input change', 'select, input', later);
      $panel.on('change', '.table-adv-col', function () { suggest(this.value); });
      $panel.on('focus', '.table-adv-val', function () { suggest($(this).closest('.table-adv-cond').find('.table-adv-col').val()); });
      $panel.on('click', '.table-adv-remove', function () { $(this).closest('.table-adv-cond').remove(); apply(); });
      $panel.on('click', '.table-adv-add', function () { addCondition().find('.table-adv-val').trigger('focus'); });
      $panel.on('click', '.table-adv-clear', function () {
        $list.empty(); addCondition();
        quick = ''; $filter.find('.table-filter-input').val('');
        apply();
      });

      // Rows rendered or changed later (Vue, batch loading): forget their cached text and
      // filter them too while a search is active.
      if (window.MutationObserver) {
        var observer = new MutationObserver(function (mutations) {
          mutations.forEach(function (m) {
            var tr = m.target.nodeType === 1 ? m.target.closest('tr') : (m.target.parentNode && m.target.parentNode.closest('tr'));
            if (tr) rowCache.delete(tr);
          });
          if (quick || conditions().length) later();
        });
        $tables.each(function () {
          if (this.tBodies[0]) observer.observe(this.tBodies[0], { childList: true, subtree: true, characterData: true });
        });
      }
    });
  }

  // Let columns with long free text wrap; everything else stays on one line (see app.css).
  // Columns are chosen from the first rows so big tables are not measured cell by cell.
  var SAMPLE_ROWS = 100;
  function markLongCells() {
    $('.table-responsive .table').each(function () {
      var rows = this.tBodies.length ? this.tBodies[0].rows : [];
      var wrapCols = {};
      for (var r = 0; r < Math.min(rows.length, SAMPLE_ROWS); r++) {
        for (var c = 0; c < rows[r].cells.length; c++) {
          if (!wrapCols[c] && rows[r].cells[c].textContent.trim().length > 60) wrapCols[c] = true;
        }
      }
      var cols = Object.keys(wrapCols);
      if (!cols.length) return;
      for (var i = 0; i < rows.length; i++) {
        for (var k = 0; k < cols.length; k++) {
          var cell = rows[i].cells[cols[k]];
          if (cell) cell.classList.add('cell-wrap');
        }
      }
    });
  }

  // Thin progress bar while the next page loads; most pages run heavy Mongo queries.
  function initProgress() {
    var bar = document.querySelector('.app-progress');
    if (!bar) return;
    var start = function () { bar.classList.remove('is-done'); bar.classList.add('is-loading'); };

    $(document).on('submit', 'form', function (e) {
      if (e.isDefaultPrevented() || this.target === '_blank') return;
      start();
    });
    $(document).on('click', 'a[href]', function (e) {
      var a = this;
      if (e.isDefaultPrevented() || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      if (a.origin !== window.location.origin || a.getAttribute('href').charAt(0) === '#') return;
      if (a.pathname === window.location.pathname && a.search === window.location.search && a.hash) return;
      start();
    });
    // Back/forward cache restores the page with the bar still running.
    window.addEventListener('pageshow', function () { bar.classList.remove('is-loading'); });
  }

  function initDatePickers() {
    if ($.fn.datetimepicker) {
      $('.datetimepicker').datetimepicker({
        allowInputToggle: true, format: 'YYYY/MM/DD', inline: false, sideBySide: true, keepOpen: false
      });
      $('.datetimepicker2').datetimepicker({
        allowInputToggle: true, format: 'YYYY-MM-DD', inline: false, sideBySide: true, keepOpen: false
      });
    }
    if ($.fn.datepicker) {
      $('.datepickermy').datepicker({
        language: 'th-th', format: 'mm-yyyy', viewMode: 'months', minViewMode: 'months',
        orientation: 'bottom', autoclose: true
      });
    }
  }

  // Runs after the inline page scripts, so the Vue page (Page.mount) is already rendered.
  $(function () {
    initSidebar();
    initNavSearch();
    initTableFilters();
    markLongCells();
    initProgress();
    initDatePickers();
  });
})(jQuery);
