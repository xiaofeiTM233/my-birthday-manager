// app/api/catalog/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCatalog, isCatalogGame } from '@/lib/catalog';

export async function GET(request: NextRequest) {
  const game = request.nextUrl.searchParams.get('game') ?? '';
  if (!isCatalogGame(game)) {
    return NextResponse.json(
      { success: false, message: '不支持的图鉴来源，仅支持 B / S' },
      { status: 400 }
    );
  }

  const items = await getCatalog(game);
  if (!items) {
    return NextResponse.json(
      { success: false, message: '图鉴拉取失败，请稍后重试' },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { success: true, data: items },
    { headers: { 'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=86400' } }
  );
}