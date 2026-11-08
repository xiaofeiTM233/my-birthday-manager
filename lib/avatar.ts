// lib/avatar.ts
// 头像相关的共享工具：分组配色 + 头像代理地址 + 服务端头像解析

// 分组配色（按分组名哈希取色，保证同一分组颜色稳定）
export const LABEL_COLORS = ['#722ed1', '#13c2c2', '#2f54eb', '#eb2f96', '#52c41a', '#fa541c', '#faad14', '#597ef7'];

export function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return LABEL_COLORS[hash % LABEL_COLORS.length];
}

// 客户端用的代理地址
export function avatarUrl(name: string, game?: string): string | undefined {
  if (game !== 'A' && game !== 'EC' && game !== 'EW' && game !== 'B' && game !== 'S') return undefined;
  const params = new URLSearchParams({ game, name });
  return `/api/avatar?${params.toString()}`;
}

// 素材地址；null 查无此图，undefined 名称表不可用（可重试）
type Target = string | null | undefined;

// 按名字在 id -> 名字 的表里反查 id
async function lookupId(url: string, name: string): Promise<Target> {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`⚠️ 名称表获取失败: ${url} -> ${res.status}`);
    return undefined;
  }
  // 同名多 id 时取先出现的，如 宏愿 的 wpn_sword_0021 与 wpn_sword_0021_ink
  for (const [id, value] of Object.entries((await res.json()) as Record<string, string>)) {
    if (value === name) return id;
  }
  return null;
}

// 明日方舟头像，prts 按名字取图
async function avatarA(name: string): Promise<Target> {
  return `https://prts.wiki/w/Special:Redirect/file/头像_${name}.png`;
}

// 终末地角色头像
async function avatarEC(name: string): Promise<Target> {
  const charId = await lookupId(
    'https://fastly.jsdelivr.net/gh/cmyyx/cep/src/generated/i18n/characters/zh-CN.json',
    name
  );
  // 名称表不可用，下次请求再试
  if (charId === undefined) return undefined;
  if (!charId) return null;
  return `https://data.akedata.wiki/public/images/assets/beyond/dynamicassets/gameplay/ui/sprites/charremoteicon/icon_${charId}.png`;
}

// 终末地武器头像
async function avatarEW(name: string): Promise<Target> {
  const weaponId = await lookupId(
    'https://fastly.jsdelivr.net/gh/cmyyx/cep/src/generated/i18n/weapons/zh-CN.json',
    name
  );
  if (weaponId === undefined) return undefined;
  if (!weaponId) return null;
  return `https://data.akedata.wiki/public/images/assets/beyond/dynamicassets/gameplay/ui/sprites/itemiconbig/${weaponId}.png`;
}

// 蔚蓝档案头像
async function avatarB(name: string): Promise<Target> {
  const res = await fetch('https://schaledb.com/data/cn/students.min.json');
  if (!res.ok) {
    console.warn(`⚠️ schaledb 学生名单获取失败: ${res.status}`);
    return undefined;
  }
  for (const student of Object.values(
    (await res.json()) as Record<string, { Id?: number; Name?: string; FamilyName?: string }>
  )) {
    if (typeof student.Id !== 'number') continue;
    // 记录里可能只有名，也可能带姓氏
    if (student.Name === name || `${student.FamilyName ?? ''}${student.Name}` === name) {
      return `https://schaledb.com/images/student/icon/${student.Id}.webp`;
    }
  }
  return null;
}

// 星塔旅人头像，图标路径由名单给出
async function avatarS(name: string): Promise<Target> {
  const res = await fetch('https://stella.ennead.cc/api/stella/characters?lang=CN');
  if (!res.ok) {
    console.warn(`⚠️ 星塔旅人名单获取失败: ${res.status}`);
    return undefined;
  }
  const list = (await res.json()) as { id?: number; name?: string; icon?: string }[];
  const hit = list.find((item) => item.name === name);
  if (!hit?.icon) return null;
  return `https://api.ennead.cc${hit.icon}`;
}

