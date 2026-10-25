# cloudflare-quant

统一的 Cloudflare 量化监控项目：**静态页面 + API + Cron 定时**，全部在一个 Worker 里，指标计算用 JS/TS 实现（**不依赖 Python / akshare**）。

## 功能

| 功能 | 接口 | 页面 |
|---|---|---|
| 个股多维度分析 | `GET /api/analyze?code=600000` | `/`（个股分析 tab） |
| 指数估值 | `GET /api/indexes` | `/`（指数估值 tab） |
| 信号规则管理 | `GET /api/rules`、`PUT /api/rules` | `/monitor.html`（监控规则 tab） |
| 信号运行状态 | `GET /api/results` | `/monitor.html`（运行状态 tab） |
| 定时计算（Cron） | Worker `scheduled` | 无（写回 KV） |

## 目录结构

```
src/
  index.ts            Worker 入口：/api/* 路由 + scheduled（cron）
  api/                API handler（analyze / indexes / rules / results）
  lib/
    csindex.ts        中证指数：PE 历史 / 百分位 / 当前股息率
    eastmoney.ts      东财行情（个股/板块）
    emfin.ts          东财财务数据（ROE/EPS/现金流等）
    analysis.ts       个股各维度分析逻辑
    treasury.ts       10Y 国债收益率（东财数据中心）
    rules.ts          规则模型 + 信号判定（applyRule）
    monitoring.ts     监控主流程：读规则 → 算指标 → 判信号 → 写 KV
    cache.ts / types.ts
public/
  index.html / app.js       个股分析 + 指数估值
  monitor.html / monitor.js 信号监控（规则管理 + 运行状态）
```

## 本地开发 / 部署

```bash
npm install
npx wrangler dev      # 本地跑（Miniflare，本地 KV）
npx wrangler deploy   # 部署到 Cloudflare
```

- **Cron**：`45 7 * * 1-5`（UTC）= 北京时间 15:45，周一到周五。
- **KV**：复用 `PE_HISTORY`（指数 PE 历史 + 个股分析缓存）和 `MONITOR_KV`（规则/结果/信号历史）。
- **静态资源**：由 Workers Static Assets 提供，`/api/*` 交给 Worker 路由。

## 指标（JS 实现，对应原 Python 版）

| indicator | 含义 | 数据源 |
|---|---|---|
| `erp_csi300` | 沪深300股权风险溢价 = (1/PE)×100 − 10Y国债 | csindex + 东财国债 |
| `pe_percentile_<code>` | 指数 PE 十年历史百分位（0–100） | csindex |
| `dividend_yield_<code>` | 指数最新股息率(%) | csindex indicator.xls |
| `dividend_spread_<code>` | 股息率 − 10Y国债收益率（百分点） | csindex + 东财国债 |

## 规则（默认 4 条，存 KV `rules`）

| 规则 | indicator | 方向 | BUY | SELL |
|---|---|---|---|---|
| 中证红利股息率−10Y国债利差 | `dividend_spread_000922` | high | ≥ 2.5（且股息率 > 国债） | ≤ 1 |
| 红利低波股息率 | `dividend_yield_H30269` | high | ≥ 4.5 | ≤ 3.0 |
| 沪深300 PE百分位 | `pe_percentile_000300` | low | ≤ 30 | ≥ 80 |
| 中证红利股息率 | `dividend_yield_000922` | high | ≥ 5.0 | ≤ 3.5 |

> 改规则/指标/信号逻辑时，代码与 `AGENTS.md` 的「信号监控」章节要保持同步。

## 数据源风险

全部依赖第三方公开接口（中证指数、东方财富），可能变动；`cache.ts` 用 Cache API 做了短期缓存，`csindex.ts` 对历史/当前数据做了 KV 缓存。
