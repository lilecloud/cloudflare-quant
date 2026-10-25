export interface IndexData {
  name: string;
  code: string;
  pe: number | null;
  prevPe: number | null;
  peDelta: number | null;
  percentile: number | null;
  score: number | null;
  level: string;
  levelColor: string;
  action: string;
  multiple: number;
}

interface IndexDef {
  name: string;
  code: string;
}

const INDEX_POOL: IndexDef[] = [
  { name: "红利低波", code: "H30269" },
  { name: "中证传媒", code: "399971" },
  { name: "中国互联网50", code: "H30533" },
  { name: "中证红利", code: "000922" },
  { name: "全指医药", code: "000991" },
  { name: "中证消费", code: "000932" },
  { name: "中证500", code: "000905" },
  { name: "沪深300", code: "000300" },
  { name: "沪深300价值", code: "000921" },
  { name: "全指信息", code: "000993" },
  { name: "中证医疗", code: "399989" },
  { name: "证券公司", code: "399975" },
  { name: "中证酒", code: "399987" },
  { name: "中证军工", code: "399967" },
  { name: "中证环保", code: "000827" },
  { name: "全指金融", code: "932075" },
];

const LEVEL_COLORS: Record<string, string> = {
  "极度低估": "#22c55e",
  "低估": "#4ade80",
  "正常": "#eab308",
  "高估": "#f97316",
  "极度高估": "#ef4444",
};

function getLevel(percentile: number): { level: string; levelColor: string; score: number; action: string; multiple: number } {
  const score = Math.round(100 - percentile);
  if (percentile <= 10) return { level: "极度低估", levelColor: LEVEL_COLORS["极度低估"], score, action: "加倍定投", multiple: 2.0 };
  if (percentile <= 30) return { level: "低估", levelColor: LEVEL_COLORS["低估"], score, action: "正常定投", multiple: 1.5 };
  if (percentile <= 70) return { level: "正常", levelColor: LEVEL_COLORS["正常"], score, action: "坚持定投", multiple: 1.0 };
  if (percentile <= 90) return { level: "高估", levelColor: LEVEL_COLORS["高估"], score, action: "停止定投", multiple: 0 };
  return { level: "极度高估", levelColor: LEVEL_COLORS["极度高估"], score, action: "分批卖出", multiple: -1 };
}

interface DailyPE {
  date: string;
  pe: number;
}

async function fetchCsHistory(code: string): Promise<DailyPE[] | null> {
  const endStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  try {
    const res = await fetch("https://www.csindex.com.cn/csindex-home/perf/index-perf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Referer": "https://www.csindex.com.cn/",
      },
      body: JSON.stringify({ indexCode: code, startDate: "20160101", endDate: endStr }),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json.code !== "200" || !Array.isArray(json.data)) return null;
    const records: DailyPE[] = [];
    for (const d of json.data) {
      const pe = d.pe1 ?? d.pe_ttm;
      if (d.tradeDate && pe != null && Number(pe) > 0) {
        records.push({ date: d.tradeDate, pe: Number(pe) });
      }
    }
    return records.length > 0 ? records : null;
  } catch {
    return null;
  }
}

function calcPercentile(records: DailyPE[], curPE: number): number {
  return (records.filter(r => r.pe <= curPE).length / records.length) * 100;
}

function calcMonthly(records: DailyPE[]): { prevPe: number | null; peDelta: number | null } {
  if (records.length < 2) return { prevPe: null, peDelta: null };
  const latest = records[records.length - 1];
  const target = new Date(new Date(latest.date).getTime() - 30 * 86400000);
  let best: DailyPE | null = null;
  let bestDiff = Infinity;
  for (const r of records) {
    const diff = Math.abs(new Date(r.date).getTime() - target.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  if (!best || bestDiff > 45 * 86400000) return { prevPe: null, peDelta: null };
  const prevPe = Math.round(best.pe * 100) / 100;
  const peDelta = Math.round((latest.pe - prevPe) * 100) / 100;
  return { prevPe, peDelta };
}

export async function fetchIndexes(): Promise<{ updated: string; indexes: IndexData[] }> {
  const results: IndexData[] = [];

  const tasks = INDEX_POOL.map(async (idx): Promise<IndexData> => {
    const records = await fetchCsHistory(idx.code);
    if (!records) {
      return { name: idx.name, code: idx.code, pe: null, prevPe: null, peDelta: null, percentile: null, score: null, level: "获取失败", levelColor: "#6b7280", action: "-", multiple: 0 };
    }
    const latest = records[records.length - 1];
    const { prevPe, peDelta } = calcMonthly(records);
    const percentile = calcPercentile(records, latest.pe);
    const { level, levelColor, score, action, multiple } = getLevel(percentile);
    return {
      name: idx.name, code: idx.code,
      pe: latest.pe, prevPe, peDelta,
      percentile: Math.round(percentile * 100) / 100,
      score, level, levelColor, action, multiple,
    };
  });

  const indexes = await Promise.all(tasks);
  indexes.sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return b.score - a.score;
  });

  return {
    updated: new Date().toISOString().slice(0, 10),
    indexes,
  };
}
