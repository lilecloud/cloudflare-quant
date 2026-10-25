# AGENTS.md

面向在这个项目上工作的 AI / 开发者的说明。

## 项目简介

统一的 Cloudflare 量化监控项目：**一个 Worker 同时提供 静态页面 + API + Cron 定时 + 邮件通知**。指标计算用 TypeScript 实现（不依赖 Python / akshare），数据源直连中证指数与东方财富。

- 线上：`https://quant.lile-0126.workers.dev`（受 **Cloudflare Access** 保护）
- 仓库：`lilecloud/cloudflare-quant`
- 详细功能/API/部署见 `README.md`，本文件侧重「改代码时要遵守什么」。

## 快速命令

```bash
npm install                       # 安装依赖
npx wrangler dev                  # 本地开发（Miniflare + 本地 KV）
npx wrangler deploy               # 部署到 Cloudflare
npx wrangler deploy --dry-run     # 只打包不部署，验证能否编译
npx wrangler secret put RESEND_API_KEY   # 设置邮件密钥（Resend）
node --check public/monitor.js    # 前端 JS 语法检查
```

本地测试 cron：`npx wrangler dev --test-scheduled`，然后请求 `http://127.0.0.1:8787/__scheduled?cron=45+7+*+*+1-5`。

## 目录结构

```
src/
  index.ts          Worker 入口：/api/* 路由 + scheduled + /api/test-email
  api/              API handler（analyze / indexes / rules / results / monitor-shared）
  lib/
    csindex.ts      中证指数：PE 历史 / 百分位 / 当前股息率
    eastmoney.ts    东财行情（个股、板块）—— push2，云端受限，见「已知限制」
    emfin.ts        东财财务数据（ROE / EPS / 现金流等）
    analysis.ts     个股各维度分析
    treasury.ts     10Y 国债收益率（东财数据中心）
    rules.ts        规则模型 + DEFAULT_RULES + applyRule
    monitoring.ts   监控主流程：读规则 → 算指标 → 判信号 → 写 KV → 发邮件
    notify.ts       邮件通知（Resend）
    cache.ts / types.ts / indexes.ts
public/
  index.html / app.js       个股分析 + 指数估值
  monitor.html / monitor.js 信号监控（规则管理 + 运行状态）
wrangler.toml                 Worker 名 / assets / cron / KV / vars
```

## 指标（indicator）

| indicator | 含义 | 数据源 |
|---|---|---|
| `erp_csi300` | 沪深300股权风险溢价 = (1/PE)×100 − 10Y国债 | csindex + 东财国债 |
| `pe_percentile_<code>` | 指数 PE 十年历史百分位（0–100） | csindex |
| `dividend_yield_<code>` | 指数最新股息率(%) | csindex indicator.xls |
| `dividend_spread_<code>` | 股息率 − 10Y国债收益率（百分点） | csindex + 东财国债 |

## 默认规则（`src/lib/rules.ts` 的 `DEFAULT_RULES`）

| 规则 | indicator | 方向 | BUY | SELL |
|---|---|---|---|---|
| 中证红利股息率−10Y国债利差 | `dividend_spread_000922` | high | ≥ 2.5（且股息率 > 国债） | ≤ 1 |
| 红利低波股息率 | `dividend_yield_H30269` | high | ≥ 4.5 | ≤ 3.0 |
| 沪深300 PE百分位 | `pe_percentile_000300` | low | ≤ 30 | ≥ 80 |
| 中证红利股息率 | `dividend_yield_000922` | high | ≥ 5.0 | ≤ 3.5 |

## 信号逻辑（`monitoring.ts` 的 `applyRule` + `buildReason`）

- `direction: high`：值 ≥ buyThreshold → BUY；值 ≤ sellThreshold → SELL；中间 HOLD。
- `direction: low`：值 ≤ buyThreshold → BUY；值 ≥ sellThreshold → SELL；中间 HOLD。
- **股息率利差硬门槛**：`dividend_spread_*` 必须「股息率 > 国债利率」（差值 > 0）才允许 BUY，否则强制 HOLD。
- 只在信号「发生变化」时写 `signal_log` + 发邮件；首次运行不发。

## 结果数据结构（`RuleResult`，写入 KV `results`）

```jsonc
{
  "ruleId": "div_spread_000922",
  "name": "中证红利股息率−10Y国债利差",
  "indicator": "dividend_spread_000922",
  "value": 2.55,
  "signal": "BUY",            // BUY | HOLD | SELL | ERROR
  "prevSignal": "HOLD",
  "changed": true,
  "message": "",
  "reason": "值 2.55 ≥ BUY 阈值 2.5 → 买入",
  "detail": { "dividendYield": 4.19, "treasuryYield": 1.64, "spread": 2.55 },
  "updatedAt": "2026-10-25T06:00:00Z"
}
```

- `detail`：底层原始数据（前端 `monitor.js` 的 `formatDetail` 负责格式化）。
- `reason`：命中说明（哪条阈值触发了信号）。
- 前端结果表展示：规则 / 当前值 / **底层数据 detail** / 信号 / **命中原因 reason** / 更新时间。

## 邮件通知（`notify.ts`）

- 信号变化时经 **Resend** HTTP API 发送，正文含底层数据与命中原因。
- secret：`RESEND_API_KEY`（`npx wrangler secret put`）；vars：`ALERT_TO` / `ALERT_FROM`（`wrangler.toml` 的 `[vars]`）。
- 手动测试：`GET /api/test-email`（需已登录 Access）。
- Resend 免费无域名时只能发到注册邮箱。

## 已知限制

- **个股分析 `/api/analyze` 云端可能 502**：依赖东财 `push2`，该接口按 IP 拦 Cloudflare 边缘，加 UA / 重试无效。个股分析请用本地 Python `stock_analyzer.py`。
- 指数估值、信号监控**不受影响**（走中证指数 `csindex` + 东财数据中心 `datacenter`）。

## Watch out

- 站点受 **Access 保护**，`curl` 线上会被 302 跳登录页；本地验证用 `npx wrangler dev`（含本地 KV）。
- **KV `rules` 空值坑**：`GET /api/rules` 在 key 为空时返回兜底 `DEFAULT_RULES`，别误以为已保存。改规则后直查 KV `values/rules` 确认。
- 前端 `monitor.js` 依赖 `index.html`/`monitor.html` 中的元素 id，改布局别动 id。
- 数据源均为第三方公开接口，有变动/限流风险；`cache.ts` 做了短期缓存。

## 修改约定（重要）

- 改规则 / 指标 / 信号逻辑时，**必须同步更新本文件 + `README.md`**。
- 改默认规则要同步：`src/lib/rules.ts` 的 `DEFAULT_RULES`、`public/monitor.js` 的 `RULE_DOCS`（规则说明弹窗）、线上 KV `rules`。
- 改完：`npx wrangler deploy --dry-run` 验证编译 → `npx wrangler dev --test-scheduled` 触发 cron 核对 `results` → `npx wrangler deploy` 部署 → 提交推送。
