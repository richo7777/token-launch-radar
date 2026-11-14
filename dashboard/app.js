// Token Launch Radar — the page. Reads window.RADAR (written by main.ts from
// the sealed snapshot), renders the board, the live set, and one protocol's
// detail at a time. No fetch, no network: every number on the page comes from
// the dataset this entry built, and the page works from a plain file open.
//
// Deep links for the screenshots and for sharing a view:
//   #detail=<slug>   open one protocol's detail on load
//   #cat=<category>  filter the board to one category
//   #q=<text>        filter the board by name or slug
//   #view=live       open the live-tokens view

(function () {
  'use strict';

  var DATA = window.RADAR || { meta: {}, model: {}, category_multiples: [], rows: [], live: [] };
  var ROWS = DATA.rows || [];
  var LIVE = DATA.live || [];
  var META = DATA.meta || {};
  var PAGE_SIZE = 25;

  var state = { view: 'board', query: '', category: 'all', sort: 'rank', page: 1, detail: null };

  function $(id) { return document.getElementById(id); }

  /** $2,753,981,495 -> $2.75B; $512,720,81 -> $512.7M; $48,200 -> $48.2K. */
  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function fmtMoney(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** The rows after the search, category and sort the reader picked. */
  function visibleRows() {
    var q = state.query.trim().toLowerCase();
    var list = ROWS.filter(function (r) {
      if (state.category !== 'all' && (r.category || '(none)') !== state.category) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var by = state.sort;
    list.sort(function (a, b) {
      if (by === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (by === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (by === 'age') return (b.age_days || 0) - (a.age_days || 0);
      return a.rank - b.rank;
    });
    return list;
  }

  function rowHtml(r) {
    var change = r.change_7d;
    var cls = change === null ? '' : change >= 0 ? 'up' : 'down';
    var badge = r.rank <= 3 ? 'rank-badge top' : 'rank-badge';
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="num"><span class="' + badge + '">' + r.rank + '</span></td>' +
      '<td><span class="proto-name">' + esc(r.name) + '</span><span class="proto-slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc((r.chains || []).slice(0, 1).join(', ') || '—') + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
      '<td class="num ' + cls + '">' + fmtPct(change) + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '<td class="num value">' + fmtUsd(r.implied_value_usd) + '</td>' +
      '</tr>';
  }

  function renderStats() {
    var cards = [
      [META.scanned, 'protocols scanned'],
      [META.watchlist_rows, 'on the watchlist'],
      [META.board_rows, 'ranked on the board'],
      [META.live_rows, 'live tokens set aside'],
    ];
    $('stats').innerHTML = cards.map(function (c) {
      return '<div class="stat"><b>' + (c[0] === undefined ? '—' : c[0]) + '</b><span>' + c[1] + '</span></div>';
    }).join('');
    var line = 'Snapshot: DefiLlama protocols, fetched ' + esc(META.as_of || '') +
      ' · floor $' + (META.floor_usd || 0).toLocaleString('en-US') + ' TVL · model ' + esc(META.model_version || '');
    $('snapshot-line').textContent = line;
  }

  function renderModel() {
    var anchor = META.anchor_multiple;
    var points = [
      'Anchor multiple <b>' + (anchor === undefined ? '—' : anchor.toFixed(3)) +
        '</b>: the median market-cap / TVL of the live-token protocols in this snapshot.',
      'Board <b>' + (META.board_rows || 0) + ' rows</b>: all ' + (META.watchlist_rows || 0) +
        ' watchlist protocols plus ' + (META.early_rows || 0) + ' early pre-token finds below the floor.',
      'Growth counts: 7-day TVL change clamped to ' + (DATA.model.growth_low || -50) + '%…+' +
        (DATA.model.growth_high || 100) + '%, worth up to ±' +
        Math.round((DATA.model.growth_weight || 0.6) * 100) + '% of value.',
      'Age counts: a protocol running ' + (DATA.model.age_cap_days || 1460) + ' days with no token earns the full age factor.',
    ];
    $('model-points').innerHTML = points.map(function (p) { return '<li>' + p + '</li>'; }).join('');
  }

  function renderCategories() {
    var counts = {};
    ROWS.forEach(function (r) {
      var c = r.category || '(none)';
      counts[c] = (counts[c] || 0) + 1;
    });
    var select = $('category');
    var current = state.category;
    select.innerHTML = '<option value="all">All categories</option>' +
      Object.keys(counts).sort().map(function (c) {
        return '<option value="' + esc(c) + '"' + (c === current ? ' selected' : '') + '>' +
          esc(c) + ' (' + counts[c] + ')</option>';
      }).join('');
  }

  function renderBoard() {
    var list = visibleRows();
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PAGE_SIZE;
    var slice = list.slice(start, start + PAGE_SIZE);
    $('board-body').innerHTML = slice.map(rowHtml).join('');
    $('empty-note').hidden = list.length !== 0;
    $('page-info').textContent = list.length === 0
      ? '0 rows'
      : 'Rows ' + (start + 1) + '–' + Math.min(start + PAGE_SIZE, list.length) + ' of ' + list.length + ' · page ' + state.page + ' of ' + pages;
    $('prev-page').disabled = state.page <= 1;
    $('next-page').disabled = state.page >= pages;
    document.querySelectorAll('#board-body tr').forEach(function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
      if (state.detail && tr.getAttribute('data-slug') === state.detail) tr.classList.add('selected');
    });
  }

  function renderLive() {
    $('live-body').innerHTML = LIVE.map(function (p) {
      var change = p.change_7d;
      var cls = change === null ? '' : change >= 0 ? 'up' : 'down';
      return '<tr><td><span class="proto-name">' + esc(p.name) + '</span><span class="proto-slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td>' + esc((p.chains || []).slice(0, 1).join(', ') || '—') + '</td>' +
        '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPct(change) + '</td></tr>';
    }).join('');
  }

  /** The arithmetic behind one row's implied value, shown step by step. */
  function renderDetail() {
    var card = $('detail-card');
    var row = null;
    ROWS.forEach(function (r) { if (r.slug === state.detail) row = r; });
    if (!row) { card.hidden = true; return; }
    card.hidden = false;
    $('detail-eyebrow').textContent = 'Rank ' + row.rank + ' of ' + ROWS.length + ' · ' + (row.category || 'No category');
    $('detail-name').textContent = row.name;
    $('detail-sub').textContent = row.slug + ' · ' + (row.chains || []).join(', ') +
      ' · tracked since ' + (row.listed_at || 'unknown date');
    var cells = [
      [fmtUsd(row.tvl_usd), 'TVL'],
      [fmtPct(row.change_7d), 'TVL, last 7 days'],
      [fmtAge(row.age_days), 'running with no token'],
      [fmtUsd(row.implied_value_usd), 'implied value'],
    ];
    $('detail-grid').innerHTML = cells.map(function (c) {
      return '<div class="detail-cell"><b>' + c[0] + '</b><span>' + c[1] + '</span></div>';
    }).join('');
    var base = row.tvl_usd * row.multiple;
    var lines = [
      ['TVL × market multiple (' + row.multiple.toFixed(3) + ' for ' + (row.category || 'its category') + ')', fmtMoney(base)],
      ['Growth factor — 7-day change ' + fmtPct(row.change_7d) + ' → ×' + row.growth_factor.toFixed(3), '×' + row.growth_factor.toFixed(3)],
      ['Age factor — ' + fmtAge(row.age_days) + ' with no token → ×' + row.age_factor.toFixed(3), '×' + row.age_factor.toFixed(3)],
      ['Implied value', fmtMoney(row.implied_value_usd)],
    ];
    $('breakdown-body').innerHTML = lines.map(function (l, i) {
      return '<tr' + (i === lines.length - 1 ? ' style="font-weight:700"' : '') + '><td>' + esc(l[0]) + '</td><td class="num">' + l[1] + '</td></tr>';
    }).join('');
    $('farm-steps').innerHTML = (row.farm_steps || []).map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('');
  }

  function renderTabs() {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-view') === state.view);
    });
    $('board-controls').style.display = state.view === 'board' ? '' : 'none';
    document.querySelector('.table-card').style.display = state.view === 'board' ? '' : 'none';
    $('live-card').hidden = state.view !== 'live';
    if (state.view === 'live') renderLive();
  }

  function openDetail(slug) {
    state.detail = slug;
    renderBoard();
    renderDetail();
    var card = $('detail-card');
    if (card && !card.hidden) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    syncHash();
  }

  function closeDetail() {
    state.detail = null;
    renderBoard();
    renderDetail();
    syncHash();
  }

  /** Keep the address bar honest so a view can be linked or screenshotted. */
  function syncHash() {
    var parts = [];
    if (state.view === 'live') parts.push('view=live');
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.query.trim()) parts.push('q=' + encodeURIComponent(state.query.trim()));
    if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
    var hash = parts.length ? '#' + parts.join('&') : '';
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    state.view = 'board';
    state.query = '';
    state.category = 'all';
    state.detail = null;
    state.page = 1;
    if (!raw) return;
    raw.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var key = kv[0];
      var val = kv[1] ? decodeURIComponent(kv[1]) : '';
      if (key === 'view' && (val === 'board' || val === 'live')) state.view = val;
      if (key === 'cat') state.category = val;
      if (key === 'q') { state.query = val; $('query').value = val; }
      if (key === 'detail') state.detail = val;
    });
    $('category').value = state.category;
    $('sort').value = state.sort;
  }

  function renderAll() {
    renderStats();
    renderModel();
    renderCategories();
    renderTabs();
    renderBoard();
    renderDetail();
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      state.view = t.getAttribute('data-view');
      state.page = 1;
      renderTabs();
      renderBoard();
      syncHash();
    });
  });
  $('query').addEventListener('input', function () {
    state.query = this.value;
    state.page = 1;
    renderBoard();
    syncHash();
  });
  $('category').addEventListener('change', function () {
    state.category = this.value;
    state.page = 1;
    renderBoard();
    syncHash();
  });
  $('sort').addEventListener('change', function () {
    state.sort = this.value;
    state.page = 1;
    renderBoard();
    syncHash();
  });
  $('prev-page').addEventListener('click', function () {
    if (state.page > 1) { state.page--; renderBoard(); }
  });
  $('next-page').addEventListener('click', function () {
    state.page++; renderBoard();
  });
  $('detail-close').addEventListener('click', closeDetail);
  window.addEventListener('hashchange', function () {
    readHash();
    renderTabs();
    renderBoard();
    renderDetail();
    scrollToDetail();
  });

  /** A load or a link that names a protocol lands on its detail card. */
  function scrollToDetail() {
    var card = $('detail-card');
    if (state.detail && card && !card.hidden) card.scrollIntoView();
  }

  readHash();
  renderAll();
  scrollToDetail();
})();
