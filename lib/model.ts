// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value follows only from the snapshot's own figures, and every multiplier is exposed per row:
//
//   calibrated  = median(mcap_usd / tvl_usd) over live-token protocols, clipped to [0.10, 1.00]
//   tier        = 1.00 below $100M TVL, 0.85 to $500M, 0.70 to $1B, 0.55 to $5B, 0.40 above $5B
//   base        = tvl_usd x calibrated x tier
//   growth      = clamp(change_7d, -80, 200) per cent; null change_7d is neutral, with a 0.95 discount
//   growthMult  = 1 + growth/100 x 0.70 when growth >= 0, 1 + growth/100 x 1.20 when growth < 0,
//                 clamped to [0.20, 2.50]
//   maturity    = 0.60 + 0.40 x age/730 up to 730 days, then 1.00 - 0.15 x min((age-730)/1095, 1)
//                 (a hump peaking at ~2 years; age unknown uses the watchlist median age)
//   breadth     = 1 + 0.03 x min(chains-1, 4)
//   implied     = max(1, round(base x growthMult x maturity x breadth x dataQuality))
//
// The calibration is the snapshot's own comparables, not a guessed multiple: live tokens say what the
// market pays per dollar of TVL. The TVL tier says a dollar of TVL is worth less at $5B than at $50M.
// No protocol name is ever special-cased: the same function scores every row.

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

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight_pos: number;
  growth_weight_neg: number;
  growth_floor: number;
  growth_cap: number;
  growth_mult_min: number;
  growth_mult_max: number;
  maturity_floor: number;
  maturity_peak_days: number;
  maturity_decay: number;
  maturity_decay_days: number;
  maturity_days: number;
  unknown_age_days: number;
  calibration_floor: number;
  calibration_cap: number;
  uncertainty_discount: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight_pos: 0.7,
  growth_weight_neg: 1.2,
  growth_floor: -80,
  growth_cap: 200,
  growth_mult_min: 0.2,
  growth_mult_max: 2.5,
  maturity_floor: 0.6,
  maturity_peak_days: 730,
  maturity_decay: 0.15,
  maturity_decay_days: 1095,
  maturity_days: 1095,
  unknown_age_days: 365,
  calibration_floor: 0.1,
  calibration_cap: 1.0,
  uncertainty_discount: 0.95,
  breadth_per_chain: 0.03,
  breadth_max_extra_chains: 4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 260;

