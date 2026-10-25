import { StockInfo, BoardItem } from './types';
import { fetchCached } from './cache';

const EASTMONEY_UT = 'bd1d9ddb04089700cf9c27f6f7426281';

// 主行情主机 push2 在某些网络环境（如本地/部分运营商）会被重置连接，
// 自动降级到延迟行情主机 push2delay（同一 API，数据延迟约 15 分钟，对估值分析足够）。
const EASTMONEY_HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
];

// 记住最近一次成功的主机，避免每次请求都先失败一次
let workingHost: string | undefined;

async function fetchEastmoney(path: string, params: URLSearchParams, ttl: number): Promise<Response> {
  const hosts = workingHost
    ? [workingHost, ...EASTMONEY_HOSTS.filter(h => h !== workingHost)]
    : EASTMONEY_HOSTS;

  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const res = await fetchCached(`${host}${path}?${params}`, ttl);
      if (res.ok) {
        workingHost = host;
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('所有东方财富主机均不可达');
}

const TTL_STOCK = 1800;      // 30min
const TTL_BOARD = 86400;     // 24h
const TTL_STOCKS = 1800;     // 30min

function marketCode(code: string): number {
  if (code.startsWith('6') || code.startsWith('9')) return 1;
  return 0;
}

export async function fetchStockInfo(code: string): Promise<StockInfo | null> {
  const params = new URLSearchParams({
    fltt: '2', invt: '2',
    fields: 'f57,f58,f127',
    secid: `${marketCode(code)}.${code}`,
  });
  const res = await fetchEastmoney('/api/qt/stock/get', params, TTL_STOCK);
  const json: any = await res.json();
  const d = json?.data;
  if (!d || !d.f57) return null;
  return { code: d.f57, name: d.f58, industry: d.f127 ?? '' };
}

function boardParams(pn: string) {
  return new URLSearchParams({
    pn, pz: '100', po: '1', np: '1',
    ut: EASTMONEY_UT,
    fltt: '2', invt: '2', fid: 'f3',
    fs: 'm:90 t:2 f:!50',
    fields: 'f12,f14',
  });
}

export async function fetchBoardNames(): Promise<Map<string, string>> {
  const firstRes = await fetchEastmoney('/api/qt/clist/get', boardParams('1'), TTL_BOARD);
  const firstJson: any = await firstRes.json();
  const map = new Map<string, string>();
  const diff = firstJson?.data?.diff ?? [];
  for (const item of diff) map.set(item.f14, item.f12);

  const total: number = firstJson?.data?.total ?? 0;
  const perPage = diff.length || 100;
  const pages = Math.ceil(total / perPage);

  if (pages > 1) {
    const tasks: Promise<void>[] = [];
    for (let p = 2; p <= pages; p++) {
      tasks.push(
        fetchEastmoney('/api/qt/clist/get', boardParams(String(p)), TTL_BOARD)
          .then(r => r.json())
          .then((j: any) => {
            for (const item of j?.data?.diff ?? []) map.set(item.f14, item.f12);
          })
      );
    }
    await Promise.all(tasks);
  }
  return map;
}

const ROMAN_SUFFIX = /[ⅡⅢⅣ]+$/;

export function normalizeIndustry(raw: string, map: Map<string, string>): string | null {
  if (map.has(raw)) return raw;
  const norm = raw.replace(ROMAN_SUFFIX, '').trim();
  if (map.has(norm)) return norm;
  return null;
}

function stockParams(pn: string, boardCode: string) {
  return new URLSearchParams({
    pn, pz: '100', po: '1', np: '1',
    ut: EASTMONEY_UT,
    fltt: '2', invt: '2', fid: 'f3',
    fs: `b:${boardCode} f:!50`,
    fields: 'f12,f14,f9,f23',
  });
}

function toBoardItem(item: any): BoardItem {
  return {
    code: item.f12,
    name: item.f14 ?? '',
    pe: item.f9 != null ? parseFloat(item.f9) : null,
    pb: item.f23 != null ? parseFloat(item.f23) : null,
  };
}

export async function fetchBoardStocks(boardCode: string): Promise<BoardItem[]> {
  const firstRes = await fetchEastmoney('/api/qt/clist/get', stockParams('1', boardCode), TTL_STOCKS);
  const firstJson: any = await firstRes.json();
  const allItems: BoardItem[] = (firstJson?.data?.diff ?? []).map(toBoardItem);

  const total: number = firstJson?.data?.total ?? 0;
  const perPage = allItems.length || 100;
  const pages = Math.ceil(total / perPage);

  if (pages > 1) {
    const tasks: Promise<void>[] = [];
    for (let p = 2; p <= pages; p++) {
      tasks.push(
        fetchEastmoney('/api/qt/clist/get', stockParams(String(p), boardCode), TTL_STOCKS)
          .then(r => r.json())
          .then((j: any) => {
            for (const item of j?.data?.diff ?? []) allItems.push(toBoardItem(item));
          })
      );
    }
    await Promise.all(tasks);
  }
  return allItems;
}
