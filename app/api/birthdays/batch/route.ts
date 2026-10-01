// app/api/birthdays/batch/route.ts
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import BirthdayEntry from '@/models/BirthdayEntry';

// 每月最大天数（2 月取 29，支持 2/29 生日）
const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface BatchResult {
  original?: string;
  name?: string | null;
  status: 'success' | 'error' | 'skipped';
  error?: string | null;
}

interface BatchItem {
  original?: string;
  name?: string;
  month?: number | string;
  day?: number | string;
  label?: string;
  note?: string;
}

// 校验月日合法性
function isValidDate(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > MAX_DAYS[month - 1]) return false;
  return true;
}

export async function POST(request: Request) {
  await dbConnect();
  const body = await request.json();
  const { items } = body as { items?: BatchItem[] };

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ success: false, message: '缺少导入数据' }, { status: 400 });
  }

  // 获取所有现有数据用于查重（仅取查重所需字段）
  const allEntries = await BirthdayEntry.find({});
  const existing = allEntries.map((entry) => ({
    name: entry.name as string,
    month: entry.month as number,
    day: entry.day as number,
  }));

  const results: BatchResult[] = [];
  const toInsert: { name: string; month: number; day: number; label: string; note?: string }[] = [];

  for (const item of items) {
    const { name, month, day, label, note, original } = item;

    if (!name || !label) {
      results.push({
        original: original || name,
        name,
        status: 'error',
        error: '缺少姓名或分组',
      });
      continue;
    }

    const m = Number(month);
    const d = Number(day);
    if (!isValidDate(m, d)) {
      results.push({
        original: original || name,
        name,
        status: 'error',
        error: '无效的生日日期',
      });
      continue;
    }

    const trimmedName = String(name).trim();

    // 查重：同一姓名 + 同一月 + 同一日 视为重复
    const duplicate = existing.find(
      (entry) => entry.name === trimmedName && entry.month === m && entry.day === d
    );

    if (duplicate) {
      results.push({
        original: original || name,
        name: trimmedName,
        status: 'skipped',
        error: '重复',
      });
      continue;
    }

    // 标记为待插入
    toInsert.push({ name: trimmedName, month: m, day: d, label, note });
    // 添加到 existing，避免同批次内重复检测失效
    existing.push({ name: trimmedName, month: m, day: d });
    results.push({
      original: original || name,
      name: trimmedName,
      status: 'success',
      error: null,
    });
  }

  // 批量执行数据库操作
  try {
    if (toInsert.length > 0) {
      await BirthdayEntry.insertMany(toInsert);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '服务器错误';
    return NextResponse.json({ success: false, message: errorMessage }, { status: 500 });
  }

  return NextResponse.json({ success: true, results });
}
