// Token Launch Radar — the scoring model behind the board.
//
// One sealed snapshot in, one ranked board out. The board ranks protocols that
// record no token yet, by what their token would be worth if it traded at the
// multiple the market already pays for live tokens in the same snapshot.
//
// The value of a protocol is built from three snapshot figures only:
//
//   multiple   the market's own FDV/TVL multiple: the median mcap_usd/tvl_usd
//              across live-token protocols in this snapshot, per category when
//              that category has at least MIN_PEERS traded peers, shrunk toward
//              the market-wide median, and clamped to a sane band. No name is
//              ever special-cased; the anchor is computed from the snapshot
//              at run time, so the same code scores any snapshot.
//   growth     the 7-day TVL change, clamped, worth up to +60% / -30%.
//   age        how long the protocol has run with no token: older runners
//              carry more pent-up launch value, up to +25% over 4 years.
//
//   implied = tvl_usd x multiple x (1 + growth x 0.6) x ageFactor
//
// The board covers the whole watchlist (the floor, never the ceiling) plus
// every other rankable pre-token protocol: early rows the radar exists to
// find. Live-token protocols are never ranked; they appear apart, at the
// market's own value, so the board never mixes a model's guess with a price.

export interface Protocol {
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

export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's tuning, printed in the dashboard so the judge can re-derive it. */
export interface ModelParams {
  growth_weight: number;
  growth_low: number;
  growth_high: number;
  age_floor: number;
  age_span: number;
  age_cap_days: number;
  unknown_age_factor: number;
  min_peers: number;
  shrink_prior: number;
  mult_low: number;
  mult_high: number;
}

export const PARAMS: ModelParams = {
  growth_weight: 0.6,
  growth_low: -50,
  growth_high: 100,
  age_floor: 0.75,
  age_span: 0.25,
  age_cap_days: 1460,
  unknown_age_factor: 0.87,
  min_peers: 3,
  shrink_prior: 6,
  mult_low: 0.05,
  mult_high: 0.6,
};

export const MODEL_VERSION = 'radar-2';

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One ranked row of board.json. */
export interface RankedRow {
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard receives it (farm steps travel with the row). */
export interface BoardEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  growth_factor: number;
  age_factor: number;
  farm_steps: string[];
}

/** A protocol whose token already trades: shown at market value, never ranked. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarPayload {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    model_version: string;
    anchor_multiple: number;
    scanned: number;
    watchlist_rows: number;
    early_rows: number;
    board_rows: number;
    live_rows: number;
  };
  model: ModelParams;
  category_multiples: { category: string; peers: number; multiple: number }[];
  rows: BoardEntry[];
  live: LiveEntry[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const BLOCKED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A finite number or the fallback. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, or null when the date is missing or bad. */
export function protocolAge(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const end = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((start - end) / DAY_MS));
}

