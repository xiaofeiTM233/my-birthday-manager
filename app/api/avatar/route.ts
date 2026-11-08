// app/api/avatar/route.ts
import { getCache } from '@vercel/functions';
import { NextRequest, NextResponse } from 'next/server';

// 头像地址解析结果
interface ResolveResult {
  target: string | null;
  // 上游不可用属于偶发故障，下次请求应允许重试
  unavailable?: boolean;
}

// 头像地址解析器
type SourceResolver = (name: string) => Promise<ResolveResult>;

// 头像来源映射表
const SOURCE_RESOLVERS: Record<string, SourceResolver> = {
  A: async (name) => ({
    target: `https://prts.wiki/w/Special:Redirect/file/${encodeURIComponent(`头像_${name}.png`)}`,
  }),
  EC: async (name) => ({
    target: `https://wiki.biligame.com/zmd/Special:Redirect/file/${encodeURIComponent(`${name}头像.png`)}`,
  }),
  EW: async (name) => ({
    target: `https://wiki.biligame.com/zmd/Special:Redirect/file/${encodeURIComponent(`${name}图标.png`)}`,
  }),
  B: async (name) => {
    const index = await loadSchaleIndex();
    // 名单拉取失败属于偶发故障，不能当查无此人处理
    if (!index) return { target: null, unavailable: true };
    const trimmed = name.trim();
    const id = index.map.get(trimmed) ?? index.map.get(trimmed.toLowerCase()) ?? null;
    if (id === null) return { target: null };
    return { target: `https://schaledb.com/images/student/icon/${id}.webp` };
  },
};

// 运行时缓存的 TTL 以秒计，单项超过 2MB 不会被缓存
const RUNTIME_TTL = 30 * 24 * 60 * 60;
const RUNTIME_MAX_ITEM = 2 * 1024 * 1024;

// 上游拉取并发上限，超出的请求排队，避免同时打爆 wiki 导致超时
const MAX_CONCURRENT = 4;
const FETCH_TIMEOUT = 15000;

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0';

interface CacheEntry {
  buffer: Uint8Array<ArrayBuffer>;
  contentType: string;
}

// 拉取结果，retryable 表示失败属于偶发故障，可以重试
interface FetchOutcome {
  entry: CacheEntry | null;
  retryable: boolean;
}

// 同一角色的并发请求合并成一次上游拉取
const pendingFetch = new Map<string, Promise<FetchOutcome>>();

// 运行时缓存里存的图片内容
interface StoredImage {
  data: string;
  contentType: string;
}

// 运行时缓存实例，只在 Vercel 平台存在，其它平台没有缓存
let runtimeCache: ReturnType<typeof getCache> | null | undefined;

// 名单索引：姓名 → 学生 Id，服务端内存缓存 12 小时
interface SchaleIndex {
  ts: number;
  map: Map<string, number>;
}

let schaleIndex: SchaleIndex | null = null;
let schalePending: Promise<SchaleIndex | null> | null = null;

// 在途拉取数与等待队列
let activeFetches = 0;
const fetchQueue: (() => void)[] = [];

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

