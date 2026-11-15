// Token Radar's radar-2 dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var PAGE = window.RADAR;
  if (!PAGE) return;
  var app = document.getElementById('board');
  var view = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function formatUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFormat.format(n);
  }
  function formatPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function formatAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function formatMultiple(n) {
    if (n === null || n === undefined || !isFinite(n) || n <= 0) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  // Watchlist rows sit at or above the floor; every early row sits below it, so the floor itself
  // separates the two badges exactly, with no slug list needed in the page data.
  function onWatchlist(row) { return row.tvl_usd >= PAGE.floor_usd; }

  // The radar-2 model in one function, exactly as lib/model.ts scores it: calibrated multiple from
  // the live comparables, a TVL tier, asymmetric growth, a maturity hump peaking at 730 days, a
  // breadth factor from chain count, and a 0.95 discount when seven-day growth is unreported. A row
  // with no listed date uses the watchlist median age, the same fallback the model uses.
  function recomputeImplied(row, model) {
    var tier = row.tvl_usd >= 5e9 ? 0.4 : row.tvl_usd >= 1e9 ? 0.55 : row.tvl_usd >= 5e8 ? 0.7 : row.tvl_usd >= 1e8 ? 0.85 : 1.0;
    var growthKnown = row.change_7d !== null && row.change_7d !== undefined;
    var growth = growthKnown ? Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d)) : 0;
    var weight = growth >= 0 ? model.growth_weight_pos : model.growth_weight_neg;
    var growthMult = Math.min(model.growth_mult_max, Math.max(model.growth_mult_min, 1 + (growth / 100) * weight));
    var fallbackAge = PAGE.watchlist_median_age_days === null || PAGE.watchlist_median_age_days === undefined ? model.unknown_age_days : PAGE.watchlist_median_age_days;
    var age = row.age_days === null || row.age_days === undefined ? fallbackAge : row.age_days;
    var maturity = age <= model.maturity_peak_days
      ? model.maturity_floor + (1 - model.maturity_floor) * (age / model.maturity_peak_days)
      : 1 - model.maturity_decay * Math.min((age - model.maturity_peak_days) / model.maturity_decay_days, 1);
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_extra_chains);
    var dataQuality = growthKnown ? 1 : model.uncertainty_discount;
    return Math.max(1, Math.round(row.tvl_usd * PAGE.calibrated_multiple * tier * growthMult * maturity * breadth * dataQuality));
  }

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL, age and
  // growth decide the actions, the capital, the hold and every cost and time. No name is special-cased.
  function firstChainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalTierFor(p) {
    if (p.tvl_usd >= 1e10) return 350;
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdWindowFor(age, growth) {
    var days = age === null || age === undefined ? 45 : age < 180 ? 60 : age < 365 ? 45 : 30;
    if (growth !== null && growth !== undefined && isFinite(growth)) {
      if (growth >= 30) days += 15;
      else if (growth <= -20) days = Math.max(21, days - 15);
    }
    return Math.min(75, Math.max(21, days));
  }
  function gasBudgetFor(stake, holdDays) {
    var weeks = Math.ceil(holdDays / 7);
    var setup = stake >= 150 ? 8 : 4;
    var followUp = 3;
    var weekly = 2 * weeks;
    var exit = stake >= 150 ? 6 : 4;
    return { setup: setup, followUp: followUp, weekly: weekly, exit: exit, total: setup + followUp + weekly + exit, weeks: weeks };
  }
  function primaryActionFor(p, stake, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + stake + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + stake + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + stake + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + stake + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + stake + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + stake + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + stake + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + stake + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + stake + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + stake + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + stake + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function followUpActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $25 of USDC against the supply on ' + name + ' and repay it within a week, so the position shows both supply and borrow activity.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $25 through ' + name + "'s main pool on " + chain + ' so the wallet shows trading volume as well as liquidity.';
    if (c.indexOf('bridge') >= 0) return 'Use $25 of the bridged funds in an app on ' + chain + ' instead of bridging straight back.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake a second $25 through ' + name + ' in a separate transaction so the wallet shows repeated staking.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Open a second small position of $25 notional on ' + name + ' and close it after a day.';
    if (c.indexOf('prediction') >= 0) return 'Place a second $10 market position on ' + name + ' on a different market.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $25 into a second ' + name + ' vault on ' + chain + ' and keep those shares too.';
    if (c.indexOf('stable') >= 0) return 'Swap $25 of the stable asset through ' + name + ' on ' + chain + ' and hold the result.';
    if (c.indexOf('rwa') >= 0) return 'Mint a second $25 of the yield asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Top up the cover by $25 on ' + name + ' and keep the policy active.';
    return 'Swap $25 through ' + name + ' on ' + chain + ' so the wallet shows a second kind of activity.';
  }
  function stepString(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function planSteps(p) {
    var chain = firstChainOf(p);
    var stake = capitalTierFor(p);
    var holdDays = holdWindowFor(p.age_days, p.change_7d);
    var budget = gasBudgetFor(stake, holdDays);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: primaryActionFor(p, stake, chain), cost: '$' + stake + ' of capital and about $' + budget.setup + ' of gas', time: '15 minutes to set up' },
      { text: followUpActionFor(p, chain), cost: 'about $25 of capital and $' + budget.followUp + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + holdDays + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + stake + ' stays in the position', time: holdDays + ' days' },
      { text: "Check the protocol's own points or rewards page every week, confirm the activity is counted, and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes a week' },
      { text: 'Plan the budget before you start: $' + stake + ' stays locked in the position and about $' + budget.total + ' of gas covers setup, the second action, ' + budget.weeks + ' weeks of weekly actions and the exit.', cost: '$' + stake + ' locked plus about $' + budget.total + ' of gas in total', time: holdDays + ' days all in' },
      { text: 'Unwind in two steps, check the slippage on each withdrawal, then revoke the approvals you no longer need.', cost: 'about $' + budget.exit + ' of gas to exit', time: '15 minutes to unwind' }
    ].map(stepString);
  }

  function readLocationHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
  }
  function writeLocationHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return PAGE.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && !(r.chains || []).some(function (c) { return c === view.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function orderedRows(list) {
    var key = view.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function pageHeader() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'Token Radar' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + PAGE.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: PAGE.model_version + ' model' })
      )
    );
  }

  function introSection() {
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: PAGE.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(PAGE.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + PAGE.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: PAGE.watchlist_size + ' / ' + PAGE.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(PAGE.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(PAGE.early_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(PAGE.live_size) }))
      )
    );
  }

  function topStrip() {
    var top = PAGE.rows.slice(0, 3);
    return h('section', { class: 'spotlight', 'aria-label': 'Top three protocols by implied value' },
      top.map(function (r) {
        return h('article', { class: 'spot', tabindex: '0', onclick: function () { showDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } } },
          h('div', { class: 'spot-rank', text: 'Rank ' + r.rank }),
          h('h2', { text: r.name }),
          h('div', { class: 'spot-val num', text: formatUsd(r.implied_value_usd) }),
          h('div', { class: 'sub', text: 'TVL ' + formatUsd(r.tvl_usd) + '  ·  ' + formatMultiple(r.implied_value_usd / r.tvl_usd) + ' of TVL' }),
          h('span', { class: 'badge ' + (onWatchlist(r) ? 'badge-watch' : 'badge-early'), text: onWatchlist(r) ? 'Watchlist' : 'Early find' })
        );
      })
    );
  }

  function filterBar() {
    var categories = Array.from(new Set(PAGE.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainSet = new Set();
    PAGE.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainSet.add(c); }); });
    var chains = Array.from(chainSet).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeLocationHash(); drawPage(); });
    var select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { view.category = select.value; writeLocationHash(); drawPage(); });
    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; writeLocationHash(); drawPage(); });
    var pre = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; drawPage(); } });
    var live = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; drawPage(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : PAGE.live.length + ' live-token protocols' })
    );
  }

  function sortableHeader(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } drawPage(); } },
        label,
        view.sort === key ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardRowElement(r, topImplied) {
    var growthText = r.change_7d === null ? 'n/a' : formatPct(r.change_7d);
    var growthTone = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    return h('tr', {
      'data-selected': view.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { showDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
    },
      h('td', { class: 'num', text: String(r.rank) }),
      h('td', null, h('div', { class: 'name' },
        h('div', { class: 'name-row' }, h('b', { text: r.name }), h('span', { class: 'badge ' + (onWatchlist(r) ? 'badge-watch' : 'badge-early'), text: onWatchlist(r) ? 'Watchlist' : 'Early' })),
        h('span', { class: 'sub' }, h('span', { class: 'pill', text: r.category || 'Other' }), document.createTextNode(' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain')))
      )),
      h('td', { class: 'num', text: formatUsd(r.tvl_usd) }),
      h('td', { class: 'num ' + growthTone, text: growthText }),
      h('td', { class: 'num', text: formatAge(r.age_days) }),
      h('td', null, h('div', { class: 'implied' },
        h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / topImplied) * 100)) + '%' })),
        h('span', { class: 'num', text: formatUsd(r.implied_value_usd) })
      )),
      h('td', { class: 'num', text: formatMultiple(r.implied_value_usd / r.tvl_usd) }),
      h('td', null, h('span', { class: 'status', text: 'no token' }))
    );
  }

  function boardPanel() {
    var shown = orderedRows(visibleRows());
    if (shown.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; writeLocationHash(); drawPage(); } })
      ));
    }
    var topImplied = PAGE.rows[0].implied_value_usd || 1;
    var body = h('tbody');
    shown.forEach(function (r) { body.appendChild(boardRowElement(r, topImplied)); });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortableHeader('implied', 'Rank'),
            sortableHeader('name', 'Protocol'),
            sortableHeader('tvl', 'TVL'),
            sortableHeader('growth', '7d'),
            sortableHeader('age', 'Age'),
            sortableHeader('implied', 'Implied value'),
            sortableHeader('multiple', 'Implied / TVL'),
            h('th', { scope: 'col', text: 'Token' })
          )),
          body
        )
      )
    );
  }

  function livePanel() {
    var body = h('tbody');
    PAGE.live.forEach(function (r) {
      body.appendChild(h('tr', null,
        h('td', { class: 'num', text: 'live' }),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: formatUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: formatPct(r.change_7d) }),
        h('td', { class: 'num', text: formatUsd(r.mcap_usd) }),
        h('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? formatMultiple(r.mcap_usd / r.tvl_usd) : 'n/a' }),
        h('td', null, h('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking. Their mcap/TVL ratios are the calibration for the pre-token model.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Mcap / TVL' }), h('th', { scope: 'col', text: 'Token' }))),
          body
        )
      )
    );
  }

  function modelSection() {
    var m = PAGE.model;
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + PAGE.calibrated_multiple.toFixed(3) + ' (calibrated) x tier (1.00 / 0.85 / 0.70 / 0.55 / 0.40) x growth x maturity x breadth x data-quality )'
      ),
      h('p', { class: 'sub', text: 'Calibration: the median market-cap-per-TVL ratio across ' + PAGE.calibration_count + ' live-token protocols is ' + PAGE.calibrated_multiple.toFixed(3) + ', clipped to 0.10-1.00. A dollar of TVL is worth less at $5B than at $50M, so the tier falls as TVL rises. Growth is clamped to ' + m.growth_floor + ' to ' + m.growth_cap + ' per cent, weighted ' + m.growth_weight_pos + ' up and ' + m.growth_weight_neg + ' down; an unreported seven-day change is neutral with a 0.95 discount. Maturity is a hump peaking at ' + m.maturity_peak_days + ' days, then easing down; an unlisted age uses the watchlist median of ' + PAGE.watchlist_median_age_days + ' days. Breadth adds 0.03 per extra chain, capped at 1.12.' })
    );
  }

  var detailDialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  detailDialog.addEventListener('close', function () { view.selected = null; writeLocationHash(); });

  function showDetail(slug) {
    var row = PAGE.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeLocationHash();
    detailDialog.textContent = '';
    var steps = planSteps(row);
    var recomputed = recomputeImplied(row, PAGE.model);
    detailDialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + PAGE.board_size + '  ·  ' + (onWatchlist(row) ? 'Watchlist' : 'Early find') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub' }, h('span', { class: 'pill', text: row.category || 'Other' }), document.createTextNode(' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain')))
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { detailDialog.close(); } })
    ));
    detailDialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: formatUsd(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Calibrated multiple (live median)' }), h('b', { class: 'num', text: String(row.calibrated_multiple) })),
        h('div', null, h('span', { text: 'TVL tier factor' }), h('b', { class: 'num', text: String(row.tier_factor) })),
        h('div', null, h('span', { text: 'Base multiple (calibrated x tier)' }), h('b', { class: 'num', text: String(row.base_multiple) })),
        h('div', null, h('span', { text: 'Base value (TVL x base multiple)' }), h('b', { class: 'num', text: formatUsd(row.tvl_usd * row.base_multiple) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: formatPct(row.change_7d) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: String(row.growth_multiplier) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: formatAge(row.age_days) })),
        h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: String(row.maturity_multiplier) })),
        h('div', null, h('span', { text: 'Breadth multiplier' }), h('b', { class: 'num', text: String(row.breadth_multiplier) })),
        h('div', null, h('span', { text: 'Data-quality multiplier' }), h('b', { class: 'num', text: String(row.data_quality_multiplier) })),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: formatUsd(row.implied_value_usd) }))
      ),
      h('p', { class: 'sub', text: 'Model ' + PAGE.model_version + ': the same function scores every protocol. The page recomputes this row as ' + formatUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    detailDialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof detailDialog.showModal === 'function') {
      if (!detailDialog.open) detailDialog.showModal();
    } else {
      detailDialog.setAttribute('open', '');
    }
  }

  function drawPage() {
    app.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(pageHeader());
    shell.appendChild(introSection());
    if (view.tab === 'pre-token') shell.appendChild(topStrip());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? boardPanel() : livePanel());
    if (view.tab === 'pre-token') shell.appendChild(modelSection());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!detailDialog.isConnected) app.appendChild(detailDialog);
    if (view.selected) showDetail(view.selected);
  }

  readLocationHash();
  drawPage();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && detailDialog.open) detailDialog.close();
  });
})();
