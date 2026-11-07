// lib/avatar.ts
// 头像相关的共享工具：分组配色 + 头像代理地址

// 分组配色（按分组名哈希取色，保证同一分组颜色稳定）
export const LABEL_COLORS = ['#722ed1', '#13c2c2', '#2f54eb', '#eb2f96', '#52c41a', '#fa541c', '#faad14', '#597ef7'];

export function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return LABEL_COLORS[hash % LABEL_COLORS.length];
}

// 头像代理地址：分组（game）+ 姓名
export function avatarUrl(name: string, label: string): string {
  const params = new URLSearchParams({ name, game: label });
  return `/api/avatar?${params.toString()}`;
}
