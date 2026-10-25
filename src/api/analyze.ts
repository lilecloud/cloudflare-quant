import { AnalysisResult } from '../lib/types';
import {
  fetchStockInfo, fetchBoardNames, fetchBoardStocks, normalizeIndustry,
} from '../lib/eastmoney';
import {
  fetchAnnualFinancials, fetchCashflow, fetchGoodwill, fetchValuationHistory,
} from '../lib/emfin';
import {
  analyzePERanking, analyzeROE, analyzeEPSGrowth, analyzeDebtRatio, analyzeCashflow,
  analyzeRevenueGrowth, analyzeMarginSeries, analyzeFCF, analyzeValuationPercentile,
  analyzeCashRatio, analyzeGoodwill, analyzeLiquidity, analyzePEG,
} from '../lib/analysis';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestGet(context): Promise<Response> {
  const url = new URL(context.request.url);
  const code = url.searchParams.get('code')?.trim();

  if (!code || !/^\d{6}$/.test(code)) {
    return json({ error: '请提供有效的6位股票代码，例如 ?code=600000' }, 400);
  }

  const kv: KVNamespace = context.env.PE_HISTORY;

  // ── 结果级缓存：按 代码+日期 缓存整份分析，当日命中直接返回 ──
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cacheKey = `stock:${code}:${today}`;
  const forceFresh = url.searchParams.get('fresh') === '1';

  if (!forceFresh) {
    try {
      const cached = await kv.get(cacheKey, 'json');
      if (cached) {
        return json({ ...cached, cached: true });
      }
    } catch (e: any) {
      // 缓存读取失败不阻塞，继续走完整分析
      console.error(`kv read ${cacheKey} error:`, e.message);
    }
  }

  try {
    const info = await fetchStockInfo(code);
    if (!info) {
      return json({ error: `无法获取股票 ${code} 的信息，请检查代码是否正确` }, 404);
    }

    const boardMap = await fetchBoardNames();
    const boardName = normalizeIndustry(info.industry, boardMap);
    const boardCode = boardName ? boardMap.get(boardName) : undefined;

    const [peResult, finData, cfRows, gwRows, valRows] = await Promise.all([
      boardCode
        ? fetchBoardStocks(boardCode).then(stocks => analyzePERanking(code, boardName!, stocks))
        : Promise.resolve({ error: `未匹配到行业板块：${info.industry}` }),
      fetchAnnualFinancials(code),
      fetchCashflow(code),
      fetchGoodwill(code),
      fetchValuationHistory(code),
    ]);

    const result: AnalysisResult = {
      stock: info,
      pe: peResult,
      roe: finData ? analyzeROE(finData.roe) : { error: '无法获取财务数据' },
      eps: finData ? analyzeEPSGrowth(finData.eps) : { error: '无法获取财务数据' },
      debt: finData ? analyzeDebtRatio(finData.debt) : { error: '无法获取财务数据' },
      cashflow: finData ? analyzeCashflow(finData.cashflow) : { error: '无法获取财务数据' },
      // A 档
      revenue: finData ? analyzeRevenueGrowth(finData.revenue) : { error: '无法获取财务数据' },
      margin: finData ? analyzeMarginSeries(finData.grossMargin, finData.netMargin) : { error: '无法获取财务数据' },
      fcf: analyzeFCF(cfRows),
      valuation: (() => {
        const currentPE = valRows.length ? valRows[valRows.length - 1].peTtm : null;
        return analyzeValuationPercentile(
          currentPE,
          valRows.map(r => r.peTtm),
        );
      })(),
      // B 档
      cashRatio: finData ? analyzeCashRatio(finData.cashflow, finData.eps) : { error: '无法获取财务数据' },
      goodwill: analyzeGoodwill(gwRows),
      liquidity: finData ? analyzeLiquidity(finData.currentRatio, finData.quickRatio) : { error: '无法获取财务数据' },
      peg: analyzePEG(valRows),
    };

    // 写入结果级缓存（TTL 25h，覆盖当日+次日凌晨，避免过期边缘）
    try {
      await kv.put(cacheKey, JSON.stringify(result), { expirationTtl: 25 * 3600 });
    } catch (e: any) {
      console.error(`kv put ${cacheKey} error:`, e.message);
    }

    return json({ ...result, cached: false });
  } catch (e: any) {
    return json({ error: `分析异常：${e.message ?? e}` }, 500);
  }
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