// 拉取图片，偶发故障重试一次，避免单次超时导致头像长时间空白
async function fetchImage(target: string, source: string, name: string): Promise<FetchOutcome> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  const hostname = new URL(target).hostname;
  if (hostname === 'prts.wiki') {
    headers.Cookie = 'within.website-x-cmd-sisyphus-auth';
  }
  if (hostname === 'schaledb.com') {
    headers.Referer = 'https://schaledb.com/';
  }

  let outcome: FetchOutcome = { entry: null, retryable: true };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      // 占用一个上游拉取名额，达到上限时排队等待
      const upstream = await new Promise<Response>((resolve, reject) => {
        const run = () => {
          activeFetches += 1;
          fetch(target, {
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(FETCH_TIMEOUT),
          })
            .then(resolve, reject)
            .finally(() => {
              activeFetches -= 1;
              const next = fetchQueue.shift();
              if (next) next();
            });
        };

        if (activeFetches < MAX_CONCURRENT) {
          run();
        } else {
          fetchQueue.push(run);
        }
      });

      const contentType = upstream.headers.get('content-type') ?? '';
      if (!upstream.ok || !contentType.startsWith('image/')) {
        console.warn(`⚠️ 头像获取失败: ${source}:${name} -> ${upstream.status} ${contentType}`);
        return { entry: null, retryable: false };
      }

      return {
        entry: { buffer: new Uint8Array(await upstream.arrayBuffer()), contentType },
        retryable: false,
      };
    } catch (error) {
      // 超时与连接重置等属偶发故障，打印真实原因便于排查，下一轮重试
      const reason = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error ? (error.cause as { code?: string; message?: string } | undefined) : undefined;
      const causeText = cause?.code ?? cause?.message ?? '';
      console.warn(`⚠️ 头像拉取异常: ${source}:${name}: ${reason}${causeText ? ` (${causeText})` : ''}`);
      outcome = { entry: null, retryable: true };
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  console.error(`❌ 头像拉取失败: ${source}:${name}: 重试后仍未取到`);
  return outcome;
}

function imageResponse(entry: CacheEntry, cacheHit: boolean): Response {
  return new Response(entry.buffer, {
    status: 200,
    headers: {
      'Content-Type': entry.contentType,
      // 浏览器永久缓存，命中后不再回源
      'Cache-Control': 'public, max-age=31536000, immutable',
      // 边缘缓存 30 天，刷新期间用旧图顶上，上游出错时也能继续返回旧图
      'CDN-Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=604800, stale-if-error=604800',
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
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  // 缓存按分组隔离，同名角色在不同分组可能来自不同站点
  const key = `${game}:${name}`;

  // 运行时缓存实例，只在 Vercel 平台存在
  let cache = runtimeCache;
  if (cache === undefined) {
    try {
      // 非 Vercel 平台直接不缓存
      cache = process.env.VERCEL ? getCache({ namespace: 'avatar' }) : null;
    } catch {
      cache = null;
    }
    runtimeCache = cache;
  }

  // 运行时缓存命中就不用回源
  if (cache) {
    try {
      const stored = (await cache.get(key)) as StoredImage | null;
      if (stored && typeof stored === 'object') {
        return imageResponse(
          {
            buffer: Uint8Array.from(Buffer.from(stored.data, 'base64')),
            contentType: stored.contentType,
          },
          true
        );
      }
    } catch (error) {
      console.warn(`⚠️ 运行时缓存读取失败: ${key}`, error);
    }
  }

  let task = pendingFetch.get(key);
  if (!task) {
    task = (async (): Promise<FetchOutcome> => {
      const resolved = await resolver(name);
      if (!resolved.target) {
        if (resolved.unavailable) {
          console.warn(`⚠️ 头像来源不可用: ${game}:${name}`);
          return { entry: null, retryable: true };
        }
        console.warn(`⚠️ 头像映射失败: ${game}:${name}`);
        return { entry: null, retryable: false };
      }
      return fetchImage(resolved.target, game, name);
    })();
    pendingFetch.set(key, task);
    task.finally(() => pendingFetch.delete(key)).catch(() => {});
  }

  const outcome = await task;
  if (!outcome.entry) {
    // 确实没有这个角色的头像时返回 404
    if (!outcome.retryable) {
      return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    // 上游临时故障返回 503，边缘缓存才能用 stale-if-error 顶上旧图
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  // 写入运行时缓存，让其它实例与后续请求直接命中
  if (cache && outcome.entry.buffer.byteLength <= RUNTIME_MAX_ITEM) {
    const value: StoredImage = {
      data: Buffer.from(outcome.entry.buffer).toString('base64'),
      contentType: outcome.entry.contentType,
    };
    try {
      await cache.set(key, value, { ttl: RUNTIME_TTL, tags: ['avatar'] });
    } catch (error) {
      console.warn(`⚠️ 运行时缓存写入失败: ${key}`, error);
    }
  }

  return imageResponse(outcome.entry, false);
}
