export interface StockInfo {
  code: string;
  name: string;
  industry: string;
}

export interface BoardItem {
  code: string;
  name: string;
  pe: number | null;
  pb: number | null;
}

export interface PERankingResult {
  board_name: string;
  total: number;
  positive_count: number;
  negative_count: number;
  stock_pe: number | null;
  stock_pb: number | null;
  rank: number | null;
  rank_total: number | null;
  lowest: BoardItem[];
  highest: BoardItem[];
  negative_pe: BoardItem[];
}

export interface ROEResult {
  records: [number, number | null, boolean][];
  all_pass: boolean;
  threshold: number;
}

export interface EPSResult {
  records: [number, number | null, number | null, number | null, boolean][];
  all_grew: boolean;
}

export interface DebtResult {
  records: [number, number | null, boolean][];
  warned: boolean;
}

export interface CashflowResult {
  records: [number, number | null, boolean][];
  all_positive: boolean;
}

export type DimResult<T> = T | { error: string };

// ── A/B 档新增维度 ────────────────────────────────

export interface RevenueResult {
  records: [number, number | null, boolean][];  // [年份, 营收同比%, 是否正增长]
  all_grew: boolean;
}

export interface MarginRow {
  reportDate: string;
  grossMargin: number | null;
  netMargin: number | null;
}

export interface MarginResult {
  records: MarginRow[];
  gross_ok: boolean | null;
  net_ok: boolean | null;
  note: string | null;
}

export interface FCFRecord {
  year: number;
  operateCashflow: number | null;
  capex: number | null;
  freeCashflow: number | null;
}

export interface FCFResult {
  records: FCFRecord[];
  all_positive: boolean;
}

export interface ValuationPercentileResult {
  pe_ttm: number;
  percentile: number;   // 当前 PE 在历史中的百分位
  min: number;
  max: number;
  median: number;
  sample_count: number;
}

export interface CashRatioResult {
  records: [number, number | null, number | null, boolean][];  // [年份, 每股经营现金流, 每股收益, 净现比>=1]
  all_good: boolean;
}

export interface GoodwillResult {
  reportDate: string;
  goodwill: number | null;
  equity: number | null;
  ratio: number;        // 商誉/净资产 %
  warn: boolean;        // >30% 预警
}

export interface LiquidityResult {
  records: [number, number | null, number | null, boolean][];  // [年份, 流动比率, 速动比率, 是否达标]
  all_ok: boolean;
}

export interface PEGResult {
  peg: number;
  median: number;
  percentile: number;
  level: string;
  sample_count: number;
}

export interface AnalysisResult {
  stock: StockInfo;
  pe: DimResult<PERankingResult>;
  roe: DimResult<ROEResult>;
  eps: DimResult<EPSResult>;
  debt: DimResult<DebtResult>;
  cashflow: DimResult<CashflowResult>;
  revenue: DimResult<RevenueResult>;
  margin: DimResult<MarginResult>;
  fcf: DimResult<FCFResult>;
  valuation: DimResult<ValuationPercentileResult>;
  cashRatio: DimResult<CashRatioResult>;
  goodwill: DimResult<GoodwillResult>;
  liquidity: DimResult<LiquidityResult>;
  peg: DimResult<PEGResult>;
}
