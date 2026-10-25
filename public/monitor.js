const $ = (s) => document.querySelector(s);

let rules = [];

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fmtVal(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  return String(v);
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function signalBadge(s) {
  const cls = { BUY: 'b-BUY', SELL: 'b-SELL', HOLD: 'b-HOLD', ERROR: 'b-ERROR' }[s] || 'b-HOLD';
  return `<span class="badge ${cls}">${esc(s)}</span>`;
}

// ---------------- 指标说明 ----------------
const RULE_DOCS = {
  erp: {
    category: '股债性价比',
    what: '股权风险溢价（ERP），俗称「股债利差」。衡量投资沪深300相对无风险国债能多拿到的额外补偿，数值越高代表股票相对债券越便宜、越有配置价值。',
    formula: 'ERP = (1 ÷ 沪深300 市盈率) × 100 − 中国 10 年期国债收益率(%)',
    howto: '把沪深300的「盈利收益率」(1/PE) 减去「10年国债收益率」。当前值越大越该买入。',
    threshold: '经验参考：ERP ≥ 6% 偏吸引（BUY），≤ 4% 偏昂贵（SELL），中间视为 HOLD。',
    caution: 'ERP 是相对指标，极端高/低常伴随市场情绪；建议结合 PE 水平与国债利率一起判断。',
  },
  dividend_spread: {
    category: '红利 / 股债性价比',
    what: '中证红利指数的股息率减去 10 年期国债收益率（无风险利率）的差值，衡量红利股「分红回报」相对无风险债券的吸引力。',
    formula: '差值 = 中证红利股息率(%) − 中国 10 年期国债收益率(%)',
    howto: '差值越大越该买入。本质是「股息率溢价」——买红利股比买国债多拿到的分红补偿。',
    threshold: '买入门槛（必须同时满足）：① 股息率 > 国债收益率（硬性，否则不买）；② 差值 ≥ 2.5 个百分点（或股息率 ≥ 2 倍国债收益率）。差值 ≤ 1 → SELL。',
    caution: '国债收益率极低时比值易失真，以绝对差值为主、比值为辅；高股息率也可能来自股价下跌。',
  },
  dividend: {
    category: '红利 / 股息',
    what: '指数成分股的现金分红相对指数点位的比率，反映持有该指数的分红回报水平。数值越高，通常估值越低、股息吸引力越强。',
    formula: '股息率 = 近 12 个月现金分红 ÷ 指数点位 × 100%（数据来源：中证指数）',
    howto: '当前值越大越该买入。红利类策略常把股息率与同期国债收益率对比，衡量「股息 − 无风险利率」的相对吸引力。',
    threshold: '一般股息率 > 4% 被认为有配置价值；< 3% 时吸引力明显下降。',
    caution: '高股息率可能来自股价下跌（价值陷阱），需结合盈利稳定性与分红持续性判断。',
  },
  pe_percentile: {
    category: '估值',
    what: '当前市盈率（PE）在过去约 10 年历史中所处的百分位，反映相对历史是贵还是便宜。',
    formula: '百分位 = (历史中 ≤ 当前 PE 的交易日数 ÷ 总交易日数) × 100',
    howto: '当前值越低越该买入（历史便宜）；越高越贵。',
    threshold: '常见口径：分位 < 20% 视为低估（BUY），> 80% 视为高估（SELL）。',
    caution: '百分位低不等于一定上涨，只是「相对历史便宜」；若盈利正在下滑，低 PE 也可能继续走低。',
  },
};

function getRuleDoc(rule) {
  const ind = String(rule && rule.indicator || '');
  if (ind.startsWith('dividend_spread')) return RULE_DOCS.dividend_spread;
  if (ind === 'erp_csi300' || ind.startsWith('erp')) return RULE_DOCS.erp;
  if (ind.startsWith('dividend_yield')) return RULE_DOCS.dividend;
  if (ind.startsWith('pe_percentile')) return RULE_DOCS.pe_percentile;
  return null;
}

function showRuleDoc(rule) {
  const doc = getRuleDoc(rule);
  $('#docTitle').textContent = rule.name || '(未命名规则)';
  $('#docCat').textContent = (doc ? doc.category + ' · ' : '') + '指标：' + (rule.indicator || '—');

  if (!doc) {
    $('#docBody').innerHTML = `<div class="doc-section"><div class="doc-value">暂无该指标的详细说明（指标：${esc(rule.indicator || '未设置')}）。</div></div>`;
    $('#docOverlay').hidden = false;
    return;
  }

  const dirText = rule.direction === 'low' ? '值越低越买' : '值越高越买';
  const th = (rule.buyThreshold != null && rule.sellThreshold != null)
    ? `方向「${dirText}」；BUY 阈值 ${rule.buyThreshold}，SELL 阈值 ${rule.sellThreshold}`
    : '（尚未计算，暂无阈值）';

  $('#docBody').innerHTML = `
    <div class="doc-section"><div class="doc-label">这是什么</div><div class="doc-value">${doc.what}</div></div>
    <div class="doc-section"><div class="doc-label">计算公式</div><div class="doc-formula">${esc(doc.formula)}</div></div>
    <div class="doc-section"><div class="doc-label">怎么读</div><div class="doc-value">${doc.howto}</div></div>
    <div class="doc-section"><div class="doc-label">阈值参考</div><div class="doc-value">${doc.threshold}</div></div>
    <div class="doc-section"><div class="doc-label">⚠️ 注意</div><div class="doc-value">${doc.caution}</div></div>
    <div class="doc-section"><div class="doc-label">当前规则设置</div><div class="doc-value">${esc(th)}</div></div>
  `;
  $('#docOverlay').hidden = false;
}

function closeDoc() {
  $('#docOverlay').hidden = true;
}

// ---------------- 规则管理 ----------------
async function loadRules() {
  const data = await api('/api/rules');
  rules = data.rules || [];
  renderRules();
}

function renderRules() {
  const tbody = $('#rules-tbody');
  tbody.innerHTML = '';
  if (rules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">暂无规则，点击「新增规则」</td></tr>';
    return;
  }
  rules.forEach((r) => {
    const dir = r.direction === 'high' ? '越高越买' : '越低越买';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="name-cell" data-label="名称">${esc(r.name)}<button class="info-btn" data-doc="${esc(r.id)}" title="规则说明">!</button></td>
      <td data-label="指标"><code>${esc(r.indicator)}</code></td>
      <td data-label="方向">${dir}</td>
      <td data-label="BUY 阈值">${r.buyThreshold}</td>
      <td data-label="SELL 阈值">${r.sellThreshold}</td>
      <td data-label="状态">${r.enabled ? '✅ 启用' : '⏸ 停用'}</td>
      <td class="actions-cell">
        <button class="btn" data-act="edit" data-id="${esc(r.id)}">编辑</button>
        <button class="btn" data-act="toggle" data-id="${esc(r.id)}">${r.enabled ? '停用' : '启用'}</button>
        <button class="btn" data-act="del" data-id="${esc(r.id)}">删除</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function showForm(rule) {
  $('#rule-form').hidden = false;
  $('#form-title').textContent = rule ? '编辑规则' : '新增规则';
  $('#f-id').value = rule ? rule.id : '';
  $('#f-id').disabled = !!rule;
  $('#f-name').value = rule ? rule.name : '';
  $('#f-indicator').value = rule ? rule.indicator : '';
  $('#f-direction').value = rule ? rule.direction : 'high';
  $('#f-enabled').value = rule ? String(rule.enabled) : 'true';
  $('#f-buy').value = rule ? rule.buyThreshold : '';
  $('#f-sell').value = rule ? rule.sellThreshold : '';
  $('#rule-form').scrollIntoView({ behavior: 'smooth' });
}

function hideForm() {
  $('#rule-form').hidden = true;
  $('#f-id').disabled = false;
}

async function saveRules() {
  await api('/api/rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules),
  });
  renderRules();
}

function saveRuleFromForm() {
  const rule = {
    id: $('#f-id').value.trim(),
    name: $('#f-name').value.trim(),
    indicator: $('#f-indicator').value.trim(),
    direction: $('#f-direction').value,
    enabled: $('#f-enabled').value === 'true',
    buyThreshold: parseFloat($('#f-buy').value),
    sellThreshold: parseFloat($('#f-sell').value),
  };
  if (!rule.id || !rule.name || !rule.indicator) return alert('请填写 ID / 名称 / 指标');
  if (isNaN(rule.buyThreshold) || isNaN(rule.sellThreshold)) return alert('阈值必须是数字');
  const i = rules.findIndex((r) => r.id === rule.id);
  if (i >= 0) rules[i] = rule;
  else rules.push(rule);
  hideForm();
  saveRules().catch((e) => alert('保存失败: ' + e.message));
}

async function handleRulesClick(e) {
  const infoBtn = e.target.closest('.info-btn');
  if (infoBtn) {
    const rule = rules.find((r) => r.id === infoBtn.dataset.doc);
    if (rule) return showRuleDoc(rule);
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const i = rules.findIndex((r) => r.id === id);
  if (act === 'edit') return showForm(rules[i]);
  if (act === 'toggle') {
    rules[i].enabled = !rules[i].enabled;
    return saveRules().catch((e) => alert('保存失败: ' + e.message));
  }
  if (act === 'del') {
    if (!confirm(`删除规则「${rules[i].name}」？`)) return;
    rules.splice(i, 1);
    return saveRules().catch((e) => alert('保存失败: ' + e.message));
  }
}

// ---------------- 运行状态 ----------------
async function loadStatus() {
  const data = await api('/api/results');
  const { results, signalLog } = data;
  $('#last-run').textContent = results.updatedAt ? `最近计算：${fmtTime(results.updatedAt)}` : '尚未运行';

  const rt = $('#results-tbody');
  rt.innerHTML = '';
  (results.items || []).forEach((it) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="name-cell" data-label="规则">${esc(it.name)}<button class="info-btn" data-doc="${esc(it.ruleId)}" title="规则说明">!</button></td>
      <td data-label="当前值">${fmtVal(it.value)}</td>
      <td data-label="信号">${signalBadge(it.signal)}</td>
      <td data-label="说明" class="muted">${esc(it.message || '')}</td>
      <td data-label="更新时间">${fmtTime(it.updatedAt)}</td>`;
    rt.appendChild(tr);
  });

  const lt = $('#log-tbody');
  lt.innerHTML = '';
  (signalLog || []).forEach((e) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="时间">${fmtTime(e.at)}</td>
      <td data-label="规则">${esc(e.name)}</td>
      <td data-label="变化">${signalBadge(e.from)} <span class="arrow">→</span> ${signalBadge(e.to)}</td>
      <td data-label="值">${fmtVal(e.value)}</td>`;
    lt.appendChild(tr);
  });
  if (!signalLog || signalLog.length === 0) {
    lt.innerHTML = '<tr><td colspan="4" class="muted">暂无信号变化记录</td></tr>';
  }
}

async function handleResultsClick(e) {
  const infoBtn = e.target.closest('.info-btn');
  if (!infoBtn) return;
  const rule = rules.find((r) => r.id === infoBtn.dataset.doc);
  if (rule) return showRuleDoc(rule);
  // 结果里的规则可能已被删除，退化为仅按 indicator 展示
  showRuleDoc({ id: infoBtn.dataset.doc, name: infoBtn.closest('td') ? infoBtn.closest('td').childNodes[0].textContent : '', indicator: '' });
}

// ---------------- tab 切换 ----------------
function switchTab(tab) {
  $('#panel-rules').classList.toggle('active', tab === 'rules');
  $('#panel-status').classList.toggle('active', tab === 'status');
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'rules') loadRules().catch((e) => alert('加载失败: ' + e.message));
  if (tab === 'status') loadStatus().catch((e) => alert('加载失败: ' + e.message));
}

// ---------------- 初始化 ----------------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('#btn-add').addEventListener('click', () => showForm(null));
$('#btn-save').addEventListener('click', saveRuleFromForm);
$('#btn-cancel').addEventListener('click', hideForm);
$('#btn-refresh').addEventListener('click', () => loadStatus().catch((e) => alert('加载失败: ' + e.message)));
$('#rules-tbody').addEventListener('click', handleRulesClick);
$('#results-tbody').addEventListener('click', handleResultsClick);

// 弹窗关闭
$('#docClose').addEventListener('click', closeDoc);
$('#docOverlay').addEventListener('click', (e) => { if (e.target === $('#docOverlay')) closeDoc(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDoc(); });

loadRules().catch((e) => alert('加载失败: ' + e.message));
