# AGENTS.md

面向在这个项目上工作的 AI / 开发者的说明。

## 项目简介

Cloudflare 量化监控项目，**双项目结构**：

- **`pages/`（Cloudflare Pages）** — 用户访问的页面 + API，`${pages_name}.pages.dev`（国内可访问）。
- **`worker/`（Cloudflare Worker）** — 只跑 cron 定时 + 邮件通知，`quant.<subdomain>.workers.dev`（workers.dev 国内被墙，但 cron 服务端照跑）。
- 两者共用 KV：`PE_HISTORY` / `MONITOR_KV`。

**为什么拆**：`workers.dev` 国内被 GFW DNS 污染打不开，`pages.dev` 正常。所以页面/API 放 Pages，定时任务放 Worker。

详细功能/部署见 `README.md`，本文件侧重「改代码要遵守什么」。

## 快速命令

```bash
npm install                        # 依赖（两个项目共用根 node_modules）
npx wrangler pages deploy pages/public --project-name quant --commit-dirty=true   # 部署 Pages
cd worker && npx wrangler deploy   # 部署 Worker（cron）
npx wrangler deploy --dry-run      # 在 worker/ 下：只打包不部署
npx wrangler dev --test-scheduled  # 在 worker/ 下：本地跑 cron
node --check pages/public/monitor.js
```

## 目录结构

```
pages/
  functions/api/    /api/* 路由（analyze / indexes / rules / results / monitor-shared）
  functions/_lib/   页面/API 的数据逻辑（csindex / eastmoney / emfin / analysis / cache / types / rules / indexes）
  public/           index.html / app.js / monitor.html / monitor.js
  wrangler.toml     Pages 配置（KV 绑定）
worker/
  src/index.ts      scheduled 入口
  src/lib/          monitoring / treasury / rules / notify / csindex / cache / types
  wrangler.toml     Worker 配置（cron + KV + vars）
```

## 指标 / 规则 / 信号

| indicator | 含义 | 数据源 |
|---|---|---|
| `erp_csi300` | 沪深300股权风险溢价 = (1/PE)×100 − 10Y国债 | csindex + 东财国债 |
| `pe_percentile_<code>` | 指数 PE 十年历史百分位 | csindex |
| `dividend_yield_<code>` | 指数最新股息率(%) | csindex indicator.xls |
| `dividend_spread_<code>` | 股息率 − 10Y国债收益率 | csindex + 东财国债 |

- `direction: high`：值 ≥ buyThreshold → BUY；值 ≤ sellThreshold → SELL；中间 HOLD。
- `direction: low`：值 ≤ buyThreshold → BUY；值 ≥ sellThreshold → SELL；中间 HOLD。
- **股息率利差硬门槛**：`dividend_spread_*` 必须「股息率 > 国债利率」（差值 > 0）才允许 BUY。
- 只在信号变化时写 `signal_log` + 发邮件。

默认规则（`worker/src/lib/rules.ts` + `pages/functions/_lib/rules.ts` 需一致）：

| 规则 | indicator | 方向 | BUY | SELL |
|---|---|---|---|---|
| 中证红利股息率−10Y国债利差 | `dividend_spread_000922` | high | ≥ 2.5 | ≤ 1 |
| 红利低波股息率 | `dividend_yield_H30269` | high | ≥ 4.5 | ≤ 3.0 |
| 沪深300 PE百分位 | `pe_percentile_000300` | low | ≤ 30 | ≥ 80 |
| 中证红利股息率 | `dividend_yield_000922` | high | ≥ 5.0 | ≤ 3.5 |

## 结果数据（KV `results`）

`RuleResult` 含：`value` / `signal` / `prevSignal` / `changed` / **`detail`**（底层数据）/ **`reason`**（命中原因）/ `updatedAt`。

前端结果表展示：规则 / 当前值 / 底层数据 / 信号 / 命中原因 / 更新时间（`pages/public/monitor.js` 的 `formatDetail`）。

## 邮件通知

- `worker/src/lib/notify.ts`，信号变化时经 **Resend** HTTP API 发送，正文含底层数据与命中原因。
- secret：`RESEND_API_KEY`（`cd worker && npx wrangler secret put RESEND_API_KEY`）；vars：`ALERT_TO` / `ALERT_FROM`。
- 手动测试：Pages 的 `/api/test-email`；手动重跑：`/api/run-monitor`。
- Resend 免费无域名时只能发到注册邮箱。

## 已知限制

- **个股分析 `/api/analyze` 云端可能 502**：依赖东财 `push2`，按 IP 拦 Cloudflare 边缘，加 UA/重试无效。用本地 `stock_analyzer.py`。
- **`workers.dev` 国内被 DNS 污染**：Worker 的 URL 打不开，但 cron 服务端照常执行，别把用户入口指到 Worker。

## Watch out

- 用户访问入口是 **Pages（pages.dev）**，不是 Worker（workers.dev 被墙）。
- **KV `rules` 空值坑**：`GET /api/rules` 在 key 为空时返回兜底 `DEFAULT_RULES`，改规则后直查 KV `values/rules` 确认。
- 前端 `monitor.js` 依赖 `monitor.html` 里的元素 id，改布局别动 id。
- 数据源第三方公开接口，有变动/限流风险；`cache.ts` 做短期缓存。

## 修改约定（重要）

- 改规则 / 指标 / 信号逻辑时，**必须同步更新本文件 + `README.md`**。
- 改动要落在对应位置：
  - 需要**用户访问**的 → `pages/`（functions/api + functions/_lib + public）
  - **定时计算**的 → `worker/`（src）
- 共享逻辑（csindex / rules / treasury 等）在 `pages/functions/_lib/` 与 `worker/src/lib/` **各有一份**，改一处记得同步另一处（或评估是否只影响一侧）。
- 改默认规则要同步：`worker/src/lib/rules.ts` 和 `pages/functions/_lib/rules.ts` 的 `DEFAULT_RULES`、`pages/public/monitor.js` 的 `RULE_DOCS`、线上 KV `rules`。
- 部署：Pages `npx wrangler pages deploy pages/public --project-name quant`；Worker `cd worker && npx wrangler deploy`。
```
