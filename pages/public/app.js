const codeInput = document.getElementById('codeInput');
const searchBtn = document.getElementById('searchBtn');
const loading = document.getElementById('loading');
const errorDiv = document.getElementById('error');
const stockHeader = document.getElementById('stockHeader');
const historyDiv = document.getElementById('history');
const historyList = document.getElementById('historyList');
const clearBtn = document.getElementById('clearHistory');
let currentCode = '';

const HISTORY_KEY = 'stock_analyzer_history';
const MAX_HISTORY = 20;

function $(id) { return document.getElementById(id); }

// ── History ──────────────────────────────────────

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

function addHistory(code, name) {
  const items = loadHistory().filter(h => h.code !== code);
  items.unshift({ code, name });
  if (items.length > MAX_HISTORY) items.length = MAX_HISTORY;
  saveHistory(items);
  renderHistory();
}

function renderHistory() {
  const items = loadHistory();
  if (!items.length) {
    historyDiv.style.display = 'none';
    return;
  }
  historyDiv.style.display = 'block';
  historyList.innerHTML = items.map(h =>
    `<span class="history-item" data-code="${h.code}"><span class="h-code">${h.code}</span><span class="h-name">${h.name}</span></span>`
  ).join('');
}

function clearHistory() {
  saveHistory([]);
  renderHistory();
}

clearBtn.addEventListener('click', clearHistory);

historyList.addEventListener('click', e => {
  const item = e.target.closest('.history-item');
  if (!item) return;
  const code = item.dataset.code;
  codeInput.value = code;
  analyze(code);
});

renderHistory();

searchBtn.addEventListener('click', () => {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showError('请输入6位数字股票代码');
    return;
  }
  analyze(code);
});

codeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') searchBtn.click();
});

function showLoading(v) {
  loading.style.display = v ? 'block' : 'none';
  searchBtn.disabled = v;
}

function showError(msg) {
  errorDiv.textContent = msg;
  errorDiv.style.display = 'block';
  stockHeader.style.display = 'none';
  document.querySelectorAll('.dim').forEach(d => d.style.display = 'none');
}

function hideError() { errorDiv.style.display = 'none'; }

async function analyze(code) {
  hideError();
  showLoading(true);

  try {
    const res = await fetch(`/api/analyze?code=${code}`);
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      return;
    }

    render(data);
    addHistory(data.stock.code, data.stock.name);
  } catch (e) {
    console.error('analyze error:', e);
    showError('网络请求失败：' + (e.message || '请检查网络后重试'));
  } finally {
    showLoading(false);
  }
}

function render(data) {
  const { stock, pe, roe, eps, debt, cashflow, revenue, margin, fcf, valuation, cashRatio, goodwill, liquidity, peg } = data;
  currentCode = stock.code;

  // header
  $('stockName').textContent = stock.name;
  $('stockCode').textContent = `(${stock.code})`;
  $('stockIndustry').textContent = `行业：${stock.industry}`;
  stockHeader.style.display = 'block';

  renderPE(pe);
  renderROE(roe);
  renderEPS(eps);
  renderDebt(debt);
  renderCashflow(cashflow);
  renderRevenue(revenue);
  renderMargin(margin);
  renderFCF(fcf);
  renderValuation(valuation);
  renderCashRatio(cashRatio);
  renderGoodwill(goodwill);
  renderLiquidity(liquidity);
  renderPEG(peg);
}

// ─── PE ────────────────────────────────────────

function renderPE(result) {
  const dim = $('dimPe');
  dim.style.display = 'block';
  const body = $('peBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('peIcon', 'warn');
    return;
  }

  const peStr = fmt(result.stock_pe);
  const pbStr = fmt(result.stock_pb);
  let rankStr = '';
  if (result.rank === -1) {
    rankStr = '亏损股（负市盈率）';
  } else if (result.rank != null) {
    const pct = (result.rank / result.rank_total * 100).toFixed(1);
    rankStr = `${result.rank}/${result.rank_total}（前${pct}%）`;
  }

  let html = `<div class="stat">行业：<strong>${result.board_name}</strong>（共${result.total}只，正PE ${result.positive_count}只，负PE ${result.negative_count}只）</div>`;
  html += `<div class="stat">市盈率：<strong>${peStr}</strong> ｜ 市净率：<strong>${pbStr}</strong></div>`;
  if (rankStr) html += `<div class="stat">排名：<strong>${rankStr}</strong></div>`;

  if (result.lowest.length) {
    html += '<br><div class="stat">行业 PE 最低 TOP5：</div>';
    html += buildTable(result.lowest, currentCode, true);
  }
  if (result.highest.length) {
    html += '<br><div class="stat">行业 PE 最高 TOP5：</div>';
    html += buildTable(result.highest, currentCode, false);
  }
  if (result.negative_pe.length) {
    html += `<br><div class="stat">亏损股（负市盈率，共${result.negative_count}只）：</div>`;
    html += buildTable(result.negative_pe, currentCode, false);
  }

  body.innerHTML = html;
  setIcon('peIcon', result.rank != null && result.rank > 0 ? 'pass' : (result.rank === -1 ? 'warn' : 'warn'));
}

