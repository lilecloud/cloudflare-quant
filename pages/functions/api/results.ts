import { RESULTS_KEY, SIGNAL_LOG_KEY, getJson, json, corsHeaders } from './monitor-shared';

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

// 读取最新结果 + 信号历史
export async function onRequestGet(context: any): Promise<Response> {
  const results = await getJson<any>(
    context.env.MONITOR_KV,
    RESULTS_KEY,
    { updatedAt: null, items: [] },
  );
  const signalLog = await getJson<any[]>(context.env.MONITOR_KV, SIGNAL_LOG_KEY, []);
  return json({ results, signalLog });
}
