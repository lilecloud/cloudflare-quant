# quant

Cloudflare 量化监控项目，采用 **Pages（页面+API）+ Worker（Cron 定时+邮件）** 双项目结构：

- **Pages** `${pages_name}.pages.dev` — 用户访问的页面和 API（国内可访问）
- **Worker** `quant.<subdomain>.workers.dev` — 只跑定时计算和邮件通知（workers.dev 国内被墙，但 cron 服务端照常执行）
- 两者共用同一套 KV（`PE_HISTORY` / `MONITOR_KV`）

## 为什么拆两个

`workers.dev` 在国内被 GFW DNS 污染（打不开），而 `pages.dev` 正常。所以：
- 用户访问的页面/API 放 Pages（pages.dev）；
- 定时任务放 Worker（不依赖用户访问，cron 由 Cloudflare 服务端触发）。

## 目录结构

```
pages/                     # Cloudflare Pages 项目
  functions/api/           # /api/* 路由（analyze / indexes / rules / results）
  functions/_lib/          # 页面/API 用到的数据逻辑（csindex、eastmoney 等）
  public/                  # 静态页面（index.html / monitor.html / app.js / monitor.js）
  wrangler.toml

worker/                    # Cloudflare Worker 项目（只跑 cron）
  src/index.ts             # scheduled 定时入口
  src/lib/                 # 定时计算所需逻辑（monitoring / treasury / notify 等）
  wrangler.toml

package.json               # 两个项目共用依赖（wrangler + xlsx）
tsconfig.json
README.md
AGENTS.md
```

## 功能

| 功能 | 地址 |
|---|---|
| 个股多维度分析 | Pages `/`（个股分析 tab）⚠️ 云端受限，见「已知限制」 |
| 指数估值 | Pages `/`（指数估值 tab） |
| 信号规则管理 / 运行状态 | Pages `/monitor` |
| 定时计算（cron） | Worker `scheduled`，`45 7 * * 1-5`（UTC）= 北京 15:45 |
| 信号变化邮件通知 | Worker cron 内，经 Resend 发送 |

## API（Pages）

| 接口 | 说明 |
|---|---|
| `GET /api/analyze?code=600000` | 个股分析（⚠️ 可能 502） |
| `GET /api/indexes` | 16 个指数估值 |
| `GET /api/rules` | 规则数组（空则返回默认 4 条） |
| `PUT /api/rules` | 覆盖保存规则 |
| `GET /api/results` | 最新结果（含 `detail` 底层数据、`reason` 命中原因）+ 信号历史 |
| `GET /api/test-email` | 手动发测试邮件（需配 `RESEND_API_KEY`） |
| `GET /api/run-monitor` | 手动触发一次计算 |

## 指标 / 规则 / 信号

| indicator | 含义 | 数据源 |
|---|---|---|
| `erp_csi300` | 沪深300股权风险溢价 = (1/PE)×100 − 10Y国债 | csindex + 东财国债 |
| `pe_percentile_<code>` | 指数 PE 十年历史百分位（0–100） | csindex |
| `dividend_yield_<code>` | 指数最新股息率(%) | csindex indicator.xls |
| `dividend_spread_<code>` | 股息率 − 10Y国债收益率（百分点） | csindex + 东财国债 |

- `direction: high`：值 ≥ buyThreshold → BUY；值 ≤ sellThreshold → SELL；中间 HOLD。
- `direction: low`：值 ≤ buyThreshold → BUY；值 ≥ sellThreshold → SELL；中间 HOLD。
- **股息率利差硬门槛**：`dividend_spread_*` 必须「股息率 > 国债利率」（差值 > 0）才允许 BUY。
- 只在信号变化时写 `signal_log` + 发邮件。

默认规则：

| 规则 | indicator | 方向 | BUY | SELL |
|---|---|---|---|---|
| 中证红利股息率−10Y国债利差 | `dividend_spread_000922` | high | ≥ 2.5（且股息率 > 国债） | ≤ 1 |
| 红利低波股息率 | `dividend_yield_H30269` | high | ≥ 4.5 | ≤ 3.0 |
| 沪深300 PE百分位 | `pe_percentile_000300` | low | ≤ 30 | ≥ 80 |
| 中证红利股息率 | `dividend_yield_000922` | high | ≥ 5.0 | ≤ 3.5 |

## 结果数据（KV `results`）

```jsonc
{
  "ruleId": "div_spread_000922", "name": "…", "indicator": "dividend_spread_000922",
  "value": 2.55, "signal": "BUY", "prevSignal": "HOLD", "changed": true,
  "reason": "值 2.55 ≥ BUY 阈值 2.5 → 买入",
  "detail": { "dividendYield": 4.19, "treasuryYield": 1.64, "spread": 2.55 },
  "updatedAt": "2026-10-25T07:45:24Z"
}
```

## 邮件通知

- Worker cron 阶段，信号变化时经 **Resend** 发邮件。
- secret：`RESEND_API_KEY`（在 `worker/` 目录执行 `npx wrangler secret put RESEND_API_KEY`）。
- vars：`ALERT_TO`（默认 `lile_0126@126.com`）/ `ALERT_FROM`（`worker/wrangler.toml`）。
- Resend 免费无域名时只能发到注册邮箱。

## 部署

```bash
npm install

# 部署 Pages（页面 + API）
cd pages
npx wrangler pages deploy public --project-name quant --commit-dirty=true

# 部署 Worker（cron）
cd ../worker
npx wrangler deploy
```

首次创建 Pages 项目：`npx wrangler pages project create quant --production-branch main`。

## 已知限制

- **个股分析 `/api/analyze` 在云端可能 502**：依赖东财 `push2`，该接口按 IP 拦 Cloudflare 边缘，加 UA/重试无效。个股分析请用本地 Python `stock_analyzer.py`。
- 指数估值、信号监控不受影响（走中证指数 + 东财数据中心）。
- `workers.dev` 国内被 DNS 污染，Worker 的 URL 打不开——但 cron 服务端照常执行，不影响功能。
```
