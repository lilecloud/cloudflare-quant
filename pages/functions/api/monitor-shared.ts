// 信号监控：规则/结果在 KV 中的 key；Rule/DEFAULT_RULES 统一来自 ../_lib/rules
import { Rule, DEFAULT_RULES } from '../_lib/rules';

export { Rule, DEFAULT_RULES };
export const RULES_KEY = 'rules';
export const RESULTS_KEY = 'results';
export const SIGNAL_LOG_KEY = 'signal_log';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function getJson<T>(kv: KVNamespace, key: string, fallback: T): Promise<T> {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
  });
}
