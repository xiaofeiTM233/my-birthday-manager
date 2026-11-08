// app/api/avatar/route.ts
import { NextRequest } from 'next/server';
import { getAvatarResponse } from '@/lib/avatar';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  return getAvatarResponse(
    searchParams.get('game') ?? '',
    (searchParams.get('name') ?? '').trim()
  );
}