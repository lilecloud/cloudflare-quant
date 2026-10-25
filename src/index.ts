import * as analyze from './api/analyze';
import * as indexes from './api/indexes';
import * as rules from './api/rules';
import * as results from './api/results';
import { runMonitor } from './lib/monitoring';

interface Env {
  PE_HISTORY: KVNamespace;
  MONITOR_KV: KVNamespace;
  ASSETS: Fetcher;
  RESEND_API_KEY?: string;
  ALERT_TO?: string;
  ALERT_FROM?: string;
}

type HandlerContext = { request: Request; env: Env };

/** /api/* 路由分发，返回 null 表示不是 API 路径 */
function route(context: HandlerContext): Promise<Response> | null {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const method = context.request.method;

  if (path === '/api/analyze') {
    if (method === 'GET') return analyze.onRequestGet(context);
    if (method === 'OPTIONS') return analyze.onRequestOptions();
  }
  if (path === '/api/indexes') {
    if (method === 'GET') return indexes.onRequestGet(context);
    if (method === 'OPTIONS') return indexes.onRequestOptions();
  }
  if (path === '/api/rules') {
    if (method === 'GET') return rules.onRequestGet(context);
    if (method === 'PUT' || method === 'POST') return rules.onRequestPut(context);
    if (method === 'OPTIONS') return rules.onRequestOptions();
  }
  if (path === '/api/results') {
    if (method === 'GET') return results.onRequestGet(context);
    if (method === 'OPTIONS') return results.onRequestOptions();
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const res = route({ request, env });
    if (res) return res;
    // 非 /api/* 路径：交给静态资源（asset-first 默认行为下通常直接命中，不会到这里）
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const { items, changedEvents } = await runMonitor(env);
      const summary = items.map((i) => `${i.name}: ${i.value} -> ${i.signal}`).join('; ');
      console.log(`[monitor] ${items.length} rules; changed=${changedEvents.length}; ${summary}`);
    } catch (e: any) {
      console.error('[monitor] scheduled run failed:', e.message);
    }
  },
};
