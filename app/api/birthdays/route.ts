// app/api/birthdays/route.ts
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import BirthdayEntry from '@/models/BirthdayEntry';

// 每月最大天数（2 月取 29，支持 2/29 生日）
const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// 校验月日合法性
function isValidDate(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > MAX_DAYS[month - 1]) return false;
  return true;
}

// 转义正则特殊字符，防止用户输入破坏查询
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request: Request) {
  await dbConnect();
  const { searchParams } = new URL(request.url);
  const label = searchParams.get('label');
  const name = searchParams.get('name');

  // 按姓名模糊查询 + 分组过滤
  const query: Record<string, unknown> = {};
  if (label) query.label = label;
  if (name) query.name = { $regex: escapeRegex(name.trim()), $options: 'i' };

  const birthdays = await BirthdayEntry.find(query).sort({ createdAt: -1 });

  return NextResponse.json({ success: true, data: birthdays });
}

export async function POST(request: Request) {
  await dbConnect();
  const body = await request.json();
  const { name, month, day, label, note } = body;

  if (!name || !label) {
    return NextResponse.json({ success: false, message: '缺少姓名或分组' }, { status: 400 });
  }

  const m = Number(month);
  const d = Number(day);
  if (!isValidDate(m, d)) {
    return NextResponse.json({ success: false, message: '无效的生日日期（月份 1-12，日期需符合当月天数）' }, { status: 400 });
  }

  try {
    const newEntry = await BirthdayEntry.create({
      name: String(name).trim(),
      month: m,
      day: d,
      label,
      note,
    });
    return NextResponse.json({ success: true, data: newEntry });
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code === 11000) {
      return NextResponse.json({ success: false, message: '该姓名的这条生日记录已存在' }, { status: 409 });
    }
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ success: false, message: errorMessage }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  await dbConnect();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  await BirthdayEntry.findByIdAndDelete(id);
  return NextResponse.json({ success: true });
}
