import { RULES_KEY, DEFAULT_RULES, getJson, json, corsHeaders, Rule } from './monitor-shared';

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { headers: corsHeaders });
}

// 读取规则列表
export async function onRequestGet(context: any): Promise<Response> {
  const rules = await getJson<Rule[]>(context.env.MONITOR_KV, RULES_KEY, DEFAULT_RULES);
  return json({ rules });
}

// 保存规则列表（整体覆盖）
export async function onRequestPut(context: any): Promise<Response> {
  let body: Rule[];
  try {
    body = await context.request.json();
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }
  if (!Array.isArray(body)) {
    return json({ error: 'rules 必须是数组' }, 400);
  }
  for (const r of body) {
    if (!r.id || !r.name || !r.indicator || !(r.direction === 'high' || r.direction === 'low')) {
      return json({ error: `规则字段不完整或非法: ${JSON.stringify(r)}` }, 400);
    }
    if (typeof r.buyThreshold !== 'number' || typeof r.sellThreshold !== 'number') {
      return json({ error: `阈值必须是数字: ${r.id}` }, 400);
    }
  }
  await context.env.MONITOR_KV.put(RULES_KEY, JSON.stringify(body));
  return json({ ok: true, count: body.length });
}
