// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board is the watchlist (the floor), the early radar below it, and the live market beside it:
// every watchlist slug, every pre-token protocol below the watchlist floor that passes the
// watchlist's own exclusion rule (no bridge, no liquid staking, no CEX, no versioned pool, no
// wrapped or staked product, no exchange-prefixed name), and the 24 live-token protocols with the
// largest market caps, ranked in the same board by that market cap so the model's numbers can be
// checked against real market values.
//
// Implied value follows only from the snapshot's own figures. For a pre-token protocol:
//
//   ratio       = the median market-cap-to-TVL ratio of the live-token protocols in its category
//                 (at least 4 of them; otherwise the median over all live-token protocols)
//   growth      = clamp(change_7d, -80, 200) per cent
//   growthMult  = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity    = 0.7 + min(age_days, 1095) / 1095 x 0.5   (age_days unknown: 365)
//   breadth     = 1 + 0.04 x min(chains - 1, 5)
//   implied     = max(1, round(tvl_usd x ratio x growthMult x maturity x breadth))
//
// A live-token protocol's implied value is its market cap: a fact, not a model. No protocol name
// is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  ratio_floor: number;
  ratio_cap: number;
  ratio_min_sample: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  ratio_floor: 0.02,
  ratio_cap: 2.5,
  ratio_min_sample: 4,
  growth_weight: 0.5,
  growth_floor: -80,
  growth_cap: 200,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max_extra: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the board ranks beside the pre-token rows, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token' | 'live';
  value_source: 'model' | 'market-cap';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    ratio: number | null;
    ratio_sample: number | null;
    growth_pct: number | null;
    growth_multiplier: number | null;
    maturity_multiplier: number | null;
    chain_multiplier: number | null;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  radar_rank: number | null;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  token_status: 'pre-token' | 'live';
  value_source: 'model' | 'market-cap';
  ratio: number | null;
  ratio_sample: number | null;
  growth_multiplier: number | null;
  maturity_multiplier: number | null;
  chain_multiplier: number | null;
}

/** One category's market multiple, as the dashboard's model panel shows it. */
export interface CategoryRatio {
  category: string;
  ratio: number;
  sample: number;
}

/** Everything the dashboard needs: the board, the market multiples, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  pre_token_size: number;
  live_size: number;
  early_size: number;
  ratio_global: number;
  ratios: CategoryRatio[];
  rows: RadarRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a sorted list of numbers. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The market multiples the model calibrates from: per category where the sample is big enough. */
export interface MarketRatios {
  global: number;
  byCategory: Map<string, { ratio: number; sample: number }>;
}

export function marketRatios(snapshot: Snapshot, model: ModelConstants = MODEL): MarketRatios {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  all.sort((a, b) => a - b);
  // Rounded to four decimals here, so the dashboard's data.js carries the exact multiple the
  // model scores with: the page recomputes every row to the dollar.
  const global = round4(Math.min(model.ratio_cap, Math.max(model.ratio_floor, median(all))));
  const out = new Map<string, { ratio: number; sample: number }>();
  for (const [category, list] of byCategory) {
    if (list.length < model.ratio_min_sample) continue;
    list.sort((a, b) => a - b);
    out.set(category, {
      ratio: round4(Math.min(model.ratio_cap, Math.max(model.ratio_floor, median(list)))),
      sample: list.length,
    });
  }
  return { global, byCategory: out };
}

/** The multiple one protocol's category calibrates, or the global median when the sample is thin. */
export function categoryRatio(p: SnapshotProtocol, ratios: MarketRatios): { ratio: number; sample: number | null } {
  const hit = ratios.byCategory.get(p.category ?? 'Other');
  if (hit !== undefined) return { ratio: hit.ratio, sample: hit.sample };
  return { ratio: ratios.global, sample: null };
}

/** The multipliers and the implied value one pre-token protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  ratios: MarketRatios,
  model: ModelConstants = MODEL,
): { implied: number; ratio: number; ratioSample: number | null; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { ratio, sample } = categoryRatio(protocol, ratios);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const chainMult = 1 + model.chain_step * extraChains;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * ratio * growthMult * maturityMult * chainMult));
  return { implied, ratio, ratioSample: sample, growthPct, growthMult, maturityMult, chainMult, age };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the watchlist rule leaves out: a wrapped, staked or bridged product's own token. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** The exchange names the watchlist rule leaves out at the start of a name. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol passes the watchlist's own exclusion rule, as the early radar applies it. */
export function passesWatchlistRule(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name}'s lending market on ${chain} and leave the deposit earning interest.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Add $${capital} of USDC and the paired asset to ${name}'s largest pool on ${chain} and hold the liquidity position.`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} curated vault on ${chain} and hold the vault shares.`;
  if (c.includes('rwa')) return `Buy $${capital} of ${name}'s tokenised yield asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} of USDC into ${name}'s highest-yield strategy on ${chain} and keep the position open.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position on ${chain}.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} and place one market position from the farming wallet.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and put the bridged funds to work in its app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second qualifying action, so the farm shows more than one kind of activity. */
function secondAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $20 against the deposit and repay it the same week, so the wallet shows both sides of the market.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Swap $25 through ${name} on ${chain} once, from the same wallet, to register as an active trader.`;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Vote on one ${name} vault proposal, or move $25 between two of its vaults, from the same wallet.`;
  if (c.includes('rwa')) return `Reinvest the first yield payout from ${name} back into the same asset on ${chain}.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Claim the first yield from ${name} and redeposit it the same week, from the same wallet.`;
  if (c.includes('restak') || c.includes('staking')) return `Delegate a second, smaller stake through ${name} on ${chain} a week after the first.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Close the first hedge on ${name} and open a fresh one half its size, from the same wallet.`;
  if (c.includes('prediction')) return `Settle the first market position on ${name} and place a second one half its size.`;
  return `Use one more of ${name}'s features on ${chain} — a swap, a deposit or a vote — from the same wallet.`;
}

