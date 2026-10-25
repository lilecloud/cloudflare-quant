# quant

统一的 Cloudflare 量化监控项目：**静态页面 + API + Cron 定时**，全部运行在一个 Cloudflare Worker 内，指标计算用 TypeScript 实现（**不依赖 Python / akshare**），数据源直连中证指数与东方财富。

## 功能

| 功能 | 页面 | 接口 |
|---|---|---|
| 个股多维度分析 | `/`（个股分析 tab） | `GET /api/analyze?code=600000` |
| 指数估值 | `/`（指数估值 tab） | `GET /api/indexes` |
| 信号规则管理 | `/monitor`（监控规则 tab） | `GET /api/rules`、`PUT /api/rules` |
| 信号运行状态 | `/monitor`（运行状态 tab） | `GET /api/results` |
| 定时计算 | — | Worker `scheduled`（cron） |

## 架构

```
浏览器
  │
  ▼
Cloudflare Worker (src/index.ts)
  ├─ /api/*            → src/api/* 路由分发
  ├─ 其它路径          → public/ 静态资源（Workers Static Assets）
  └─ scheduled(cron)   → src/lib/monitoring.ts
                             │
                             ▼
                    KV: PE_HISTORY / MONITOR_KV
```

## 目录结构

```
.
├── wrangler.toml          # Worker 名、assets、cron、KV 绑定
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts           # Worker 入口：fetch 路由 + scheduled
│   ├── api/               # API handler（analyze / indexes / rules / results / monitor-shared）
│   └── lib/
│       ├── csindex.ts      中证指数：PE 历史 / 百分位 / 当前股息率
│       ├── eastmoney.ts    东财行情（个股、板块）
│       ├── emfin.ts        东财财务数据（ROE / EPS / 现金流等）
│       ├── analysis.ts     个股各维度分析逻辑
│       ├── treasury.ts     10Y 国债收益率（东财数据中心）
│       ├── rules.ts        规则模型 + 信号判定（applyRule）
│       ├── monitoring.ts   监控主流程：读规则 → 算指标 → 判信号 → 写 KV
│       ├── cache.ts        Cache API 封装
│       └── indexes.ts / types.ts
└── public/
    ├── index.html / app.js      个股分析 + 指数估值
    └── monitor.html / monitor.js 信号监控（规则管理 + 运行状态）
```

## API 说明

### `GET /api/analyze?code=<6位代码>`

个股多维度分析。返回：

```jsonc
{
  "stock": { "code", "name", "industry" },
  "pe": {...}, "roe": {...}, "eps": {...}, "debt": {...},
  "cashflow": {...}, "revenue": {...}, "margin": {...}, "fcf": {...},
  "valuation": {...}, "cashRatio": {...}, "goodwill": {...},
  "liquidity": {...}, "peg": {...}
}
```

### `GET /api/indexes`

返回 16 个指数的估值：`{ "items": [...], "updated": "refreshed" | "cached" }`。

### `GET /api/rules`

返回 KV `rules` 中的规则数组；KV 为空时返回默认 4 条。

### `PUT /api/rules`

请求体为规则数组（整体覆盖保存）。每项结构：

```json
{ "id": "div_spread_000922", "name": "…", "enabled": true,
  "indicator": "dividend_spread_000922", "direction": "high",
  "buyThreshold": 2.5, "sellThreshold": 1.0 }
```

### `GET /api/results`

返回最新结果与信号历史：`{ "results": { "updatedAt", "items" }, "signalLog": [...] }`。

## 指标（indicator）

| indicator | 含义 | 数据源 |
|---|---|---|
| `erp_csi300` | 沪深300股权风险溢价 = (1/PE)×100 − 10Y国债 | csindex + 东财国债 |
| `pe_percentile_<code>` | 指数 PE 十年历史百分位（0–100，越低越低估） | csindex |
| `dividend_yield_<code>` | 指数最新股息率(%) | csindex indicator.xls |
| `dividend_spread_<code>` | 股息率 − 10Y国债收益率（百分点） | csindex + 东财国债 |

## 规则与信号

- `direction: "high"`：值 ≥ buyThreshold → BUY；值 ≤ sellThreshold → SELL；中间 HOLD。
- `direction: "low"`：值 ≤ buyThreshold → BUY；值 ≥ sellThreshold → SELL；中间 HOLD。
- **股息率利差规则硬门槛**：`dividend_spread_*` 必须同时满足「股息率 > 国债利率」（差值 > 0）才允许 BUY，否则强制 HOLD。
- 只在信号「发生变化」时写入 `signal_log`（保留最近 50 条）。

默认规则：

| 规则 | indicator | 方向 | BUY | SELL |
|---|---|---|---|---|
| 中证红利股息率−10Y国债利差 | `dividend_spread_000922` | high | ≥ 2.5（且股息率 > 国债） | ≤ 1 |
| 红利低波股息率 | `dividend_yield_H30269` | high | ≥ 4.5 | ≤ 3.0 |
| 沪深300 PE百分位 | `pe_percentile_000300` | low | ≤ 30 | ≥ 80 |
| 中证红利股息率 | `dividend_yield_000922` | high | ≥ 5.0 | ≤ 3.5 |

## KV 结构

| KV 命名空间 | key | 内容 |
|---|---|---|
| `PE_HISTORY` | `pe:<code>` / `meta:last_updated` / `stock:<code>:<date>` | 指数 PE 历史、全局刷新标记、个股分析缓存 |
| `MONITOR_KV` | `rules` / `results` / `signal_log` | 规则数组、最新结果、信号变化历史 |

## 部署

### 前置

- Node.js 18+
- 一个 Cloudflare 账号

### 首次部署

1. 安装依赖：`npm install`
2. 登录：`npx wrangler login`
3. 创建 KV 命名空间（首次）：
   ```bash
   npx wrangler kv namespace create PE_HISTORY
   npx wrangler kv namespace create MONITOR_KV
   ```
   把返回的 `id` 填进 `wrangler.toml` 的对应位置。
4. 部署：`npx wrangler deploy`

部署成功后 Worker 的地址形如 `https://quant.<你的子域>.workers.dev`。

### Cron

`wrangler.toml` 中：

```toml
[triggers]
crons = ["45 7 * * 1-5"]
```

`45 7 * * 1-5`（UTC）= 北京时间 15:45，周一到周五。节假日也会触发，但数据不变，只会用上一交易日的数据重算（无副作用）。

## 本地开发

```bash
npm install
npx wrangler dev            # 本地 Miniflare，含本地 KV
npx wrangler deploy --dry-run   # 只打包不部署，验证能否编译
```

测试 cron 本地触发：`npx wrangler dev --test-scheduled`，然后访问 `http://127.0.0.1:8787/__scheduled`。

## 数据源与风险

- 中证指数：`csindex.com.cn`（PE 历史 / 指数估值）
- 东方财富：`eastmoney.com`（行情、财务、国债收益率）

均为第三方公开接口，存在变动/限流风险。`cache.ts` 用 Cache API 做了短期缓存，`csindex.ts` 对 PE 历史做了 KV 缓存以降低请求频率。