// 同一张图的并发请求合并成一次拉取
const pendingFetch = new Map<string, Promise<Response | 'missing' | 'failed'>>();
// 上游同时最多 4 个拉取，超出的排队，避免上游压力过大
let activeFetches = 0;
const fetchQueue: (() => void)[] = [];

// 查无此图，浏览器与 CDN 都缓存一小时，避免重复探测
function notFoundResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'CDN-Cache-Control': 'public, s-maxage=3600',
    },
  });
}

// 图片响应，浏览器缓存一年，Vercel CDN 缓存 30 天
function imageResponse(buffer: BodyInit, contentType: string): Response {
  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'CDN-Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=604800, stale-if-error=604800',
    },
  });
}

// 统一入口：解析素材地址、拉取并交给 CDN 缓存
export async function getAvatarResponse(game: string, name: string): Promise<Response> {
  if (!name || (game !== 'A' && game !== 'EC' && game !== 'EW' && game !== 'B' && game !== 'S')) {
    return Response.json(
      { code: -1, data: null, msg: '无效的 game 或 name 参数' },
      { status: 400 }
    );
  }
  // 缓存按游戏隔离，同名角色在不同游戏来自不同站点
  const key = `${game}:${name}`;
  // 同一张图的并发请求共用一次拉取
  let task = pendingFetch.get(key);
  if (!task) {
    task = (async (): Promise<Response | 'missing' | 'failed'> => {
      // 都没命中说明 game 非法，target 保持 null 走 404
      let target: Target = null;
      if (game === 'A') target = await avatarA(name);
      else if (game === 'EC') target = await avatarEC(name);
      else if (game === 'EW') target = await avatarEW(name);
      else if (game === 'B') target = await avatarB(name);
      else if (game === 'S') target = await avatarS(name);
      // 名称表拉不到属于偶发故障，下次请求再试
      if (target === undefined) return 'failed';
      if (target === null) return 'missing';
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
      };
      if (new URL(target).hostname === 'prts.wiki') {
        headers.Cookie = 'within.website-x-cmd-sisyphus-auth';
      }
      if (new URL(target).hostname === 'schaledb.com') {
        headers.Referer = 'https://schaledb.com/';
      }
      // 偶发故障重试一次，避免单次超时导致头像长时间空白
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          // 占用一个上游拉取名额，达到上限时排队等
          const upstream = await new Promise<Response>((resolve, reject) => {
            const run = () => {
              activeFetches += 1;
              fetch(target, { headers, redirect: 'follow', signal: AbortSignal.timeout(10000) })
                .then(resolve, reject)
                .finally(() => {
                  activeFetches -= 1;
                  const next = fetchQueue.shift();
                  if (next) next();
                });
            };
            if (activeFetches < 4) run();
            else fetchQueue.push(run);
          });
          // 上游明确 404 才算查无此人，其它状态码可能是反爬或临时故障
          if (upstream.status === 404) return 'missing';
          const contentType = upstream.headers.get('content-type') ?? '';
          if (!upstream.ok || !contentType.startsWith('image/')) {
            console.warn(`⚠️ 头像获取失败: ${key} -> ${upstream.status} ${contentType}`);
            return 'failed';
          }
          return imageResponse(await upstream.arrayBuffer(), contentType);
        } catch (error) {
          // 超时与连接重置属偶发故障，短暂等待后重试
          console.warn(`⚠️ 头像拉取异常: ${key}:`, error);
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }
      console.error(`❌ 头像拉取失败: ${key}: 重试后仍未取到`);
      return 'failed';
    })();
    pendingFetch.set(key, task);
    task.finally(() => pendingFetch.delete(key)).catch(() => {});
  }
  const result = await task;
  if (result === 'missing') return notFoundResponse();
  // 上游临时故障返回 503，边缘缓存才能用 stale-if-error 顶上旧图
  if (result === 'failed') {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return result;
}