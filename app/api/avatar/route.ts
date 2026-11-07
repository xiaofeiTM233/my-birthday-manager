// app/api/avatar/route.ts
import { NextRequest, NextResponse } from 'next/server';

// 头像地址解析器
type SourceResolver = (name: string) => Promise<string | null>;

// 头像来源映射表
const SOURCE_RESOLVERS: Record<string, SourceResolver> = {
  A: async (name) => `https://prts.wiki/w/Special:Redirect/file/${encodeURIComponent(`头像_${name}.png`)}`,
  EC: async (name) => `https://wiki.biligame.com/zmd/Special:Redirect/file/${encodeURIComponent(`${name}头像.png`)}`,
  EW: async (name) => `https://wiki.biligame.com/zmd/Special:Redirect/file/${encodeURIComponent(`${name}图标.png`)}`,
  B: async (name) => {
    const id = await resolveSchaleId(name);
    if (id === null) return null;
    return `https://schaledb.com/images/student/icon/${id}.webp`;
  },
};

// 成功缓存 7 天，失败缓存 10 分钟，避免反复打上游
const SUCCESS_TTL = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 500;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0';

interface CacheEntry {
  buffer: ArrayBuffer;
  contentType: string;
  ts: number;
}

const imageCache = new Map<string, CacheEntry>();
const failureCache = new Map<string, number>();
const pendingFetch = new Map<string, Promise<CacheEntry | null>>();

// 名单索引：姓名 → 学生 Id，服务端内存缓存 12 小时
interface SchaleIndex {
  ts: number;
  map: Map<string, number>;
}

let schaleIndex: SchaleIndex | null = null;
let schalePending: Promise<SchaleIndex | null> | null = null;

// 拉取并解析 schaledb 学生名单，建立姓名到 Id 的索引
async function loadSchaleIndex(): Promise<SchaleIndex | null> {
  if (schaleIndex && Date.now() - schaleIndex.ts <= 12 * 60 * 60 * 1000) {
    return schaleIndex;
  }
  if (schalePending) return schalePending;

  schalePending = (async () => {
    try {
      const res = await fetch('https://schaledb.com/data/cn/students.min.json', {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        console.warn(`⚠️ schaledb 名单获取失败: ${res.status}`);
        return null;
      }
      const raw = (await res.json()) as Record<
        string,
        { Id?: number; Name?: string; FamilyName?: string; PathName?: string; DevName?: string }
      >;
      const map = new Map<string, number>();
      for (const student of Object.values(raw)) {
        if (typeof student.Id !== 'number') continue;
        const keys: string[] = [];
        if (student.Name) keys.push(student.Name);
        if (student.FamilyName && student.Name) keys.push(`${student.FamilyName}${student.Name}`);
        if (student.PathName) keys.push(student.PathName);
        if (student.DevName) keys.push(student.DevName);
        for (const key of keys) {
          if (!map.has(key)) map.set(key, student.Id);
        }
      }
      schaleIndex = { ts: Date.now(), map };
      return schaleIndex;
    } catch (error) {
      console.error('❌ schaledb 名单拉取出错:', error);
      return null;
    } finally {
      schalePending = null;
    }
  })();

  return schalePending;
}

// 姓名转学生 Id，支持中文名、姓加名与英文 PathName 三种写法
async function resolveSchaleId(name: string): Promise<number | null> {
  const index = await loadSchaleIndex();
  if (!index) return null;
  const trimmed = name.trim();
  return index.map.get(trimmed) ?? index.map.get(trimmed.toLowerCase()) ?? null;
}

function cacheSet(key: string, entry: CacheEntry): void {
  if (imageCache.size >= CACHE_MAX) {
    // Map 按插入序，淘汰最早写入的
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  imageCache.set(key, entry);
}

function cacheGet(key: string): CacheEntry | undefined {
  const entry = imageCache.get(key);
  if (entry && Date.now() - entry.ts <= SUCCESS_TTL) return entry;
  imageCache.delete(key);
  return undefined;
}

function failureGet(key: string): boolean {
  const ts = failureCache.get(key);
  if (ts !== undefined && Date.now() - ts <= FAILURE_TTL) return true;
  failureCache.delete(key);
  return false;
}

// 拉取图片，非图片响应视为失败，不写入缓存
async function fetchImage(target: string, source: string, name: string): Promise<CacheEntry | null> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  const hostname = new URL(target).hostname;
  if (hostname === 'prts.wiki') {
    headers.Cookie = 'within.website-x-cmd-sisyphus-auth';
  }
  if (hostname === 'schaledb.com') {
    headers.Referer = 'https://schaledb.com/';
  }

  try {
    const upstream = await fetch(target, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    const contentType = upstream.headers.get('content-type') ?? '';
    if (!upstream.ok || !contentType.startsWith('image/')) {
      console.warn(`⚠️ 头像获取失败: ${source}:${name} -> ${upstream.status} ${contentType}`);
      return null;
    }

    return { buffer: await upstream.arrayBuffer(), contentType, ts: Date.now() };
  } catch (error) {
    console.error(`❌ 头像拉取出错: ${source}:${name}:`, error);
    return null;
  }
}

function imageResponse(entry: CacheEntry, cacheHit: boolean): Response {
  return new Response(entry.buffer, {
    status: 200,
    headers: {
      'Content-Type': entry.contentType,
      'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, immutable',
      'X-Cache': cacheHit ? 'HIT' : 'MISS',
    },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const name = (searchParams.get('name') ?? '').trim();
  const game = (searchParams.get('game') ?? '').trim();

  if (!name) {
    return NextResponse.json({ code: -1, data: null, msg: '缺少 name 参数' }, { status: 400 });
  }

  const resolver = SOURCE_RESOLVERS[game];
  if (!resolver) {
    // 分组没有对应来源，交由页面回退文字头像
    return new Response(null, { status: 404 });
  }

  // 缓存按分组隔离，同名角色在不同分组可能来自不同站点
  const key = `${game}:${name}`;
  const hit = cacheGet(key);
  if (hit) return imageResponse(hit, true);

  // 最近确认过取不到，直接短路，避免反复打上游
  if (failureGet(key)) {
    return new Response(null, { status: 404 });
  }

  let task = pendingFetch.get(key);
  if (!task) {
    task = (async () => {
      const target = await resolver(name);
      // 该分组没有这个角色
      if (!target) {
        console.warn(`⚠️ 头像映射失败: ${game}:${name}`);
        return null;
      }
      return fetchImage(target, game, name);
    })();
    pendingFetch.set(key, task);
    task.finally(() => pendingFetch.delete(key)).catch(() => {});
  }

  const entry = await task;
  if (!entry) {
    failureCache.set(key, Date.now());
    return new Response(null, { status: 404 });
  }

  cacheSet(key, entry);
  return imageResponse(entry, false);
}
