import {
  StockInfo, BoardItem,
  PERankingResult, ROEResult, EPSResult, DebtResult, CashflowResult,
  RevenueResult, MarginResult, FCFResult, ValuationPercentileResult,
  CashRatioResult, GoodwillResult, LiquidityResult, PEGResult,
} from './types';
import { CashflowRow, GoodwillRow, ValuationRow } from './emfin';

const TOP_N = 5;
const ROE_YEARS = 5;
const ROE_THRESHOLD = 10;
const DEBT_WARN = 70;

// ── PE ranking ────────────────────────────────────

export function analyzePERanking(
  stockCode: string, boardName: string, stocks: BoardItem[],
): PERankingResult | { error: string } {
  const total = stocks.length;
  const hasPE = stocks.filter(s => s.pe != null && s.pe !== 0);
  const positive = hasPE.filter(s => s.pe! > 0).sort((a, b) => a.pe! - b.pe!);
  const negative = hasPE.filter(s => s.pe! < 0).sort((a, b) => b.pe! - a.pe!);

  const target = stocks.find(s => s.code === stockCode);
  if (!target) return { error: `未在 ${boardName} 板块中找到该股票` };

  const pe = target.pe;
  const pb = target.pb;
  let rank: number | null = null;
  let rankTotal = positive.length;

  if (pe != null && pe > 0) {
    rank = positive.filter(s => s.pe! <= pe).length;
  } else if (pe != null && pe < 0) {
    rank = -1;
    rankTotal = negative.length;
  }

  const pick = (arr: BoardItem[], n: number) => arr.slice(0, n);

  return {
    board_name: boardName,
    total,
    positive_count: positive.length,
    negative_count: negative.length,
    stock_pe: pe,
    stock_pb: pb,
    rank,
    rank_total: rankTotal,
    lowest: pick(positive, TOP_N).map(s => ({ code: s.code, name: s.name, pe: s.pe, pb: s.pb })),
    highest: pick(positive.slice().reverse(), TOP_N).reverse().map(s => ({
      code: s.code, name: s.name, pe: s.pe, pb: s.pb,
    })),
    negative_pe: pick(negative, TOP_N).map(s => ({ code: s.code, name: s.name, pe: s.pe, pb: s.pb })),
  };
}

// ── ROE ──────────────────────────────────────────

export function analyzeROE(data: [number, number | null][]): ROEResult | { error: string } {
  const sorted = [...data].sort((a, b) => a[0] - b[0]);
  const recent = sorted.slice(-ROE_YEARS);
  if (recent.length < ROE_YEARS) {
    return { error: `年报数据不足${ROE_YEARS}年（仅${recent.length}年）` };
  }

  const records: [number, number | null, boolean][] = [];
  let allPass = true;
  for (const [year, val] of recent) {
    const ok = val != null && val > ROE_THRESHOLD;
    if (!ok) allPass = false;
    records.push([year, val, ok]);
  }

  return { records, all_pass: allPass, threshold: ROE_THRESHOLD };
}

// ── EPS ──────────────────────────────────────────

export function analyzeEPSGrowth(data: [number, number | null][]): EPSResult | { error: string } {
  const sorted = [...data].sort((a, b) => a[0] - b[0]);
  const recent = sorted.slice(-(ROE_YEARS + 1));
  if (recent.length < ROE_YEARS + 1) {
    return { error: `数据不足${ROE_YEARS + 1}年（仅${recent.length}年），无法计算连续${ROE_YEARS}年增长` };
  }

  const records: [number, number | null, number | null, number | null, boolean][] = [];
  let allGrew = true;

  for (let i = 0; i < recent.length; i++) {
    const [year, val] = recent[i];
    if (i === 0) {
      records.push([year, val, null, null, true]);
    } else {
      const prev = recent[i - 1][1];
      let change: number | null = null;
      let changePct: number | null = null;
      let grew = true;

      if (val != null && prev != null) {
        change = val - prev;
        changePct = prev !== 0 ? (change / Math.abs(prev)) * 100 : 0;
        grew = change > 0;
      } else {
        allGrew = false;
      }
      if (!grew) allGrew = false;
      records.push([year, val, change, changePct, grew]);
    }
  }

  return { records, all_grew: allGrew };
}

// ── Debt ─────────────────────────────────────────

export function analyzeDebtRatio(data: [number, number | null][]): DebtResult | { error: string } {
  const sorted = [...data].sort((a, b) => a[0] - b[0]);
  const recent = sorted.slice(-ROE_YEARS);
  if (recent.length < ROE_YEARS) {
    return { error: `年报数据不足${ROE_YEARS}年（仅${recent.length}年）` };
  }

  const records: [number, number | null, boolean][] = [];
  let warned = false;
  for (const [year, val] of recent) {
    const over = val != null && val > DEBT_WARN;
    if (over) warned = true;
    records.push([year, val, over]);
  }

  return { records, warned };
}

