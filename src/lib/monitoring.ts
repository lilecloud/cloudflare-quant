// 信号监控主流程（JS 版，替代 Python 的 monitor.py）
import { refreshAndGet, calcPercentile, fetchIndicator } from './csindex';
import { fetchTreasury10Y } from './treasury';
import { DEFAULT_RULES, applyRule, Rule, Signal } from './rules';
import { sendAlertEmail, NotifyEnv } from './notify';

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
  /** 底层原始数据（股息率 / 国债收益率 / PE 等），用于展示「现在数据是啥」 */
  detail?: Record<string, number | null>;
  /** 命中说明（哪条阈值触发了这个信号） */
  reason?: string;
}

const KEY_RULES = 'rules';
const KEY_RESULTS = 'results';
const KEY_LOG = 'signal_log';
const MAX_LOG = 50;

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

interface IndicatorResult {
  value: number;
  detail: Record<string, number | null>;
}

/** 按 indicator key 计算指标值 + 底层数据 */
async function computeIndicator(kv: KVNamespace, indicator: string): Promise<IndicatorResult> {
  if (indicator === 'erp_csi300') {
    const history = await refreshAndGet(kv, '000300');
    const { pe } = calcPercentile(history);
    const ty = await fetchTreasury10Y();
    if (!pe || ty == null) throw new Error('沪深300 PE 或国债数据获取失败');
    const erp = Math.round(((1 / pe) * 100 - ty) * 1000) / 1000;
    return { value: erp, detail: { pe, treasuryYield: ty, erp } };
  }
  if (indicator.startsWith('dividend_spread_')) {
    const code = indicator.slice('dividend_spread_'.length);
    const ind = await fetchIndicator(code);
    const ty = await fetchTreasury10Y();
    if (ind?.dividendYield == null || ty == null) throw new Error('股息率或国债数据获取失败');
    const spread = Math.round((ind.dividendYield - ty) * 1000) / 1000;
    return { value: spread, detail: { dividendYield: ind.dividendYield, treasuryYield: ty, spread } };
  }
  if (indicator.startsWith('pe_percentile_')) {
    const code = indicator.slice('pe_percentile_'.length);
    const history = await refreshAndGet(kv, code);
    const { pe, percentile } = calcPercentile(history);
    return { value: percentile, detail: { pe, percentile, historyDays: history.length } };
  }
  if (indicator.startsWith('dividend_yield_')) {
    const code = indicator.slice('dividend_yield_'.length);
    const ind = await fetchIndicator(code);
    if (ind?.dividendYield == null) throw new Error('股息率数据获取失败');
    return { value: ind.dividendYield, detail: { dividendYield: ind.dividendYield, pe: ind.pe } };
  }
  throw new Error(`未知 indicator: ${indicator}`);
}

/** 生成命中说明：哪条阈值 → 什么信号 */
function buildReason(rule: Rule, value: number, signal: Signal): string {
  const buy = rule.buyThreshold;
  const sell = rule.sellThreshold;
  if (rule.direction === 'high') {
    if (signal === 'BUY') return `值 ${value} ≥ BUY 阈值 ${buy} → 买入`;
    if (signal === 'SELL') return `值 ${value} ≤ SELL 阈值 ${sell} → 卖出`;
    return `值 ${value} 介于 (${sell}, ${buy}) → 持有`;
  }
  if (signal === 'BUY') return `值 ${value} ≤ BUY 阈值 ${buy} → 买入`;
  if (signal === 'SELL') return `值 ${value} ≥ SELL 阈值 ${sell} → 卖出`;
  return `值 ${value} 介于 (${buy}, ${sell}) → 持有`;
}

export interface MonitorRun {
  items: RuleResult[];
  changedEvents: any[];
}

/** 读取规则 → 算指标 → 判信号 → 写回 KV（由 cron 的 scheduled 调用） */
export async function runMonitor(env: { MONITOR_KV: KVNamespace } & NotifyEnv): Promise<MonitorRun> {
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
      const { value, detail } = await computeIndicator(kv, rule.indicator);
      let signal: Signal = applyRule(rule, value);
      let message = '';
      // 股息率利差硬门槛：股息率必须 > 国债利率（差值 > 0）才允许 BUY
      if (rule.indicator.startsWith('dividend_spread_') && signal === 'BUY' && !(value > 0)) {
        signal = 'HOLD';
        message = `差值 ${value} ≤ 0：股息率不高于国债利率，不买入`;
      }
      const reason = message || buildReason(rule, value, signal);
      const prevSignal = prevMap.get(rule.id) ?? null;
      const changed = prevSignal !== null && prevSignal !== signal;
      items.push({ ruleId: rule.id, name: rule.name, indicator: rule.indicator, value, signal, prevSignal, changed, message, updatedAt: nowIso(), detail, reason });
      if (changed) {
        changedEvents.push({ at: nowIso(), ruleId: rule.id, name: rule.name, indicator: rule.indicator, value, from: prevSignal, to: signal, detail, reason });
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
    await sendAlertEmail(changedEvents, env);
  }

  return { items, changedEvents };
}
