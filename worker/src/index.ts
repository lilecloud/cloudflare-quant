// 定时计算 Worker（只跑 cron；用户访问走 Pages 的 pages.dev）
import { runMonitor } from './lib/monitoring';

interface Env {
  PE_HISTORY: KVNamespace;
  MONITOR_KV: KVNamespace;
  RESEND_API_KEY?: string;
  ALERT_TO?: string;
  ALERT_FROM?: string;
}

export default {
  /** cron 定时任务：UTC 07:45 = 北京 15:45 工作日 */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const { items, changedEvents } = await runMonitor(env);
      const summary = items.map((i) => `${i.name}: ${i.value} -> ${i.signal}`).join('; ');
      console.log(`[monitor] ${items.length} rules; changed=${changedEvents.length}; ${summary}`);
    } catch (e: any) {
      console.error('[monitor] scheduled run failed:', e.message);
    }
  },

  /** 健康检查（手动访问这个 Worker 只会返回 ok，页面在 Pages） */
  async fetch(): Promise<Response> {
    return new Response('quant cron worker ok', { status: 200 });
  },
};
