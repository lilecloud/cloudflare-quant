import { fetchCached } from './cache';

// 东方财富-数据中心-中美国债收益率（akshare bond_zh_us_rate 的数据源）
// 10 年期中国国债收益率 = 字段 EMM00166466（单位：%）
const TREASURY_URL = 'https://datacenter.eastmoney.com/api/data/get';

export async function fetchTreasury10Y(): Promise<number | null> {
  const params = new URLSearchParams({
    type: 'RPTA_WEB_TREASURYYIELD',
    sty: 'ALL',
    st: 'SOLAR_DATE',
    sr: '-1',
    token: '894050c76af8597a853f5b408b759f5d',
    p: '1',
    ps: '500',
    pageNo: '1',
    pageNum: '1',
  });
  try {
    const res = await fetchCached(`${TREASURY_URL}?${params.toString()}`, 3600);
    if (!res.ok) return null;
    const json: any = await res.json();
    const rows: any[] = json?.result?.data ?? [];
    if (!rows.length) return null;
    // sr=-1 表示按日期倒序，第一行即最新
    const v = parseFloat(rows[0]?.EMM00166466);
    return isNaN(v) ? null : v;
  } catch (e: any) {
    console.error('treasury fetch error:', e.message);
    return null;
  }
}
