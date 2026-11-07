// components/CharAvatar.tsx
'use client';
import { useState } from 'react';
import { avatarUrl, labelColor } from '@/lib/avatar';

interface CharAvatarProps {
  name: string;
  label: string;
  size?: number;
  // fill 为 true 时撑满父容器（父容器需为正方形），size 仅用于字号缩放
  fill?: boolean;
  // image 为优先显示真实头像图片，text 为始终显示文字头像
  mode?: 'image' | 'text';
  // 图片模式下加载失败时的兜底：text 显示文字，none 什么都不显示
  fallback?: 'text' | 'none';
}

export default function CharAvatar({
  name,
  label,
  size = 36,
  fill = false,
  mode = 'image',
  fallback = 'text',
}: CharAvatarProps) {
  const url = avatarUrl(name, label);
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [loadedUrl, setLoadedUrl] = useState(url);

  // 头像地址变化时重置加载状态（渲染期调整 state，避免 effect 里 setState）
  if (loadedUrl !== url) {
    setLoadedUrl(url);
    setState('pending');
  }

  const color = labelColor(label);
  const initial = name.slice(0, 1);
  const dim = fill ? '100%' : size;
  const fontSize = Math.max(10, Math.round(size * 0.4));

  // 文字模式：始终展示文字头像
  if (mode === 'text') {
    return (
      <div
        style={{
          width: dim,
          height: dim,
          borderRadius: '50%',
          background: color,
          color: '#fff',
          fontSize,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        {initial}
      </div>
    );
  }

  // 图片模式且不显示兜底内容时，未加载成功前不渲染任何元素
  if (fallback === 'none' && state !== 'ok') {
    return null;
  }

  return (
    <div
      style={{
        position: 'relative',
        width: dim,
        height: dim,
        borderRadius: '50%',
        background: color,
        color: '#fff',
        fontSize,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={name}
        width={fill ? undefined : size}
        height={fill ? undefined : size}
        style={{
          objectFit: 'cover',
          width: '100%',
          height: '100%',
          display: state === 'ok' ? 'block' : 'none',
          position: 'absolute',
          inset: 0,
        }}
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
      />
      {state !== 'ok' && fallback === 'text' && <span>{initial}</span>}
    </div>
  );
}
