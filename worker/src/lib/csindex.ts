import { fetchCached } from './cache';

export interface PEItem {
  d: string; // "2025-04-01"
  p: number; // PE value
}

export type ValuationMethod = 'PE' | 'DIVIDEND' | 'PB';

export interface IndexRank {
  name: string;
  code: string;
  valuation: ValuationMethod;
  valuationLabel: string;
  pe: number;
  prevPe: number | null;
  peDelta: number | null;
  percentile: number;
  score: number;
  level: string;
  action: string;
  multiple: number;
  dividendYield?: number | null;
}

const CSINDEX_URL = 'https://www.csindex.com.cn/csindex-home/perf/index-perf';
const META_KEY = 'meta:last_updated';
const PE_PREFIX = 'pe:';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function daysAgoStr(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function toDate(d: string): Date {
  // "20260426" → new Date("2026-04-26")
  return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function loadPEHistory(kv: KVNamespace, code: string): Promise<PEItem[]> {
  const raw = await kv.get(PE_PREFIX + code);
  return raw ? JSON.parse(raw) : [];
}

async function savePEHistory(kv: KVNamespace, code: string, items: PEItem[]): Promise<void> {
  await kv.put(PE_PREFIX + code, JSON.stringify(items));
}

export async function getLastUpdated(kv: KVNamespace): Promise<string> {
  return (await kv.get(META_KEY)) || '';
}

export async function setLastUpdated(kv: KVNamespace): Promise<void> {
  await kv.put(META_KEY, todayStr());
}

export async function fetchCSIndexData(code: string, fullHistory: boolean = false): Promise<PEItem[]> {
  const start = fullHistory ? daysAgoStr(3650) : daysAgoStr(7);
  const url = `${CSINDEX_URL}?indexCode=${code}&startDate=${start}&endDate=${todayStr()}`;
  try {
    const res = await fetchCached(url, 86400);
    if (!res.ok) return [];
    const json: any = await res.json();
    const items: PEItem[] = [];
    for (const row of json?.data ?? []) {
      const d = String(row.tradeDate);
      const p = parseFloat(row.peg);
      if (!isNaN(p) && p > 0) {
        items.push({ d, p });
      }
    }
    return items;
  } catch (e: any) {
    console.error(`csindex ${code} error:`, e.message);
    return [];
  }
}

// 从 indicator.xls 获取指数最近估值（市盈率/股息率）
// 文件仅含最近 20 个交易日，仅用于展示当前股息率等指标
export async function fetchIndicator(
  code: string,
): Promise<{ pe: number | null; dividendYield: number | null } | null> {
  const url = `https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/${code}indicator.xls`;
  try {
    const res = await fetchCached(url, 3600);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // 动态 import xlsx，避免主包体积过大
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);
    if (!rows.length) return null;
    const latest = rows[0];
    const peVal = parseFloat(latest['市盈率1（总股本）P/E1']);
    const dpVal = parseFloat(latest['股息率1（总股本）D/P1']);
    return {
      pe: !isNaN(peVal) ? peVal : null,
      dividendYield: !isNaN(dpVal) ? dpVal : null,
    };
  } catch (e: any) {
    console.error(`csindex indicator ${code} error:`, e.message);
    return null;
  }
}

export function mergePEData(existing: PEItem[], incoming: PEItem[]): PEItem[] {
  const map = new Map<string, number>();
  for (const item of existing) map.set(item.d, item.p);
  for (const item of incoming) map.set(item.d, item.p);
  return Array.from(map.entries())
    .map(([d, p]) => ({ d, p }))
    .sort((a, b) => a.d.localeCompare(b.d));
}

export async function refreshAndGet(kv: KVNamespace, code: string): Promise<PEItem[]> {
  const existing = await loadPEHistory(kv, code);
  const fullHistory = existing.length === 0;
  const incoming = await fetchCSIndexData(code, fullHistory);
  const merged = mergePEData(existing, incoming);
  if (merged.length > existing.length) {
    await savePEHistory(kv, code, merged);
  }
  return merged;
}

export function calcPercentile(history: PEItem[]): { pe: number; percentile: number; prevPe: number | null; peDelta: number | null } {
  if (history.length === 0) return { pe: 0, percentile: 0, prevPe: null, peDelta: null };
  const current = history[history.length - 1];
  const peValues = history.map(h => h.p).sort((a, b) => a - b);
  const pos = peValues.filter(p => p <= current.p).length;
  const percentile = Math.round((pos / peValues.length) * 100 * 100) / 100;

  // Find PE from ~30 days ago
  let prevPe: number | null = null;
  let peDelta: number | null = null;
  const curDate = toDate(current.d);
  curDate.setDate(curDate.getDate() - 30);
  const targetStr = toDateStr(curDate);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].d <= targetStr.replace(/-/g, '')) {
      prevPe = history[i].p;
      peDelta = Math.round((current.p - prevPe) * 100) / 100;
      break;
    }
  }

  return { pe: current.p, percentile, prevPe, peDelta };
}

export function scoreAndAction(percentile: number): { score: number; level: string; action: string; multiple: number } {
  const score = Math.round((100 - percentile) * 100) / 100;
  let level: string;
  if (percentile <= 10) level = '极度低估';
  else if (percentile <= 30) level = '低估';
  else if (percentile <= 70) level = '正常';
  else if (percentile <= 90) level = '高估';
  else level = '极度高估';

  let action: string, multiple: number;
  switch (level) {
    case '极度低估': action = '加倍定投'; multiple = 2.0; break;
    case '低估': action = '正常定投'; multiple = 1.5; break;
    case '正常': action = '坚持定投'; multiple = 1.0; break;
    case '高估': action = '停止定投'; multiple = 0; break;
    default: action = '分批卖出'; multiple = -1;
  }

  return { score, level, action, multiple };
}