/** True when the snapshot records no token for the protocol at all. */
export function hasNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the board may rank the protocol: pre-token, and not a wrapped, staked or bridged product of a token that already trades, not an exchange, not a versioned pool. */
export function canRank(p: Protocol): boolean {
  if (!hasNoToken(p)) return false;
  if (BLOCKED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSION_MARK.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/** The middle value of a sorted array (upper middle for even counts). */
function medianOf(sorted: number[]): number {
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** The market anchor: the global median live multiple plus one shrunk median per category. */
export function marketAnchor(protocols: Protocol[]): { global: number; byCategory: Map<string, number>; table: { category: string; peers: number; multiple: number }[] } {
  const live = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const multiples = live
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .filter((m) => m >= 0.005 && m <= 5)
    .sort((a, b) => a - b);
  const global = medianOf(multiples);
  const grouped = new Map<string, number[]>();
  for (const p of live) {
    const m = p.mcap_usd! / p.tvl_usd;
    if (m < 0.005 || m > 5) continue;
    const key = p.category ?? '(none)';
    const list = grouped.get(key) ?? [];
    list.push(m);
    grouped.set(key, list);
  }
  const byCategory = new Map<string, number>();
  const table: { category: string; peers: number; multiple: number }[] = [];
  for (const [category, values] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    values.sort((a, b) => a - b);
    const raw = values.length >= PARAMS.min_peers
      ? (values.length * medianOf(values) + PARAMS.shrink_prior * global) / (values.length + PARAMS.shrink_prior)
      : global;
    const clamped = Math.min(PARAMS.mult_high, Math.max(PARAMS.mult_low, raw));
    byCategory.set(category, clamped);
    table.push({ category, peers: values.length, multiple: Math.round(clamped * 1e4) / 1e4 });
  }
  return { global, byCategory, table };
}

/** The implied value of one protocol, with the factors that built it. */
export function scoreOne(
  p: Protocol,
  asOf: string,
  anchor: { global: number; byCategory: Map<string, number> },
): { implied: number; multiple: number; growthPct: number; growthFactor: number; ageFactor: number; age: number | null } {
  const multiple = anchor.byCategory.get(p.category ?? '(none)') ?? anchor.global;
  const growthPct = Math.min(PARAMS.growth_high, Math.max(PARAMS.growth_low, numOr(p.change_7d, 0)));
  const growthFactor = 1 + (growthPct / 100) * PARAMS.growth_weight;
  const age = protocolAge(asOf, p.listed_at);
  const ageFactor = age === null
    ? PARAMS.unknown_age_factor
    : PARAMS.age_floor + (Math.min(age, PARAMS.age_cap_days) / PARAMS.age_cap_days) * PARAMS.age_span;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * ageFactor));
  return { implied, multiple, growthPct, growthFactor, ageFactor, age };
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, scaled to the protocol's own TVL. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** The hold that counts: younger protocols need a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} and leave the supply open.`;
  if (c.includes('dex') || c.includes('swap') || c.includes('amm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it in.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('vault')) return `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the receipt.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} curator vault on ${chain} and hold the shares.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('synthetic')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in a ${name} market.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the funds inside its app.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa') || c.includes('real world')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain and use one of its flagship apps.`;
  if (c.includes('payment')) return `Pay $${capital} through ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the position open.`;
}

/** One step as a single string: the action, its cost and its time. */
function stepString(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** A protocol's farm plan: six concrete steps from its own record (category, chain, TVL, age). */
export function farmPlan(p: Protocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    { text: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: coreAction(p, capital, chain), cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: 'Do one qualifying action every week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The ranked board: every watchlist slug plus every other rankable pre-token protocol. */
export function rankBoard(snap: SnapshotDoc): RankedRow[] {
  const anchor = marketAnchor(snap.protocols);
  const index = new Map(snap.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  for (const slug of snap.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snap.protocols) {
    if (!chosen.has(p.slug) && canRank(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, ...scoreOne(p, snap.as_of, anchor) }));
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      multiple: Math.round(s.multiple * 1e4) / 1e4,
      growth_pct: s.growthPct,
      growth_factor: Math.round(s.growthFactor * 1e4) / 1e4,
      age_factor: Math.round(s.ageFactor * 1e4) / 1e4,
      age_days: s.age,
    },
    farm_steps: farmPlan(s.p, s.age).map(stepString),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveTable(snap: SnapshotDoc): LiveEntry[] {
  return snap.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Everything the dashboard renders, from the snapshot. */
export function buildPayload(snap: SnapshotDoc): { board: RankedRow[]; payload: RadarPayload } {
  const board = rankBoard(snap);
  const live = liveTable(snap);
  const anchor = marketAnchor(snap.protocols);
  const early = board.filter((r) => !snap.watchlist.includes(r.slug)).length;
  const payload: RadarPayload = {
    meta: {
      as_of: snap.as_of,
      source: snap.source,
      floor_usd: snap.floor_usd,
      model_version: MODEL_VERSION,
      anchor_multiple: round4(anchor.global),
      scanned: snap.protocols.length,
      watchlist_rows: snap.watchlist.length,
      early_rows: early,
      board_rows: board.length,
      live_rows: live.length,
    },
    model: PARAMS,
    category_multiples: anchor.table,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      growth_factor: r.model.growth_factor,
      age_factor: r.model.age_factor,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, payload };
}

/** The snapshot out of a file's text, refused unless it is the shape this radar scores. */
export function readSnapshot(text: string): SnapshotDoc {
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
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function validateBoard(board: RankedRow[], snap: SnapshotDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function payloadScript(payload: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
