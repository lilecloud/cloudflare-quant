// 信号监控主流程（JS 版，替代 Python 的 monitor.py）
import { refreshAndGet, calcPercentile, fetchIndicator } from './csindex';
import { fetchTreasury10Y } from './treasury';
import { DEFAULT_RULES, applyRule, Rule, Signal } from './rules';

export interface RuleResult {
  ruleId: string;
  name: string;
  indicator: string;
  value: number | null;
  signal: Signal | 'ERROR';
  prevSignal: string | null;
  changed?: boolean;
  message: string;
  updatedAt: string;
}

const KEY_RULES = 'rules';
const KEY_RESULTS = 'results';
const KEY_LOG = 'signal_log';
const MAX_LOG = 50;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 按 indicator key 计算指标值（数据源：中证指数 + 东财国债） */
async function computeIndicator(kv: KVNamespace, indicator: string): Promise<number> {
  if (indicator === 'erp_csi300') {
    const history = await refreshAndGet(kv, '000300');
    const { pe } = calcPercentile(history);
    const ty = await fetchTreasury10Y();
    if (!pe || ty == null) throw new Error('沪深300 PE 或国债数据获取失败');
    return Math.round(((1 / pe) * 100 - ty) * 1000) / 1000;
  }
  if (indicator.startsWith('dividend_spread_')) {
    const code = indicator.slice('dividend_spread_'.length);
    const ind = await fetchIndicator(code);
    const ty = await fetchTreasury10Y();
    if (ind?.dividendYield == null || ty == null) throw new Error('股息率或国债数据获取失败');
    return Math.round((ind.dividendYield - ty) * 1000) / 1000;
  }
  if (indicator.startsWith('pe_percentile_')) {
    const code = indicator.slice('pe_percentile_'.length);
    const history = await refreshAndGet(kv, code);
    return calcPercentile(history).percentile;
  }
  if (indicator.startsWith('dividend_yield_')) {
    const code = indicator.slice('dividend_yield_'.length);
    const ind = await fetchIndicator(code);
    if (ind?.dividendYield == null) throw new Error('股息率数据获取失败');
    return ind.dividendYield;
  }
  throw new Error(`未知 indicator: ${indicator}`);
}

export interface MonitorRun {
  items: RuleResult[];
  changedEvents: any[];
}

/** 读取规则 → 算指标 → 判信号 → 写回 KV（由 cron 的 scheduled 调用） */
export async function runMonitor(env: { MONITOR_KV: KVNamespace }): Promise<MonitorRun> {
  const kv = env.MONITOR_KV;

  const rawRules = await kv.get(KEY_RULES);
  let rules: Rule[];
  try {
    rules = rawRules ? JSON.parse(rawRules) : DEFAULT_RULES;
    if (!Array.isArray(rules) || rules.length === 0) rules = DEFAULT_RULES;
  } catch {
    rules = DEFAULT_RULES;
  }

  const rawPrev = await kv.get(KEY_RESULTS);
  const prevMap = new Map<string, string>();
  if (rawPrev) {
    try {
      const prev = JSON.parse(rawPrev);
      for (const it of prev.items ?? []) prevMap.set(it.ruleId, it.signal);
    } catch { /* ignore */ }
  }

  const items: RuleResult[] = [];
  const changedEvents: any[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    try {
      const value = await computeIndicator(kv, rule.indicator);
      let signal: Signal = applyRule(rule, value);
      let message = '';
      // 股息率利差硬门槛：股息率必须 > 国债利率（差值 > 0）才允许 BUY
      if (rule.indicator.startsWith('dividend_spread_') && signal === 'BUY' && !(value > 0)) {
        signal = 'HOLD';
        message = `差值 ${value} ≤ 0：股息率不高于国债利率，不买入`;
      }
      const prevSignal = prevMap.get(rule.id) ?? null;
      const changed = prevSignal !== null && prevSignal !== signal;
      items.push({ ruleId: rule.id, name: rule.name, indicator: rule.indicator, value, signal, prevSignal, changed, message, updatedAt: nowIso() });
      if (changed) {
        changedEvents.push({ at: nowIso(), ruleId: rule.id, name: rule.name, indicator: rule.indicator, value, from: prevSignal, to: signal });
      }
    } catch (e: any) {
      items.push({ ruleId: rule.id, name: rule.name, indicator: rule.indicator, value: null, signal: 'ERROR', prevSignal: prevMap.get(rule.id) ?? null, message: e.message, updatedAt: nowIso() });
    }
  }

  await kv.put(KEY_RESULTS, JSON.stringify({ updatedAt: nowIso(), items }));

  if (changedEvents.length) {
    let log: any[] = [];
    try { const raw = await kv.get(KEY_LOG); if (raw) log = JSON.parse(raw); } catch { /* ignore */ }
    await kv.put(KEY_LOG, JSON.stringify([...changedEvents, ...log].slice(0, MAX_LOG)));
    // TODO: 在这里接推送（Server酱 / 企业微信）
  }

  return { items, changedEvents };
}