/** How many live-token protocols the Live token view carries, by market cap. */
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    calibrated_multiple: number;
    tier_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    data_quality_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
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
  base_multiple: number;
  calibrated_multiple: number;
  tier_factor: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  data_quality_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibrated_multiple: number;
  calibration_count: number;
  watchlist_median_age_days: number | null;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const roundTo4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallbackValue`. */
function finiteOr(candidate: unknown, fallbackValue: number): number {
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallbackValue;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((asOfMs - listedMs) / DAY_MS));
}

/** The median of a non-empty list of numbers, or null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle]!;
  return (ordered[middle - 1]! + ordered[middle]!) / 2;
}

/**
 * The calibration: the median market-cap-per-TVL ratio over every live-token protocol in the
 * snapshot (market cap recorded, TVL above zero, not a CEX), clipped to the model's band.
 * Returns the clipped multiple, the raw median, and how many live protocols supplied it.
 */
export function calibrateMultiple(snapshot: Snapshot, model: ModelConstants = MODEL): { calibrated: number; median_ratio: number | null; count: number } {
  const liveRatios = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX')
    .map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const middleRatio = median(liveRatios);
  const clipped = middleRatio === null ? model.base_multiple : Math.min(model.calibration_cap, Math.max(model.calibration_floor, middleRatio));
  return { calibrated: clipped, median_ratio: middleRatio, count: liveRatios.length };
}

/** The median age, in days, of the watchlist protocols that carry a listed_at date. */
export function watchlistMedianAge(snapshot: Snapshot): number | null {
  const lookup = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const listedAges: number[] = [];
  for (const slug of snapshot.watchlist) {
    const entry = lookup.get(slug);
    if (entry === undefined) continue;
    const entryAge = ageDays(snapshot.as_of, entry.listed_at);
    if (entryAge !== null) listedAges.push(entryAge);
  }
  const middleAge = median(listedAges);
  return middleAge === null ? null : Math.round(middleAge);
}

/** The TVL tier factor: a dollar of TVL is worth less at $5B than at $50M. */
export function tierFactor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 0.4;
  if (tvl >= 1_000_000_000) return 0.55;
  if (tvl >= 500_000_000) return 0.7;
  if (tvl >= 100_000_000) return 0.85;
  return 1.0;
}

/** The maturity hump: rises from the floor to 1.00 at the peak age, then decays gently. */
export function maturityMultiplier(ageInDays: number, constants: ModelConstants): number {
  if (ageInDays <= constants.maturity_peak_days) {
    return constants.maturity_floor + (1 - constants.maturity_floor) * (ageInDays / constants.maturity_peak_days);
  }
  const overPeak = Math.min((ageInDays - constants.maturity_peak_days) / constants.maturity_decay_days, 1);
  return 1 - constants.maturity_decay * overPeak;
}

/** The multipliers and the implied value one protocol gets under `constants` and `calibratedMultiple`. */
export function impliedValue(
  entry: SnapshotProtocol,
  snapshotDate: string,
  constants: ModelConstants,
  calibratedMultiple: number,
): {
  implied: number;
  baseMultiple: number;
  tierFactor: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  dataQualityMult: number;
  age: number | null;
} {
  const entryAge = ageDays(snapshotDate, entry.listed_at);
  const hasGrowth = entry.change_7d !== null && Number.isFinite(entry.change_7d);
  const reportedGrowth = hasGrowth ? (entry.change_7d as number) : 0;
  const clampedGrowth = Math.min(constants.growth_cap, Math.max(constants.growth_floor, reportedGrowth));
  const growthWeight = clampedGrowth >= 0 ? constants.growth_weight_pos : constants.growth_weight_neg;
  const growthFactor = Math.min(constants.growth_mult_max, Math.max(constants.growth_mult_min, 1 + (clampedGrowth / 100) * growthWeight));
  const modelAge = entryAge ?? constants.unknown_age_days;
  const maturityFactor = maturityMultiplier(Math.max(0, modelAge), constants);
  const extraChainCount = Math.min(Math.max(entry.chains.length - 1, 0), constants.breadth_max_extra_chains);
  const breadthFactor = 1 + constants.breadth_per_chain * extraChainCount;
  const qualityFactor = hasGrowth ? 1 : constants.uncertainty_discount;
  const tierValue = tierFactor(entry.tvl_usd);
  const effectiveMultiple = calibratedMultiple * tierValue;
  const baseValue = entry.tvl_usd * effectiveMultiple;
  const value = Math.max(1, Math.round(baseValue * growthFactor * maturityFactor * breadthFactor * qualityFactor));
  return { implied: value, baseMultiple: effectiveMultiple, tierFactor: tierValue, growthPct: clampedGrowth, growthMult: growthFactor, maturityMult: maturityFactor, breadthMult: breadthFactor, dataQualityMult: qualityFactor, age: entryAge };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function indexProtocolsBySlug(entries: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(entries.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const lookup = indexProtocolsBySlug(snapshot.protocols);
  const { calibrated: calibratedMultiple } = calibrateMultiple(snapshot, model);
  const watchlistAge = watchlistMedianAge(snapshot);
  const scoringModel: ModelConstants = { ...model, unknown_age_days: watchlistAge ?? model.unknown_age_days };
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const entry = lookup.get(slug);
    if (entry !== undefined) picked.set(slug, entry);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a picked protocol stays picked.
  const earlyPool = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const entry of earlyPool) picked.set(entry.slug, entry);

  const scoredRows = [...picked.values()].map((entry) => {
    const valuation = impliedValue(entry, snapshot.as_of, scoringModel, calibratedMultiple);
    return { entry, ...valuation };
  });
  scoredRows.sort((a, b) => b.implied - a.implied || (a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0));
  return scoredRows.map((scored, i) => ({
    rank: i + 1,
    slug: scored.entry.slug,
    name: scored.entry.name,
    category: scored.entry.category,
    chains: scored.entry.chains,
    tvl_usd: scored.entry.tvl_usd,
    change_7d: scored.entry.change_7d,
    mcap_usd: scored.entry.mcap_usd,
    listed_at: scored.entry.listed_at,
    gecko_id: scored.entry.gecko_id,
    symbol: scored.entry.symbol,
    token_status: 'pre-token',
    age_days: scored.age,
    implied_value_usd: scored.implied,
    model: {
      base_multiple: roundTo4(scored.baseMultiple),
      calibrated_multiple: roundTo4(calibratedMultiple),
      tier_factor: scored.tierFactor,
      growth_pct: scored.growthPct,
      growth_multiplier: roundTo4(scored.growthMult),
      maturity_multiplier: roundTo4(scored.maturityMult),
      breadth_multiplier: roundTo4(scored.breadthMult),
      data_quality_multiplier: scored.dataQualityMult,
      age_days: scored.age,
    },
    farm_steps: farmSteps(scored.entry, scored.age, scored.entry.change_7d).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(planStep: FarmStep): string {
  let rendered = `${planStep.text} Cost: ${planStep.cost}. Time: ${planStep.time}.`;
  if (rendered.length > 600) rendered = `${rendered.slice(0, 596)}...`;
  if (rendered.length < 20) rendered = `${rendered} Hold the position and check the protocol's own page.`;
  return rendered;
}

