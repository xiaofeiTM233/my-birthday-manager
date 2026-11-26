// lib/catalog.ts
// 从公开图鉴拉取生日名单：B 蔚蓝档案 / S 星塔旅人

export type CatalogGame = 'B' | 'S';

export interface CatalogItem {
  name: string;
  month: number;
  day: number;
  // 学校 / 阵营，仅用于导入预览展示
  extra?: string;
}

// 图鉴名单很少变化，服务端内存缓存 12 小时
const CACHE_TTL = 12 * 60 * 60 * 1000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0';

// 每月最大天数（2 月取 29，支持 2/29 生日）
const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface SchaleStudent {
  Name?: string;
  FamilyName?: string;
  Birthday?: string;
  BirthDay?: string;
  School?: string;
}

interface StellaCharacter {
  name?: string;
  birthday?: string;
  faction?: string;
}

export function isCatalogGame(value: string): value is CatalogGame {
  return value === 'B' || value === 'S';
}

// 解析 "3/12"、"3月12日"、"8.8" 等生日写法
function parseBirthday(text: string | undefined): { month: number; day: number } | null {
  if (!text) return null;
  const match = text.trim().match(/^(\d{1,2})\s*[./月-]\s*(\d{1,2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > MAX_DAYS[month - 1]) return null;
  return { month, day };
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown = null;
  // 图鉴站点偶尔连不上，重试一次避免导入弹窗直接报错
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        throw new Error(`${url} -> ${res.status}`);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastError;
}

// 蔚蓝档案：schaledb 中文学生名单，生日形如 "3/12" / "3月12日"
async function loadSchale(): Promise<CatalogItem[]> {
  const raw = (await fetchJson('https://schaledb.com/data/zh/students.min.json')) as Record<
    string,
    SchaleStudent
  >;
  const items: CatalogItem[] = [];
  for (const student of Object.values(raw)) {
    // 与现有录入习惯保持一致，使用「姓氏 + 名」的全名
    const name = `${student.FamilyName ?? ''}${student.Name ?? ''}`.trim();
    // 少数联动角色（食蜂操祈、佐天泪子）没有生日，直接跳过
    const birthday = parseBirthday(student.BirthDay) ?? parseBirthday(student.Birthday);
    if (!name || !birthday) continue;
    items.push({ name, ...birthday, extra: student.School });
  }
  return items;
}

// 星塔旅人：stella 角色名单，生日形如 "8.8"
async function loadStella(): Promise<CatalogItem[]> {
  const raw = (await fetchJson('https://stella.ennead.cc/api/stella/characters?lang=CN')) as StellaCharacter[];
  const items: CatalogItem[] = [];
  for (const character of raw) {
    const name = character.name?.trim();
    const birthday = parseBirthday(character.birthday);
    // 未公开生日的角色（密涅瓦）跳过
    if (!name || !birthday) continue;
    items.push({ name, ...birthday, extra: character.faction });
  }
  return items;
}

// 同一姓名 + 同一月日只保留一条（如 schaledb 里重复的「小鸟游星野（临战）」）
function dedupeAndSort(items: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>();
  const result: CatalogItem[] = [];
  for (const item of items) {
    const key = `${item.name}|${item.month}|${item.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.sort(
    (a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, 'zh-CN')
  );
}

interface CacheEntry {
  ts: number;
  items: CatalogItem[];
}

const cache = new Map<CatalogGame, CacheEntry>();
const pending = new Map<CatalogGame, Promise<CatalogItem[]>>();

// 拉取并归一化图鉴名单；失败返回 null，由调用方提示重试
export async function getCatalog(game: CatalogGame): Promise<CatalogItem[] | null> {
  const cached = cache.get(game);
  if (cached && Date.now() - cached.ts <= CACHE_TTL) {
    return cached.items;
  }

  // 同一来源的并发请求合并成一次拉取
  const running = pending.get(game);
  if (running) return running;

  const task = (async (): Promise<CatalogItem[]> => {
    const items = game === 'B' ? await loadSchale() : await loadStella();
    return dedupeAndSort(items);
  })();

  pending.set(game, task);
  try {
    const items = await task;
    cache.set(game, { ts: Date.now(), items });
    return items;
  } catch (error) {
    console.error(`❌ 图鉴拉取失败: ${game}`, error);
    return null;
  } finally {
    pending.delete(game);
  }
}