// ── Cashflow ──────────────────────────────────────

export function analyzeCashflow(data: [number, number | null][]): CashflowResult | { error: string } {
  const sorted = [...data].sort((a, b) => a[0] - b[0]);
  const recent = sorted.slice(-ROE_YEARS);
  if (recent.length < ROE_YEARS) {
    return { error: `年报数据不足${ROE_YEARS}年（仅${recent.length}年）` };
  }

  const records: [number, number | null, boolean][] = [];
  let allPositive = true;
  for (const [year, val] of recent) {
    const ok = val != null && val > 0;
    if (!ok) allPositive = false;
    records.push([year, val, ok]);
  }

  return { records, all_positive: allPositive };
}

// ── Revenue growth ────────────────────────────────

/** 营收同比增长率分析：连续 5 年正增长 */
export function analyzeRevenueGrowth(data: [number, number | null][]): RevenueResult | { error: string } {
  const sorted = [...data].sort((a, b) => a[0] - b[0]);
  const recent = sorted.slice(-ROE_YEARS);
  if (recent.length < ROE_YEARS) {
    return { error: `年报数据不足${ROE_YEARS}年（仅${recent.length}年）` };
  }

  const records: [number, number | null, boolean][] = [];
  let allGrew = true;
  for (const [year, val] of recent) {
    const ok = val != null && val > 0;
    if (!ok) allGrew = false;
    records.push([year, val, ok]);
  }

  return { records, all_grew: allGrew };
}

// ── Margin (毛利率/净利率) ─────────────────────────

/** 东财口径毛利率/净利率分析（年报序列） */
export function analyzeMarginSeries(
  grossMargin: [number, number | null][],
  netMargin: [number, number | null][],
): MarginResult | { error: string } {
  const gmSorted = [...grossMargin].sort((a, b) => a[0] - b[0]);
  const nmSorted = [...netMargin].sort((a, b) => a[0] - b[0]);
  const gmRecent = gmSorted.slice(-5);
  const nmRecent = nmSorted.slice(-5);
  if (gmRecent.length < 3 && nmRecent.length < 3) {
    return { error: `年报数据不足（毛利率${gmRecent.length}年，净利率${nmRecent.length}年）` };
  }

  const yearSet = new Set<number>([...gmRecent.map(r => r[0]), ...nmRecent.map(r => r[0])]);
  const years = [...yearSet].sort();
  const records = years.map(y => ({
    reportDate: `${y}-12-31`,
    grossMargin: gmSorted.find(r => r[0] === y)?.[1] ?? null,
    netMargin: nmSorted.find(r => r[0] === y)?.[1] ?? null,
  }));

  const grossVals = records.map(r => r.grossMargin).filter((v): v is number => v != null);
  const netVals = records.map(r => r.netMargin).filter((v): v is number => v != null);

  let grossOk: boolean | null = null;
  let netOk: boolean | null = null;
  let note: string | null = null;

  if (grossVals.length >= 3) {
    const latest = grossVals[grossVals.length - 1];
    grossOk = grossVals.every(v => v > 0) && latest >= grossVals[0] * 0.6;
  }
  if (netVals.length >= 3) {
    netOk = netVals.every(v => v > 0);
  }
  if (grossOk === null && netOk === null) {
    note = '银行/保险等金融行业无毛利率概念，以净利率评估';
  }

  return { records, gross_ok: grossOk, net_ok: netOk, note };
}

// ── Free cash flow ────────────────────────────────

/** 自由现金流分析：连续 5 年年报 FCF > 0，且 FCF 不为负 */
export function analyzeFCF(rows: CashflowRow[]): FCFResult | { error: string } {
  const annual = rows.filter(r => r.reportDate.endsWith('-12-31')).slice(0, ROE_YEARS);
  if (annual.length < ROE_YEARS) {
    return { error: `年报数据不足${ROE_YEARS}年（仅${annual.length}年）` };
  }

  const records = annual.map(r => ({
    year: Number(r.reportDate.slice(0, 4)),
    operateCashflow: r.operateCashflow,
    capex: r.capex,
    freeCashflow: r.freeCashflow,
  }));

  let allPositive = true;
  for (const r of records) {
    if (r.freeCashflow == null || r.freeCashflow <= 0) allPositive = false;
  }

  return { records, all_positive: allPositive };
}