/** The first chain a protocol names, or a neutral phrase. */
function firstChainOf(entry: SnapshotProtocol): string {
  return entry.chains.length > 0 ? entry.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalTierFor(entry: SnapshotProtocol): number {
  if (entry.tvl_usd >= 10_000_000_000) return 350;
  if (entry.tvl_usd >= 5_000_000_000) return 250;
  if (entry.tvl_usd >= 1_000_000_000) return 150;
  if (entry.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age and growth: young and fast-growing hold longest. */
function holdWindowFor(entryAge: number | null, growth: number | null): number {
  let days = entryAge === null ? 45 : entryAge < 180 ? 60 : entryAge < 365 ? 45 : 30;
  if (growth !== null && Number.isFinite(growth)) {
    if (growth >= 30) days += 15;
    else if (growth <= -20) days = Math.max(21, days - 15);
  }
  return Math.min(75, Math.max(21, days));
}

/** The gas budget for one farm: setup, second action, weekly actions and the exit, in dollars. */
function gasBudgetFor(stake: number, holdDays: number): { setup: number; followUp: number; weekly: number; exit: number; total: number; weeks: number } {
  const weeks = Math.ceil(holdDays / 7);
  const setup = stake >= 150 ? 8 : 4;
  const followUp = 3;
  const weekly = 2 * weeks;
  const exit = stake >= 150 ? 6 : 4;
  return { setup, followUp, weekly, exit, total: setup + followUp + weekly + exit, weeks };
}

/** The category's one action, in the words a farmer can follow. */
function primaryActionFor(entry: SnapshotProtocol, stake: number, mainChain: string): string {
  const c = (entry.category ?? '').toLowerCase();
  const name = entry.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${stake} of USDC to ${name} on ${mainChain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${stake} of liquidity to ${name}'s main pool on ${mainChain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${stake} of USDC to ${mainChain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${stake} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${stake} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${stake} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${stake} into a ${name} vault on ${mainChain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${stake} of the stable asset through ${name} on ${mainChain}.`;
  if (c.includes('rwa')) return `Mint $${stake} of the protocol's yield asset on ${mainChain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${stake} of cover from ${name} on ${mainChain} and keep the policy.`;
  return `Deposit $${stake} of USDC into ${name} on ${mainChain} and keep the position open.`;
}

/** The category's second qualifying action: a different kind of activity from the first. */
function followUpActionFor(entry: SnapshotProtocol, mainChain: string): string {
  const c = (entry.category ?? '').toLowerCase();
  const name = entry.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $25 of USDC against the supply on ${name} and repay it within a week, so the position shows both supply and borrow activity.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $25 through ${name}'s main pool on ${mainChain} so the wallet shows trading volume as well as liquidity.`;
  if (c.includes('bridge')) return `Use $25 of the bridged funds in an app on ${mainChain} instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake a second $25 through ${name} in a separate transaction so the wallet shows repeated staking.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open a second small position of $25 notional on ${name} and close it after a day.`;
  if (c.includes('prediction')) return `Place a second $10 market position on ${name} on a different market.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $25 into a second ${name} vault on ${mainChain} and keep those shares too.`;
  if (c.includes('stable')) return `Swap $25 of the stable asset through ${name} on ${mainChain} and hold the result.`;
  if (c.includes('rwa')) return `Mint a second $25 of the yield asset on ${mainChain} and hold it.`;
  if (c.includes('insurance')) return `Top up the cover by $25 on ${name} and keep the policy active.`;
  return `Swap $25 through ${name} on ${mainChain} so the wallet shows a second kind of activity.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age, growth), never from a hand-written list of names.
 */
export function farmSteps(entry: SnapshotProtocol, entryAge: number | null, growth: number | null = null): FarmStep[] {
  const mainChain = firstChainOf(entry);
  const stake = capitalTierFor(entry);
  const holdDays = holdWindowFor(entryAge, growth);
  const budget = gasBudgetFor(stake, holdDays);
  const primary = primaryActionFor(entry, stake, mainChain);
  const followUp = followUpActionFor(entry, mainChain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: primary,
      cost: `$${stake} of capital and about $${budget.setup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: followUp,
      cost: `about $25 of capital and $${budget.followUp} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${holdDays} days so the activity is counted in more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      time: `${holdDays} days`,
    },
    {
      text: `Check the protocol's own points or rewards page every week, confirm the activity is counted, and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a week',
    },
    {
      text: `Plan the budget before you start: $${stake} stays locked in the position and about $${budget.total} of gas covers setup, the second action, ${budget.weeks} weeks of weekly actions and the exit.`,
      cost: `$${stake} locked plus about $${budget.total} of gas in total`,
      time: `${holdDays} days all in`,
    },
    {
      text: `Unwind in two steps, check the slippage on each withdrawal, then revoke the approvals you no longer need.`,
      cost: `about $${budget.exit} of gas to exit`,
      time: '15 minutes to unwind',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(boardRow: BoardRow): RadarRow {
  return {
    rank: boardRow.rank,
    slug: boardRow.slug,
    name: boardRow.name,
    category: boardRow.category,
    chains: boardRow.chains,
    tvl_usd: boardRow.tvl_usd,
    change_7d: boardRow.change_7d,
    mcap_usd: boardRow.mcap_usd,
    listed_at: boardRow.listed_at,
    age_days: boardRow.age_days,
    implied_value_usd: boardRow.implied_value_usd,
    base_multiple: boardRow.model.base_multiple,
    calibrated_multiple: boardRow.model.calibrated_multiple,
    tier_factor: boardRow.model.tier_factor,
    growth_multiplier: boardRow.model.growth_multiplier,
    maturity_multiplier: boardRow.model.maturity_multiplier,
    breadth_multiplier: boardRow.model.breadth_multiplier,
    data_quality_multiplier: boardRow.model.data_quality_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const ranked = buildBoard(snapshot, model);
  const liveSet = liveRows(snapshot);
  const { calibrated: calibratedMultiple, count: liveCount } = calibrateMultiple(snapshot, model);
  const watchlistAge = watchlistMedianAge(snapshot);
  const earlyCount = ranked.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibrated_multiple: calibratedMultiple,
    calibration_count: liveCount,
    watchlist_median_age_days: watchlistAge,
    watchlist_size: snapshot.watchlist.length,
    board_size: ranked.length,
    early_size: earlyCount,
    live_size: liveSet.length,
    rows: ranked.map(radarRow),
    live: liveSet,
  };
  return { board: ranked, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(sourceText: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceText);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SnapshotError('snapshot.json is not a JSON object');
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const entries = doc.protocols.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new SnapshotError(`snapshot.json's protocol ${idx} is not an object`);
    const record = item as Record<string, unknown>;
    if (typeof record.slug !== 'string' || typeof record.name !== 'string' || typeof record.tvl_usd !== 'number' || !Number.isFinite(record.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${idx} lacks a slug, a name or a TVL`);
    }
    return {
      slug: record.slug,
      name: record.name,
      category: typeof record.category === 'string' ? record.category : null,
      chains: Array.isArray(record.chains) ? record.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: record.tvl_usd,
      change_7d: typeof record.change_7d === 'number' && Number.isFinite(record.change_7d) ? record.change_7d : null,
      mcap_usd: typeof record.mcap_usd === 'number' && Number.isFinite(record.mcap_usd) ? record.mcap_usd : null,
      listed_at: typeof record.listed_at === 'string' ? record.listed_at : null,
      gecko_id: typeof record.gecko_id === 'string' ? record.gecko_id : null,
      symbol: typeof record.symbol === 'string' ? record.symbol : null,
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols: entries,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(ranked: BoardRow[], sealed: Snapshot): string | null {
  const boardSlugs = new Set(ranked.map((r) => r.slug));
  const absent = sealed.watchlist.filter((s) => !boardSlugs.has(s));
  if (absent.length > 0) return `the board misses ${absent.length} watchlist slug${absent.length === 1 ? '' : 's'}: ${absent.slice(0, 5).join(', ')}`;
  const rankList = ranked.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < rankList.length; i++) if (rankList[i] !== i + 1) return `rank ${i + 1} is ${rankList[i]}`;
  for (let i = 1; i < ranked.length; i++) if (ranked[i]!.implied_value_usd > ranked[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (ranked.length >= 2 && ranked[0]!.implied_value_usd === ranked[ranked.length - 1]!.implied_value_usd) {
    return `all ${ranked.length} rows share the same implied value $${ranked[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const entry of ranked) {
    const plan = entry.farm_steps;
    if (plan.length < 3 || plan.length > 12) return `${entry.slug} has ${plan.length} farm steps`;
    for (const line of plan) if (line.length < 20 || line.length > 600) return `${entry.slug} has a farm step of ${line.length} characters`;
    if (!Number.isSafeInteger(entry.implied_value_usd) || entry.implied_value_usd <= 0) return `${entry.slug} has implied value ${entry.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(payload: RadarData): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
