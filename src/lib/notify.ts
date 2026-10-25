// 信号变化邮件通知（Resend HTTP API，免费额度 3000 封/月）
// 需要配置 secret：RESEND_API_KEY
// 可选环境变量：ALERT_TO（收件人，默认 lile_0126@126.com）、ALERT_FROM（发件人，默认 Resend 测试地址）

interface AlertEvent {
  at: string;
  name: string;
  value: number;
  from: string;
  to: string;
}

export interface NotifyEnv {
  RESEND_API_KEY?: string;
  ALERT_TO?: string;
  ALERT_FROM?: string;
}

const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ESC_MAP[c] ?? c);
}

function buildHtml(events: AlertEvent[]): string {
  const rows = events
    .map(
      (e) => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:14px">${esc(e.name)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:right;font-variant-numeric:tabular-nums">${e.value}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:14px;text-align:center">${esc(e.from)} <span style="color:#94a3b8">→</span> <b style="color:#16a34a">${esc(e.to)}</b></td>
      </tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:24px;border:1px solid #e8edf3">
      <h2 style="margin:0 0 6px;font-size:18px;color:#0f172a">📊 量化信号变化</h2>
      <p style="margin:0 0 18px;font-size:13px;color:#64748b">共 ${events.length} 条信号发生切换 · ${esc(events[0]?.at ?? '')}</p>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:9px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600">规则</th>
          <th style="padding:9px 12px;text-align:right;font-size:12px;color:#64748b;font-weight:600">值</th>
          <th style="padding:9px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600">信号</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Quant Signal Monitor · 自动通知</p>
    </div>
  </body></html>`;
}

export async function sendAlertEmail(events: AlertEvent[], env: NotifyEnv): Promise<void> {
  if (!events.length) return;
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[notify] 未配置 RESEND_API_KEY，跳过邮件通知');
    return;
  }
  const to = env.ALERT_TO || 'lile_0126@126.com';
  const from = env.ALERT_FROM || 'onboarding@resend.dev';
  const subject = `【量化信号】${events.length} 个信号变化`;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html: buildHtml(events) }),
    });
    if (!res.ok) {
      console.error('[notify] 邮件发送失败', res.status, await res.text());
    } else {
      console.log('[notify] 邮件已发送到', to);
    }
  } catch (e: any) {
    console.error('[notify] 邮件发送异常:', e.message);
  }
}
