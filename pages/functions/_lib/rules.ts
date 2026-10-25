// 规则模型 + 信号判定（与 Python 版 monitor.py 保持一致）

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  indicator: string;
  direction: 'high' | 'low';
  buyThreshold: number;
  sellThreshold: number;
}

// 默认 4 条规则（与页面 / 历史 Python 版一致）
export const DEFAULT_RULES: Rule[] = [
  { id: 'div_spread_000922', name: '中证红利股息率−10Y国债利差', enabled: true, indicator: 'dividend_spread_000922', direction: 'high', buyThreshold: 2.5, sellThreshold: 1.0 },
  { id: 'div_H30269', name: '红利低波股息率', enabled: true, indicator: 'dividend_yield_H30269', direction: 'high', buyThreshold: 4.5, sellThreshold: 3.0 },
  { id: 'pe_000300', name: '沪深300 PE百分位', enabled: true, indicator: 'pe_percentile_000300', direction: 'low', buyThreshold: 30, sellThreshold: 80 },
  { id: 'div_000922', name: '中证红利股息率', enabled: true, indicator: 'dividend_yield_000922', direction: 'high', buyThreshold: 5.0, sellThreshold: 3.5 },
];

export type Signal = 'BUY' | 'HOLD' | 'SELL';

/**
 * 按规则阈值把指标值映射为 BUY / HOLD / SELL。
 * direction=high：值越高越买（股息率、股债利差）
 * direction=low ：值越低越买（PE 百分位）
 */
export function applyRule(rule: Rule, value: number): Signal {
  const buy = rule.buyThreshold;
  const sell = rule.sellThreshold;
  if (rule.direction === 'high') {
    if (value >= buy) return 'BUY';
    if (value <= sell) return 'SELL';
  } else {
    if (value <= buy) return 'BUY';
    if (value >= sell) return 'SELL';
  }
  return 'HOLD';
}