// ── Valuation percentile (历史估值百分位) ───────────

export function analyzeValuationPercentile(
  currentPE: number | null,
  history: (number | null)[],
): ValuationPercentileResult | { error: string } {
  if (currentPE == null || currentPE <= 0) {
    return { error: '当前市盈率为负或无数据，不适用估值百分位分析' };
  }
  const vals = history.filter((v): v is number => v != null && v > 0);
  if (vals.length < 100) {
    return { error: `历史估值数据不足（仅${vals.length}条）` };
  }
  const percentile = (vals.filter(v => v <= currentPE).length / vals.length) * 100;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const median = vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)];

  return {
    pe_ttm: currentPE,
    percentile: Math.round(percentile * 100) / 100,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    median: Math.round(median * 100) / 100,
    sample_count: vals.length,
  };
}

// ── 净现比（经营现金流/净利润）─────────────────────

export function analyzeCashRatio(
  cashflow: [number, number | null][],
  eps: [number, number | null][],
): CashRatioResult | { error: string } {
  const cfMap = new Map(cashflow.map(([y, v]) => [y, v]));
  const epsMap = new Map(eps.map(([y, v]) => [y, v]));
  const years = [...new Set([...cfMap.keys(), ...epsMap.keys()])].sort();
  const recent = years.slice(-ROE_YEARS);

  const records: [number, number | null, number | null, boolean][] = [];
  let allGood = true;
  for (const y of recent) {
    const cf = cfMap.get(y) ?? null;
    const e = epsMap.get(y) ?? null;
    let ratio: number | null = null;
    let ok = false;
    if (cf != null && e != null && e !== 0) {
      ratio = Math.round((cf / e) * 100) / 100;
      ok = ratio >= 1;
    }
    if (!ok) allGood = false;
    records.push([y, cf, e, ok]);
  }

  return { records, all_good: allGood };
}

// ── 商誉占比 ──────────────────────────────────────

export function analyzeGoodwill(rows: GoodwillRow[]): GoodwillResult | { error: string } {
  const latest = rows[0];
  if (!latest) return { error: '未获取到商誉数据' };
  const ratio = latest.goodwillRatio;
  if (ratio == null) {
    return { error: '商誉或净资产数据缺失' };
  }

  const warn = ratio > 30;
  return {
    reportDate: latest.reportDate,
    goodwill: latest.goodwill,
    equity: latest.equity,
    ratio,
    warn,
  };
}

// ── 流动比率/速动比率 ─────────────────────────────

export function analyzeLiquidity(
  current: [number, number | null][],
  quick: [number, number | null][],
): LiquidityResult | { error: string } {
  const curMap = new Map(current.map(([y, v]) => [y, v]));
  const quickMap = new Map(quick.map(([y, v]) => [y, v]));
  const years = [...new Set([...curMap.keys(), ...quickMap.keys()])].sort();
  const recent = years.slice(-ROE_YEARS);

  // 银行/保险等金融行业无流动比率概念（不适用短期偿债指标）
  const hasAny = recent.some(y => (curMap.get(y) ?? null) != null || (quickMap.get(y) ?? null) != null);
  if (!hasAny) {
    return { error: '金融行业无流动比率/速动比率指标' };
  }

  const records: [number, number | null, number | null, boolean][] = [];
  let allOk = true;
  for (const y of recent) {
    const c = curMap.get(y) ?? null;
    const q = quickMap.get(y) ?? null;
    const ok = c != null && c > 1 && q != null && q > 0.5;
    if (!ok) allOk = false;
    records.push([y, c, q, ok]);
  }

  return { records, all_ok: allOk };
}

// ── PEG ──────────────────────────────────────────

export function analyzePEG(
  rows: ValuationRow[],
): PEGResult | { error: string } {
  const vals = rows
    .map(r => r.peg)
    .filter((v): v is number => v != null && v > 0 && isFinite(v));
  if (vals.length === 0) return { error: '未获取到 PEG 数据' };

  const latest = vals[vals.length - 1];
  const median = vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)];
  let level: string;
  if (latest < 1) level = '低估（PEG<1）';
  else if (latest < 1.5) level = '合理（PEG 1-1.5）';
  else if (latest < 2) level = '偏高（PEG 1.5-2）';
  else level = '高估（PEG>2）';

  return {
    peg: latest,
    median,
    percentile: calcPct(vals, latest),
    level,
    sample_count: vals.length,
  };
}

function calcPct(vals: number[], v: number): number {
  const below = vals.filter(x => x <= v).length;
  return Math.round((below / vals.length) * 100 * 100) / 100;
}
