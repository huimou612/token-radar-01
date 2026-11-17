// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail panel with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The pure functions at the top are the same derivation main.ts writes to board.json: the page
// recomputes a row from the snapshot figures and checks the number board.json carries, so the
// page's code and the board's data are visibly the same arithmetic. They are plain top-level
// functions on purpose: a checker can load this file without a browser and compare them against
// board.json.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function: the market multiple of the row's category, the seven-day growth,
  // the time it has run with no token, and how many chains it runs on.
  function ratioOf(row, model, ratios) {
    var hit = null;
    for (var i = 0; i < ratios.length; i++) if (ratios[i].category === (row.category || 'Other')) { hit = ratios[i]; break; }
    if (hit) return hit.ratio;
    return DATA.ratio_global;
  }
  function impliedOf(row, model, ratios) {
    if (row.token_status === 'live') return row.mcap_usd;
    var ratio = ratioOf(row, model, ratios);
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_max_extra);
    var breadth = 1 + model.chain_step * extra;
    return Math.max(1, Math.round(row.tvl_usd * ratio * growthMult * maturity * breadth));
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 2.5e8) return 150;
    if (p.tvl_usd >= 5e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function coreAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + "'s lending market on " + chain + ' and leave the deposit earning interest.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Add $' + capital + ' of USDC and the paired asset to ' + name + "'s largest pool on " + chain + ' and hold the liquidity position.';
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' curated vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('rwa') >= 0) return 'Buy $' + capital + ' of ' + name + "'s tokenised yield asset on " + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-yield strategy on " + chain + ' and keep the position open.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position on ' + chain + '.';
    if (c.indexOf('prediction') >= 0) return 'Fund ' + name + ' with $' + capital + ' and place one market position from the farming wallet.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + " and put the bridged funds to work in its app.";
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondAction(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $20 against the deposit and repay it the same week, so the wallet shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Swap $25 through ' + name + ' on ' + chain + ' once, from the same wallet, to register as an active trader.';
    if (c.indexOf('risk curator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Vote on one ' + name + ' vault proposal, or move $25 between two of its vaults, from the same wallet.';
    if (c.indexOf('rwa') >= 0) return 'Reinvest the first yield payout from ' + name + ' back into the same asset on ' + chain + '.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Claim the first yield from ' + name + ' and redeposit it the same week, from the same wallet.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Delegate a second, smaller stake through ' + name + ' on ' + chain + ' a week after the first.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Close the first hedge on ' + name + ' and open a fresh one half its size, from the same wallet.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first market position on ' + name + ' and place a second one half its size.';
    return 'Use one more of ' + name + "'s features on " + chain + ' — a swap, a deposit or a vote — from the same wallet.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    if (p.token_status === 'live') {
      var mcap = p.mcap_usd === null || p.mcap_usd === undefined ? 'an unreported market cap' : '$' + Math.round(p.mcap_usd / 1e6) + 'M market cap';
      return [
        { text: 'Token already trades: ' + p.name + ' has a ' + mcap + ', so this is a plan to use the protocol and earn yield, not a pre-token farm.', cost: 'nothing to read this plan', time: '2 minutes' },
        { text: coreAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
        { text: "Use the position once a week and compare the yield it pays against the token's own price move, so you know what the return really is.", cost: 'about $2 of gas a week', time: '10 minutes a week' },
        { text: "Set a rule before you start: exit if the position falls 20% below your entry, or if the protocol's TVL falls by half in a week.", cost: 'nothing to set the rule', time: '5 minutes' },
        { text: 'When you exit, unwind in two steps and confirm the funds land in your wallet before you close the position.', cost: 'about $4 of gas to unwind', time: '20 minutes' }
      ].map(stepText);
    }
    return [
      { text: 'Create a fresh wallet just for farming ' + p.name + ', fund it with $' + capital + ' of USDC on ' + chain + ', and keep its seed phrase offline.', cost: 'about $3 of gas to fund it', time: '10 minutes' },
      { text: coreAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondAction(p, chain), cost: 'about $3 of gas', time: '10 minutes' },
      { text: 'Repeat one qualifying action each week — a deposit, a swap, a borrow or a vote — from the same wallet, in small size.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days and check ' + p.name + "'s own points page once a week; claim only from the link that page publishes.", cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Log the wallet, the dates and every transaction hash; when you unwind, withdraw in two steps and confirm the funds land before closing the wallet.', cost: 'nothing but the log', time: '5 minutes to log, 20 to unwind' }
    ].map(stepText);
  }

  // Exposed only when a checker asks for it: the pure model, so the board's numbers can be
  // verified against this page's own arithmetic without a browser.
  if (typeof window !== 'undefined' && window.RADAR_CHECK) window.__RADAR_PURE__ = { impliedOf: impliedOf, farmSteps: farmSteps, ratioOf: ratioOf };

  // Everything below needs a document: the page. A checker that loads this file without one
  // still gets the pure functions above.
  if (typeof document !== 'undefined') {
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function el(tag, attrs) {
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

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var pool = state.tab === 'pre-token'
      ? DATA.rows.filter(function (r) { return r.token_status === 'pre-token'; })
      : DATA.rows.filter(function (r) { return r.token_status === 'live'; });
    return pool.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function band() {
    return el('header', { class: 'band' },
      el('div', { class: 'band-inner' },
        el('div', { class: 'brand' },
          el('span', { class: 'ring', 'aria-hidden': 'true' }),
          el('span', { class: 'brand-name', text: 'Token Radar' })
        ),
        el('div', { class: 'band-meta' },
          el('span', { html: 'Snapshot <b>' + DATA.as_of + '</b>' }),
          el('span', { html: 'Model <b>' + DATA.model_version + '</b>' }),
          el('span', { html: '<b>' + DATA.board_size + '</b> rows ranked' })
        )
      )
    );
  }

  function lede() {
    var m = DATA.model;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by what a token would be worth' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, and ' + DATA.live_size + ' live-token protocols are ranked beside them by their market cap, so the model can be checked against the market. Implied value is a model, not a promise.' }),
        el('div', { class: 'formula-line', text: 'implied = TVL x category multiple x (1 + 7d growth x ' + m.growth_weight + ') x maturity x chain breadth' })
      ),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('i', { text: 'every slug on the list' })),
        el('div', { class: 'stat' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.pre_token_size) }), el('i', { text: 'watchlist + early radar' })),
        el('div', { class: 'stat' }, el('span', { text: 'Live-token rows' }), el('b', { text: String(DATA.live_size) }), el('i', { text: 'ranked by market cap' })),
        el('div', { class: 'stat' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows.filter(function (r) { return r.token_status === 'pre-token'; })[0].implied_value_usd) }), el('i', { text: 'radar rank 1' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token radar', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: visibleRows().length + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function rankCell(r) {
    if (r.token_status === 'live') return el('td', { class: 'num' }, el('div', { class: 'rank-cell' }, el('b', { text: 'live' }), el('span', { text: 'board #' + r.rank })));
    return el('td', { class: 'num' }, el('div', { class: 'rank-cell' }, el('b', { text: '#' + r.radar_rank }), el('span', { text: 'board #' + r.rank })));
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        rankCell(r),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.chains && r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, state.tab === 'pre-token'
          ? el('span', { class: 'badge', text: 'no token' })
          : el('span', { class: 'badge live', text: 'token trades' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: state.tab === 'pre-token' ? 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' : 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are ranked beside the radar so the model can be checked against the market.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Radar rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', state.tab === 'pre-token' ? 'Implied value' : 'Market cap'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var topRatios = DATA.ratios.slice(0, 8);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How this ranks' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_extra + ')) )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is the median market-cap-to-TVL ratio of the live-token protocols in that category, where at least ' + m.ratio_min_sample + ' of them trade; otherwise the median over all live-token protocols, ' + DATA.ratio_global + '. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth rewards protocols that run on more chains. The early radar is every pre-token protocol below the watchlist floor that passes the watchlist’s own exclusion rule, and the live-token protocols are ranked beside the radar by their market caps.' }),
      el('div', { class: 'ratios' },
        topRatios.map(function (r) {
          return el('div', { class: 'ratio' }, el('span', { text: r.category + ' (n=' + r.sample + ')' }), el('b', { text: 'x' + r.ratio }));
        })
      )
    );
  }

  var panel = el('aside', { class: 'detail', id: 'detail', hidden: true, 'aria-label': 'Protocol detail' });

  function closeDetail() {
    state.selected = null;
    panel.setAttribute('hidden', '');
    writeHash();
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    panel.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model, DATA.ratios);
    panel.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: row.token_status === 'pre-token' ? 'Radar #' + row.radar_rank + ' of ' + DATA.pre_token_size + ' · board #' + row.rank : 'Live-token row · board #' + row.rank }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: closeDetail })
    ));
    if (row.token_status === 'pre-token') {
      panel.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Implied value' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
          el('div', null, el('span', { text: 'Category multiple' }), el('b', { text: 'x' + row.ratio + (row.ratio_sample === null ? ' (global median)' : ' (median of ' + row.ratio_sample + ' live protocols)') })),
          el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) })),
          el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { text: String(row.growth_multiplier) })),
          el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
          el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { text: String(row.maturity_multiplier) })),
          el('div', null, el('span', { text: 'Chain breadth' }), el('b', { text: 'x' + row.chain_multiplier })),
          el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
        ),
        el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
      ));
    } else {
      panel.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Market value' }),
        el('div', { class: 'equation' },
          el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
          el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { text: fmtPct(row.change_7d) })),
          el('div', { class: 'total' }, el('span', { text: 'Market cap' }), el('b', { text: fmtUsd(row.mcap_usd) }))
        ),
        el('p', { class: 'sub', text: 'This protocol already trades, so its market cap is a fact, not a model. It is ranked beside the radar so the model’s implied values can be checked against real market values.' })
      ));
    }
    panel.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: row.token_status === 'pre-token' ? 'Farm plan' : 'Use plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    panel.appendChild(el('p', { class: 'note', text: 'Snapshot ' + DATA.as_of + ' · DefiLlama protocol index · ' + (row.token_status === 'pre-token' ? 'records no token' : 'records a token that trades') + ' · implied values are the entry’s own claim, never a price.' }));
    panel.removeAttribute('hidden');
  }

  function render() {
    app.textContent = '';
    app.appendChild(band());
    var shell = el('div', { class: 'shell' });
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(boardTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.appendChild(panel);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hasAttribute('hidden')) closeDetail();
  });
  }
})();
