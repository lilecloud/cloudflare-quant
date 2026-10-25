import { fetchCached } from './cache';

// 东方财富数据中心数据源：补充个股分析维度
// - RPT_F10_FINANCE_MAINFINADATA: 主要财务指标（毛利率 MLR、净利率 XSJLL 等）
// - RPT_DMSK_FN_CASHFLOW: 现金流量表（经营现金流、购建资产 → 自由现金流）
// - RPT_GOODWILL_STOCKDETAILS: 商誉明细
// - RPT_VALUEANALYSIS_DET: 历史估值（PE/PB/PS/PEG）→ 估值百分位

function marketSuffix(code: string): string {
  // 6 开头沪市，其余深市；8/4 开头北交所
  if (code.startsWith('6')) return '.SH';
  if (code.startsWith('4') || code.startsWith('8')) return '.BJ';
  return '.SZ';
}

function seccode(code: string): string {
  return code + marketSuffix(code);
}

const UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

async function fetchEastmoneyData(
  reportName: string,
  filter: string,
  pageSize = 10,
  pageNumber = 1,
  sortColumns = 'REPORT_DATE',
  sortTypes = '-1',
): Promise<any[]> {
  const params = new URLSearchParams({
    reportName,
    columns: 'ALL',
    filter,
    pageNumber: String(pageNumber),
    pageSize: String(pageSize),
    sortColumns,
    sortTypes,
  });
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?${params}`;
  const res = await fetchCached(url, 3600, { headers: UA });
  if (!res.ok) return [];
  const j: any = await res.json();
  return j?.result?.data ?? [];
}

export interface CashflowRow {
  reportDate: string;
  operateCashflow: number | null;       // 经营活动现金流净额
  capex: number | null;                 // 购建固定资产等支付现金
  freeCashflow: number | null;          // 自由现金流 = 经营现金流 - 资本开支
}

/** 现金流量表（按报告期倒序） */
export async function fetchCashflow(code: string): Promise<CashflowRow[]> {
  const rows = await fetchEastmoneyData(
    'RPT_DMSK_FN_CASHFLOW',
    `(SECUCODE="${seccode(code)}")`,
    40,
  );
  return rows.map((r: any) => {
    const op = r.NETCASH_OPERATE != null ? Number(r.NETCASH_OPERATE) : null;
    const cap = r.CONSTRUCT_LONG_ASSET != null ? Number(r.CONSTRUCT_LONG_ASSET) : null;
    return {
      reportDate: String(r.REPORT_DATE ?? '').slice(0, 10),
      operateCashflow: op,
      capex: cap,
      freeCashflow: op != null && cap != null ? op - cap : null,
    };
  });
}

export interface GoodwillRow {
  reportDate: string;
  goodwill: number | null;         // 商誉
  equity: number | null;           // 净资产（归属母公司）
  goodwillRatio: number | null;    // 商誉/净资产 %
}

/** 商誉明细（按报告期倒序） */
export async function fetchGoodwill(code: string): Promise<GoodwillRow[]> {
  const rows = await fetchEastmoneyData(
    'RPT_GOODWILL_STOCKDETAILS',
    `(SECURITY_CODE="${code}")`,
    20,
  );
  return rows.map((r: any) => {
    const gw = r.GOODWILL != null ? Number(r.GOODWILL) : null;
    const eq = r.SUMSHEQUITY != null ? Number(r.SUMSHEQUITY) : null;
    return {
      reportDate: String(r.REPORT_DATE ?? '').slice(0, 10),
      goodwill: gw,
      equity: eq,
      goodwillRatio: gw != null && eq != null && eq > 0 ? (gw / eq) * 100 : null,
    };
  });
}

export interface ValuationRow {
  tradeDate: string;
  peTtm: number | null;
  pb: number | null;
  ps: number | null;
  peg: number | null;
}

/** 历史估值序列（含 PE/PB/PS/PEG），用于计算估值百分位 */
export async function fetchValuationHistory(code: string): Promise<ValuationRow[]> {
  const out: ValuationRow[] = [];
  // 拉取最近约 8 年（2400 个交易日以内，分页）
  for (let page = 1; page <= 5; page++) {
    const rows = await fetchEastmoneyData(
      'RPT_VALUEANALYSIS_DET',
      `(SECUCODE="${seccode(code)}")`,
      500,
      page,
      'TRADE_DATE',
      '1',
    );
    if (!rows.length) break;
    for (const r of rows) {
      out.push({
        tradeDate: String(r.TRADE_DATE ?? '').slice(0, 10),
        peTtm: r.PE_TTM != null ? Number(r.PE_TTM) : null,
        pb: r.PB_MRQ != null ? Number(r.PB_MRQ) : null,
        ps: r.PS_TTM != null ? Number(r.PS_TTM) : null,
        peg: r.PEG_CAR != null ? Number(r.PEG_CAR) : null,
      });
    }
    if (rows.length < 500) break;
  }
  return out;
}

/** 计算当前值在历史序列中的百分位（0-100） */
export function calcPercentile(history: (number | null)[], current: number | null): number | null {
  if (current == null || history.length === 0) return null;
  const vals = history.filter((v): v is number => v != null && v > 0);
  if (vals.length === 0) return null;
  const below = vals.filter(v => v <= current).length;
  return Math.round((below / vals.length) * 100 * 100) / 100;
}

// ── 年度财务数据（替代同花顺）──────────────────────

export interface AnnualFinancials {
  roe: [number, number | null][];
  eps: [number, number | null][];
  debt: [number, number | null][];
  cashflow: [number, number | null][];
  revenue: [number, number | null][];
  netProfit: [number, number | null][];
  netMargin: [number, number | null][];
  grossMargin: [number, number | null][];
  currentRatio: [number, number | null][];
  quickRatio: [number, number | null][];
}

/**
 * 拉取年度财务数据（年报口径，仅 12-31 报告期）
 * 数据源：东财 RPT_F10_FINANCE_MAINFINADATA + RPT_DMSK_FN_BALANCE（负债率）
 */
export async function fetchAnnualFinancials(code: string): Promise<AnnualFinancials | null> {
  const mainRows = await fetchEastmoneyData(
    'RPT_F10_FINANCE_MAINFINADATA',
    `(SECUCODE="${seccode(code)}")`,
    80,
  );
  if (!mainRows.length) return null;

  // 仅保留年报
  const annual = mainRows.filter(r => String(r.REPORT_DATE ?? '').includes('12-31'));

  // 负债率来自资产负债表
  const balanceRows = await fetchEastmoneyData(
    'RPT_DMSK_FN_BALANCE',
    `(SECUCODE="${seccode(code)}")`,
    40,
  );
  const debtMap = new Map<string, number | null>();
  for (const r of balanceRows) {
    const date = String(r.REPORT_DATE ?? '').slice(0, 10);
    debtMap.set(date, r.DEBT_ASSET_RATIO != null ? Number(r.DEBT_ASSET_RATIO) : null);
  }

  const toSeries = (fn: (r: any) => number | null): [number, number | null][] => {
    const out: [number, number | null][] = [];
    for (const r of annual) {
      const year = Number(String(r.REPORT_DATE).slice(0, 4));
      if (!isNaN(year)) out.push([year, fn(r)]);
    }
    return out;
  };

  const debtSeries: [number, number | null][] = [];
  for (const r of annual) {
    const year = Number(String(r.REPORT_DATE).slice(0, 4));
    const date = String(r.REPORT_DATE).slice(0, 10);
    if (!isNaN(year)) debtSeries.push([year, debtMap.get(date) ?? null]);
  }

  return {
    roe: toSeries(r => r.ROEJQ != null ? Number(r.ROEJQ) : null),
    eps: toSeries(r => r.EPSJB != null ? Number(r.EPSJB) : null),
    debt: debtSeries,
    cashflow: toSeries(r => r.MGJYXJJE != null ? Number(r.MGJYXJJE) : null),
    revenue: toSeries(r => r.TOTALOPERATEREVETZ != null ? Number(r.TOTALOPERATEREVETZ) : null),
    netProfit: toSeries(r => r.PARENTNETPROFITTZ != null ? Number(r.PARENTNETPROFITTZ) : null),
    netMargin: toSeries(r => r.XSJLL != null ? Number(r.XSJLL) : null),
    grossMargin: toSeries(r => r.XSMLL != null ? Number(r.XSMLL) : null),
    currentRatio: toSeries(r => r.LD != null ? Number(r.LD) : null),
    quickRatio: toSeries(r => r.SD != null ? Number(r.SD) : null),
  };
}