/**
 * A pre-token protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a hand-written
 * list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Create a fresh wallet just for farming ${p.name}, fund it with $${capital} of USDC on ${chain}, and keep its seed phrase offline.`,
      cost: 'about $3 of gas to fund it',
      time: '10 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, chain),
      cost: 'about $3 of gas',
      time: '10 minutes',
    },
    {
      text: `Repeat one qualifying action each week — a deposit, a swap, a borrow or a vote — from the same wallet, in small size.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days and check ${p.name}'s own points page once a week; claim only from the link that page publishes.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Log the wallet, the dates and every transaction hash; when you unwind, withdraw in two steps and confirm the funds land before closing the wallet.`,
      cost: 'nothing but the log',
      time: '5 minutes to log, 20 to unwind',
    },
  ];
}

/** A live-token protocol's plan: the token trades, so this is a use-and-yield plan, not a farm. */
export function liveSteps(p: SnapshotProtocol): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const mcap = p.mcap_usd === null ? 'an unreported market cap' : `$${(p.mcap_usd / 1_000_000).toFixed(0)}M market cap`;
  return [
    {
      text: `Token already trades: ${p.name} has a ${mcap}, so this is a plan to use the protocol and earn yield, not a pre-token farm.`,
      cost: 'nothing to read this plan',
      time: '2 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Use the position once a week and compare the yield it pays against the token's own price move, so you know what the return really is.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Set a rule before you start: exit if the position falls 20% below your entry, or if the protocol's TVL falls by half in a week.`,
      cost: 'nothing to set the rule',
      time: '5 minutes',
    },
    {
      text: `When you exit, unwind in two steps and confirm the funds land in your wallet before you close the position.`,
      cost: 'about $4 of gas to unwind',
      time: '20 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; earlySize: number; liveSize: number } {
  const index = bySlug(snapshot.protocols);
  const ratios = marketRatios(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, whatever its record says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor that pass the watchlist's own
  // exclusion rule. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols.filter(
    (p) => !chosen.has(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd && passesWatchlistRule(p),
  );
  for (const p of early) chosen.set(p.slug, p);
  // The live market beside the radar: the largest market caps, ranked by that market cap.
  const live = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && !isPreToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS);
  for (const p of live) chosen.set(p.slug, p);

  const scored: BoardRow[] = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (isPreToken(p)) {
      const v = impliedValue(p, snapshot.as_of, ratios, model);
      return {
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        mcap_usd: p.mcap_usd,
        listed_at: p.listed_at,
        gecko_id: p.gecko_id,
        symbol: p.symbol,
        token_status: 'pre-token',
        value_source: 'model',
        age_days: age,
        implied_value_usd: v.implied,
        model: {
          ratio: round4(v.ratio),
          ratio_sample: v.ratioSample,
          growth_pct: v.growthPct,
          growth_multiplier: round4(v.growthMult),
          maturity_multiplier: round4(v.maturityMult),
          chain_multiplier: round4(v.chainMult),
          age_days: age,
        },
        farm_steps: farmSteps(p, age).map(stepText),
      };
    }
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'live',
      value_source: 'market-cap',
      age_days: age,
      implied_value_usd: p.mcap_usd!,
      model: {
        ratio: null,
        ratio_sample: null,
        growth_pct: null,
        growth_multiplier: null,
        maturity_multiplier: null,
        chain_multiplier: null,
        age_days: age,
      },
      farm_steps: liveSteps(p).map(stepText),
    };
  });
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  scored.forEach((r, i) => {
    r.rank = i + 1;
  });
  return { board: scored, earlySize: early.length, liveSize: live.length };
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, radarRank: number | null): RadarRow {
  return {
    rank: row.rank,
    radar_rank: radarRank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    token_status: row.token_status,
    value_source: row.value_source,
    ratio: row.model.ratio,
    ratio_sample: row.model.ratio_sample,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, earlySize, liveSize } = buildBoard(snapshot, model);
  const ratios = marketRatios(snapshot, model);
  const preRows = board.filter((r) => r.token_status === 'pre-token');
  const radarRankOf = new Map(preRows.map((r, i) => [r.slug, i + 1]));
  const ratioList: CategoryRatio[] = [...ratios.byCategory.entries()]
    .map(([category, v]) => ({ category, ratio: round4(v.ratio), sample: v.sample }))
    .sort((a, b) => b.sample - a.sample || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    pre_token_size: preRows.length,
    live_size: liveSize,
    early_size: earlySize,
    ratio_global: round4(ratios.global),
    ratios: ratioList,
    rows: board.map((r) => radarRow(r, r.token_status === 'pre-token' ? radarRankOf.get(r.slug)! : null)),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
