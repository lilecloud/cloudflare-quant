import {
  IndexRank, loadPEHistory, getLastUpdated, setLastUpdated, refreshAndGet,
  calcPercentile, scoreAndAction, fetchIndicator, ValuationMethod,
} from '../_lib/csindex';

// valuation: PE=市盈率估值 | DIVIDEND=股息率估值 | PB=市净率估值
// 市场通用标准：红利类看股息率；金融/证券等盈利波动大的行业看市净率
const INDEX_POOL: { name: string; code: string; valuation: ValuationMethod }[] = [
  { name: '红利低波', code: 'H30269', valuation: 'DIVIDEND' },
  { name: '中证传媒', code: '399971', valuation: 'PE' },
  { name: '中国互联网50', code: 'H30533', valuation: 'PE' },
  { name: '中证红利', code: '000922', valuation: 'DIVIDEND' },
  { name: '全指医药', code: '000991', valuation: 'PE' },
  { name: '中证消费', code: '000932', valuation: 'PE' },
  { name: '中证500', code: '000905', valuation: 'PE' },
  { name: '沪深300', code: '000300', valuation: 'PE' },
  { name: '沪深300价值', code: '000921', valuation: 'PE' },
  { name: '全指信息', code: '000993', valuation: 'PE' },
  { name: '中证医疗', code: '399989', valuation: 'PE' },
  { name: '证券公司', code: '399975', valuation: 'PB' },
  { name: '中证酒', code: '399987', valuation: 'PE' },
  { name: '中证军工', code: '399967', valuation: 'PE' },
  { name: '中证环保', code: '000827', valuation: 'PE' },
  { name: '全指金融', code: '932075', valuation: 'PB' },
];

const VALUATION_LABELS: Record<ValuationMethod, string> = {
  PE: '市盈率',
  DIVIDEND: '股息率',
  PB: '市净率',
};

const NON_PE_NOTES: Partial<Record<ValuationMethod, string>> = {
  DIVIDEND: '红利类指数，市场通用以股息率评估，市盈率参考意义有限',
  PB: '金融/证券行业盈利波动大，市场通用以市净率评估，市盈率参考意义有限',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestGet(context): Promise<Response> {
  const kv: KVNamespace = context.env.PE_HISTORY;

  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const lastUpdated = await getLastUpdated(kv);
    const needsFresh = lastUpdated !== today;

    const results = await Promise.all(INDEX_POOL.map(async (idx) => {
      const { name, code, valuation } = idx;

      if (valuation === 'PE') {
        let history = await loadPEHistory(kv, code);
        if (needsFresh || history.length === 0) {
          history = await refreshAndGet(kv, code);
        }
        if (history.length === 0) return null;

        const { pe, percentile, prevPe, peDelta } = calcPercentile(history);
        const { score, level, action, multiple } = scoreAndAction(percentile);

        return {
          name, code, valuation,
          valuationLabel: VALUATION_LABELS[valuation],
          pe, prevPe, peDelta, percentile, score, level, action, multiple,
          dividendYield: null,
        } as IndexRank;
      }

      // 非 PE 估值：不计算市盈率百分位，改为展示对应指标（股息率/市净率）
      const indicator = await fetchIndicator(code);
      const rank: IndexRank = {
        name, code, valuation,
        valuationLabel: VALUATION_LABELS[valuation],
        pe: indicator?.pe ?? null,
        prevPe: null, peDelta: null,
        percentile: -1, score: -1,
        level: valuation === 'DIVIDEND' ? '股息率估值' : '市净率估值',
        action: NON_PE_NOTES[valuation] ?? '',
        multiple: 0,
        dividendYield: indicator?.dividendYield ?? null,
      };
      return rank;
    }));

    if (needsFresh) {
      await setLastUpdated(kv);
    }

    const valid = results.filter((r): r is IndexRank => r !== null);
    // PE 估值的按分数排序，非 PE 估值的排在其后
    valid.sort((a, b) => {
      const aPe = a.valuation === 'PE' ? a.score : -1;
      const bPe = b.valuation === 'PE' ? b.score : -1;
      if (a.valuation !== b.valuation) return a.valuation === 'PE' ? -1 : 1;
      return bPe - aPe;
    });

    return new Response(JSON.stringify({ items: valid, updated: needsFresh ? 'refreshed' : 'cached' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || '分析异常' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