// ─── ROE ────────────────────────────────────────

function renderROE(result) {
  $('dimRoe').style.display = 'block';
  const body = $('roeBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('roeIcon', 'warn');
    return;
  }

  let html = `<div class="stat">阈值：ROE > ${result.threshold}%</div><br>`;
  for (const [year, val, ok] of result.records) {
    const v = val != null ? `${val.toFixed(2)}%` : 'N/A';
    const mark = val != null ? (ok ? '✓' : '✗') : '—';
    const cls = ok ? 'pass' : 'fail';
    html += `<div class="rec"><span class="year">${year}</span><span><span class="val">${v}</span><span class="mark ${cls}">${mark}</span></span></div>`;
  }
  html += `\n<div class="conclusion ${result.all_pass ? 'pass' : 'fail'}">${result.all_pass ? '✅ 连续5年 ROE > ' + result.threshold + '%' : '❌ 未连续5年 ROE > ' + result.threshold + '%'}</div>`;
  body.innerHTML = html;
  setIcon('roeIcon', result.all_pass ? 'pass' : 'fail');
}

// ─── EPS ────────────────────────────────────────

function renderEPS(result) {
  $('dimEps').style.display = 'block';
  const body = $('epsBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('epsIcon', 'warn');
    return;
  }

  let html = '';
  for (let i = 0; i < result.records.length; i++) {
    const [year, eps, change, changePct, grew] = result.records[i];
    if (eps == null) {
      html += `<div class="rec"><span class="year">${year}</span><span>N/A</span></div>`;
      continue;
    }
    if (i === 0) {
      html += `<div class="rec"><span class="year">${year}</span><span>${eps.toFixed(4)}（基准）</span></div>`;
    } else {
      const c = change != null ? (change >= 0 ? '+' : '') + change.toFixed(4) : 'N/A';
      const p = changePct != null ? (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%' : 'N/A';
      const mark = grew ? '✓' : '✗';
      const cls = grew ? 'pass' : 'fail';
      html += `<div class="rec"><span class="year">${year}</span><span>${eps.toFixed(4)} &nbsp;${c}（${p}）<span class="mark ${cls}">${mark}</span></span></div>`;
    }
  }
  html += `\n<div class="conclusion ${result.all_grew ? 'pass' : 'fail'}">${result.all_grew ? '✅ 连续5年每股收益持续增长' : '❌ 未连续5年每股收益增长'}</div>`;
  body.innerHTML = html;
  setIcon('epsIcon', result.all_grew ? 'pass' : 'fail');
}

// ─── Debt ────────────────────────────────────────

function renderDebt(result) {
  $('dimDebt').style.display = 'block';
  const body = $('debtBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('debtIcon', 'warn');
    return;
  }

  let html = '<div class="stat">阈值：资产负债率 > 70% 触发警告</div><br>';
  for (const [year, val, over] of result.records) {
    const v = val != null ? `${val.toFixed(2)}%` : 'N/A';
    const mark = over ? '⚠' : '✓';
    const cls = over ? 'fail' : 'pass';
    html += `<div class="rec"><span class="year">${year}</span><span><span class="val">${v}</span><span class="mark ${cls}">${mark}</span></span></div>`;
  }

  if (result.warned) {
    let maxVal = -Infinity, maxYear = '';
    for (const [y, v] of result.records) {
      if (v != null && v > maxVal) { maxVal = v; maxYear = y; }
    }
    html += `\n<div class="conclusion warn">⚠ 警告：资产负债率超过70%（最高 ${maxVal.toFixed(2)}%，${maxYear}年）</div>`;
  } else {
    html += '\n<div class="conclusion pass">✅ 负债率健康，未超过70%</div>';
  }
  body.innerHTML = html;
  setIcon('debtIcon', result.warned ? 'warn' : 'pass');
}

// ─── Cashflow ────────────────────────────────────

function renderCashflow(result) {
  $('dimCf').style.display = 'block';
  const body = $('cfBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('cfIcon', 'warn');
    return;
  }

  let html = '<div class="stat">阈值：每股经营现金流 > 0</div><br>';
  for (const [year, val, ok] of result.records) {
    const v = val != null ? val.toFixed(4) : 'N/A';
    const mark = ok ? '✓' : '✗';
    const cls = ok ? 'pass' : 'fail';
    html += `<div class="rec"><span class="year">${year}</span><span><span class="val">${v}</span><span class="mark ${cls}">${mark}</span></span></div>`;
  }
  html += `\n<div class="conclusion ${result.all_positive ? 'pass' : 'fail'}">${result.all_positive ? '✅ 连续5年经营现金流净额为正' : '❌ 存在经营现金流净额为负的年份'}</div>`;
  body.innerHTML = html;
  setIcon('cfIcon', result.all_positive ? 'pass' : 'fail');
}

// ─── Revenue growth (A档) ────────────────────────

function renderRevenue(result) {
  $('dimRevenue').style.display = 'block';
  const body = $('revenueBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('revenueIcon', 'warn');
    return;
  }

  let html = '<div class="stat">阈值：营收同比增长率 > 0</div><br>';
  for (const [year, val, ok] of result.records) {
    const v = val != null ? `${val >= 0 ? '+' : ''}${val.toFixed(2)}%` : 'N/A';
    const mark = val != null ? (ok ? '✓' : '✗') : '—';
    const cls = ok ? 'pass' : 'fail';
    html += `<div class="rec"><span class="year">${year}</span><span><span class="val">${v}</span><span class="mark ${cls}">${mark}</span></span></div>`;
  }
  html += `\n<div class="conclusion ${result.all_grew ? 'pass' : 'fail'}">${result.all_grew ? '✅ 连续5年营收正增长' : '❌ 存在营收负增长年份'}</div>`;
  body.innerHTML = html;
  setIcon('revenueIcon', result.all_grew ? 'pass' : 'fail');
}

// ─── Margin (A档) ───────────────────────────────

function renderMargin(result) {
  $('dimMargin').style.display = 'block';
  const body = $('marginBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('marginIcon', 'warn');
    return;
  }

  let html = '<div class="stat">盈利质量：毛利率 & 净利率（年报）</div><br>';
  for (const r of result.records) {
    const gm = r.grossMargin != null ? r.grossMargin.toFixed(2) + '%' : '—';
    const nm = r.netMargin != null ? r.netMargin.toFixed(2) + '%' : '—';
    html += `<div class="rec"><span class="year">${r.reportDate.slice(0, 7)}</span><span>毛利 <span class="val">${gm}</span> ｜ 净利 <span class="val">${nm}</span></span></div>`;
  }

  let conclusion = '';
  let cls = 'pass';
  if (result.note) {
    conclusion = `<div class="conclusion warn">⚠ ${result.note}</div>`;
    cls = 'warn';
  } else if (result.gross_ok === true && result.net_ok === true) {
    conclusion = '<div class="conclusion pass">✅ 毛利率为正且稳定，净利率为正</div>';
  } else if (result.gross_ok === false || result.net_ok === false) {
    conclusion = '<div class="conclusion fail">❌ 毛利率下滑或净利率为负，盈利质量堪忧</div>';
    cls = 'fail';
  } else {
    conclusion = '<div class="conclusion warn">⚠ 毛利率/净利率数据部分缺失</div>';
    cls = 'warn';
  }
  html += '\n' + conclusion;
  body.innerHTML = html;
  setIcon('marginIcon', cls);
}

// ─── Free cash flow (A档) ────────────────────────

function renderFCF(result) {
  $('dimFcf').style.display = 'block';
  const body = $('fcfBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('fcfIcon', 'warn');
    return;
  }

  let html = '<div class="stat">自由现金流 = 经营现金流 − 资本开支（年报，单位：亿元）</div><br>';
  for (const r of result.records) {
    const fcf = r.freeCashflow != null ? (r.freeCashflow / 1e8).toFixed(1) : 'N/A';
    const op = r.operateCashflow != null ? (r.operateCashflow / 1e8).toFixed(0) : 'N/A';
    const cap = r.capex != null ? (r.capex / 1e8).toFixed(0) : 'N/A';
    const ok = r.freeCashflow != null && r.freeCashflow > 0;
    const mark = ok ? '✓' : '✗';
    const cls = ok ? 'pass' : 'fail';
    html += `<div class="rec"><span class="year">${r.year}</span><span><span class="val">${fcf}</span>（经营 ${op} − 资本开支 ${cap}）<span class="mark ${cls}">${mark}</span></span></div>`;
  }
  html += `\n<div class="conclusion ${result.all_positive ? 'pass' : 'fail'}">${result.all_positive ? '✅ 连续5年自由现金流为正（真金白银）' : '❌ 存在自由现金流为负的年份（扩张烧钱或利润含金量不足）'}</div>`;
  body.innerHTML = html;
  setIcon('fcfIcon', result.all_positive ? 'pass' : 'fail');
}

// ─── Valuation percentile (A档) ──────────────────

function renderValuation(result) {
  $('dimValuation').style.display = 'block';
  const body = $('valuationBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('valuationIcon', 'warn');
    return;
  }

  let level, cls;
  if (result.percentile <= 20) { level = '低估区'; cls = 'pass'; }
  else if (result.percentile <= 50) { level = '中低位'; cls = 'pass'; }
  else if (result.percentile <= 80) { level = '中高位'; cls = 'fail'; }
  else { level = '高估区'; cls = 'fail'; }

  const pct = result.percentile.toFixed(1);
  const markerPct = Math.min(98, Math.max(2, result.percentile));

  let html = `<div class="stat">当前 PE(TTM)：<strong>${result.pe_ttm.toFixed(2)}</strong> ｜ 历史区间：${result.min} ~ ${result.max}（中位数 ${result.median}）</div>`;
  html += `<div class="stat">历史样本：${result.sample_count} 个交易日</div><br>`;
  html += `<div class="i-bar-wrap" style="max-width:400px">
    <div class="i-bar-bg"></div>
    <div class="i-bar-marker" style="left:${markerPct}%"></div>
    <div class="i-bar-val" style="left:${markerPct}%;color:${levelColor(cls === 'pass' ? 'est' : 'hot')}">${pct}%</div>
  </div>`;
  html += `\n<div class="conclusion ${cls}">当前 PE 处于历史 <strong>${pct}%</strong> 分位（${level}）</div>`;
  body.innerHTML = html;
  setIcon('valuationIcon', cls);
}

// ─── Cash ratio (B档) ────────────────────────────

function renderCashRatio(result) {
  $('dimCashRatio').style.display = 'block';
  const body = $('cashRatioBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('cashRatioIcon', 'warn');
    return;
  }

  let html = '<div class="stat">净现比 = 每股经营现金流 ÷ 每股收益（≥1 为佳，利润有现金支撑）</div><br>';
  for (const [year, cf, e, ok] of result.records) {
    const cfStr = cf != null ? cf.toFixed(2) : 'N/A';
    const eStr = e != null ? e.toFixed(2) : 'N/A';
    const ratio = cf != null && e != null && e !== 0 ? (cf / e).toFixed(2) : '—';
    const mark = ok ? '✓' : '✗';
    const cls = ok ? 'pass' : 'fail';
    html += `<div class="rec"><span class="year">${year}</span><span>现金流 ${cfStr} ÷ EPS ${eStr} = <span class="val">${ratio}</span><span class="mark ${cls}">${mark}</span></span></div>`;
  }
  html += `\n<div class="conclusion ${result.all_good ? 'pass' : 'fail'}">${result.all_good ? '✅ 连续5年净现比 ≥ 1，利润含金量高' : '❌ 存在净现比 < 1 的年份（利润缺乏现金支撑）'}</div>`;
  body.innerHTML = html;
  setIcon('cashRatioIcon', result.all_good ? 'pass' : 'fail');
}

// ─── Goodwill (B档) ──────────────────────────────

function renderGoodwill(result) {
  $('dimGoodwill').style.display = 'block';
  const body = $('goodwillBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('goodwillIcon', 'warn');
    return;
  }

  const gw = result.goodwill != null ? (result.goodwill / 1e8).toFixed(1) + '亿' : 'N/A';
  const eq = result.equity != null ? (result.equity / 1e8).toFixed(0) + '亿' : 'N/A';
  const cls = result.warn ? 'fail' : 'pass';
  const mark = result.warn ? '⚠' : '✓';

  let html = `<div class="stat">报告期：${result.reportDate}</div>`;
  html += `<div class="stat">商誉：<strong>${gw}</strong> ｜ 净资产：${eq}</div>`;
  html += `<div class="stat">商誉占净资产：<strong>${result.ratio.toFixed(2)}%</strong>（阈值 30%）</div>`;
  html += `\n<div class="conclusion ${cls}">${result.warn ? '⚠ 商誉占比超 30%，存在减值暴雷风险' : '✅ 商誉占比 < 30%，减值风险可控'} ${mark}</div>`;
  body.innerHTML = html;
  setIcon('goodwillIcon', cls);
}

// ─── Liquidity (B档) ─────────────────────────────

function renderLiquidity(result) {
  $('dimLiquidity').style.display = 'block';
  const body = $('liquidityBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('liquidityIcon', 'warn');
    return;
  }

  let html = '<div class="stat">阈值：流动比率 > 1 且 速动比率 > 0.5</div><br>';
  for (const [year, cur, quick, ok] of result.records) {
    const c = cur != null ? cur.toFixed(2) : 'N/A';
    const q = quick != null ? quick.toFixed(2) : 'N/A';
    const mark = ok ? '✓' : '✗';
    const cls = ok ? 'pass' : 'fail';
    html += `<div class="rec"><span class="year">${year}</span><span>流动 <span class="val">${c}</span> ｜ 速动 <span class="val">${q}</span><span class="mark ${cls}">${mark}</span></span></div>`;
  }
  html += `\n<div class="conclusion ${result.all_ok ? 'pass' : 'fail'}">${result.all_ok ? '✅ 短期偿债能力良好' : '❌ 流动/速动比率偏低，短期偿债承压'}</div>`;
  body.innerHTML = html;
  setIcon('liquidityIcon', result.all_ok ? 'pass' : 'fail');
}

// ─── PEG (B档) ──────────────────────────────────

function renderPEG(result) {
  $('dimPeg').style.display = 'block';
  const body = $('pegBody');

  if (result.error) {
    body.innerHTML = `<span class="error-msg">⚠ ${result.error}</span>`;
    setIcon('pegIcon', 'warn');
    return;
  }

  const cls = result.peg < 1 ? 'pass' : result.peg < 1.5 ? 'pass' : 'fail';
  let html = `<div class="stat">PEG = PE ÷ 盈利增速：<strong>${result.peg.toFixed(2)}</strong></div>`;
  html += `<div class="stat">历史中位数：${result.median.toFixed(2)} ｜ 当前处于历史 ${result.percentile.toFixed(1)}% 分位（${result.sample_count} 个交易日）</div>`;
  html += `\n<div class="conclusion ${cls}">${result.level}</div>`;
  body.innerHTML = html;
  setIcon('pegIcon', cls);
}

// ─── Helpers ────────────────────────────────────

function setIcon(id, type) {
  const el = $(id);
  el.className = `icon ${type}`;
  el.textContent = type === 'pass' ? '✓' : type === 'fail' ? '✗' : '⚠';
}

function buildTable(items, targetCode, asc) {
  let rows = items.map((s, i) =>
    `<tr${s.code === targetCode ? ' class="target"' : ''}><td>${asc ? i + 1 : items.length - i}</td><td>${s.code}</td><td>${s.name}</td><td>${fmt(s.pe)}</td><td>${fmt(s.pb)}${s.code === targetCode ? ' ←' : ''}</td></tr>`
  );
  return `<table><thead><tr><th>#</th><th>代码</th><th>名称</th><th>市盈率</th><th>市净率</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function fmt(v) {
  if (v == null || v === undefined) return '-';
  return typeof v === 'number' ? v.toFixed(2) : String(v);
}

// ── Tabs ─────────────────────────────────────────

let idxLoaded = false;

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const tabName = t.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
    document.getElementById(tabName === 'stock' ? 'tabStock' : 'tabIndex').classList.add('active');

    if (tabName === 'index' && !idxLoaded) {
      idxLoaded = true;
      loadIndexes();
    }
  });
});

// ── Index Monitor ─────────────────────────────────

async function loadIndexes() {
  const loadingEl = document.getElementById('idxLoading');
  const errorEl = document.getElementById('idxError');
  loadingEl.style.display = 'block';
  errorEl.style.display = 'none';

  try {
    const res = await fetch('/api/indexes');
    const data = await res.json();
    if (data.error) {
      errorEl.textContent = data.error;
      errorEl.style.display = 'block';
      return;
    }
    renderIndexes(data.items);
    const updText = data.updated === 'refreshed' ? '数据已更新' : '来自缓存';
    document.getElementById('idxUpdated').textContent = updText + ' · ' + new Date().toLocaleDateString();
  } catch (e) {
    errorEl.textContent = '加载失败：' + (e.message || '请检查网络');
    errorEl.style.display = 'block';
  } finally {
    loadingEl.style.display = 'none';
  }
}

function renderIndexes(items) {
  const peItems = items.filter(i => i.valuation === 'PE');
  const nonPeItems = items.filter(i => i.valuation !== 'PE');

  const peTitle = document.getElementById('idxPeTitle');
  const nonPeTitle = document.getElementById('idxNonPeTitle');

  if (peItems.length) {
    peTitle.style.display = 'block';
    document.getElementById('idxList').innerHTML = peItems.map((item, i) => renderIndexCard(item, i)).join('');
  } else {
    peTitle.style.display = 'none';
    document.getElementById('idxList').innerHTML = '';
  }

  if (nonPeItems.length) {
    nonPeTitle.style.display = 'block';
    document.getElementById('idxNonPeList').innerHTML = nonPeItems.map((item, i) => renderIndexCard(item, i)).join('');
  } else {
    nonPeTitle.style.display = 'none';
    document.getElementById('idxNonPeList').innerHTML = '';
  }
}

function renderIndexCard(item, i) {
  const isPE = item.valuation === 'PE';
  const pct = item.percentile;
  let lvClass = 'est';
  if (!isPE) lvClass = 'na';
  else if (pct <= 10) lvClass = 'est';
  else if (pct <= 30) lvClass = 'under';
  else if (pct <= 70) lvClass = 'normal';
  else if (pct <= 90) lvClass = 'over';
  else lvClass = 'hot';

  // 非 PE 估值：不显示市盈率百分位条，改为显示估值方式标记
  if (!isPE) {
    const isDividend = item.valuation === 'DIVIDEND';
    const dy = isDividend ? item.dividendYield : null;
    const dyHtml = dy != null ? `<div class="i-stats"><span>股息率: <strong>${dy.toFixed(2)}%</strong></span></div>` : '';
    return `
    <div class="index-card">
      <div class="i-top">
        <span class="i-name">${item.name}</span>
        <span class="i-code">${item.code}</span>
        <span class="i-val-badge">${item.valuationLabel}估值</span>
      </div>
      ${dyHtml}
      <div class="i-note">${item.action}</div>
      <div class="i-footer">
        <span class="i-level ${lvClass}">${item.level}</span>
        <span class="i-action">不适用市盈率</span>
      </div>
    </div>`;
  }

  let deltaHtml = '';
  if (item.peDelta != null) {
    const sign = item.peDelta > 0 ? '+' : '';
    const color = item.peDelta > 0 ? '#f85149' : item.peDelta < 0 ? '#22c55e' : '#8b949e';
    deltaHtml = `<span style="color:${color};font-weight:bold">${sign}${item.peDelta}</span>`;
  }

  // Find marker position on gradient:
  // 0-10: green, 10-30: light green, 30-70: yellow, 70-90: orange, 90-100: red
  const markerPct = Math.min(98, Math.max(2, pct));

  return `
  <div class="index-card">
    <div class="i-top">
      <span class="i-name">${item.name}</span>
      <span class="i-code">${item.code}</span>
    </div>
    <div class="i-stats">
      <span>PE: <strong>${item.pe}</strong></span>
      <span>月变化: ${deltaHtml}</span>
    </div>
    <div class="i-bar-wrap">
      <div class="i-bar-bg"></div>
      <div class="i-bar-marker" style="left:${markerPct}%"></div>
      <div class="i-bar-val" style="left:${markerPct}%;color:${levelColor(lvClass)}">${pct}%</div>
    </div>
    <div class="i-footer">
      <span class="i-level ${lvClass}">${item.level}</span>
      <span class="i-action">${item.action} · ${item.multiple}x</span>
    </div>
  </div>`;
}

function levelColor(cls) {
  const map = {
    est: '#22c55e', under: '#4ade80', normal: '#eab308', over: '#f97316', hot: '#ef4444', na: '#8b949e'
  };
  return map[cls] || '#8b949e';
}
