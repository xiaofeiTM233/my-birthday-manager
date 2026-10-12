// app/calendar/page.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { Layout, Card, Avatar, Select, Spin, Empty, Tooltip, Button, Space } from 'antd';
import { LeftOutlined, GithubOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

const { Header, Content } = Layout;

interface BirthdayData {
  _id: string;
  name: string;
  month: number;
  day: number;
  label: string;
  note: string;
  createdAt: string;
}

// 分组配色（按分组名哈希取色，保证同一分组颜色稳定）
const LABEL_COLORS = ['#722ed1', '#13c2c2', '#2f54eb', '#eb2f96', '#52c41a', '#fa541c', '#faad14', '#597ef7'];

function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return LABEL_COLORS[hash % LABEL_COLORS.length];
}

// 闰年判断
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// 2 月 29 日生日在非闰年按 2 月 28 日展示
function resolveMonthDay(month: number, day: number, year: number): { month: number; day: number } {
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    return { month: 2, day: 28 };
  }
  return { month, day };
}

function dateOf(year: number, month: number, day: number): Dayjs {
  return dayjs(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
}

// 距离下一次生日还剩多少天（0 表示就是今天）
function daysUntilNextBirthday(month: number, day: number, today: Dayjs): number {
  const base = today.startOf('day');
  const thisYear = resolveMonthDay(month, day, base.year());
  let target = dateOf(base.year(), thisYear.month, thisYear.day);
  if (target.isBefore(base)) {
    const nextYear = resolveMonthDay(month, day, base.year() + 1);
    target = dateOf(base.year() + 1, nextYear.month, nextYear.day);
  }
  return target.diff(base, 'day');
}

const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

export default function CalendarPage() {
  const router = useRouter();
  const [data, setData] = useState<BirthdayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [filterLabel, setFilterLabel] = useState<string>(''); // 分组筛选（空 = 全部）

  // 获取数据
  const fetchBirthdays = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/birthdays');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchBirthdays();
  }, []);

  const labelOptions = useMemo(
    () => [...new Set(data.map((item) => item.label))],
    [data]
  );

  const filteredData = useMemo(
    () => (filterLabel ? data.filter((item) => item.label === filterLabel) : data),
    [data, filterLabel]
  );

  // 即将到来：按倒计时天数排序
  const upcoming = useMemo(() => {
    const today = dayjs().startOf('day');
    return filteredData
      .map((item) => ({ ...item, days: daysUntilNextBirthday(item.month, item.day, today) }))
      .sort(
        (a, b) =>
          a.days - b.days ||
          a.month - b.month ||
          a.day - b.day ||
          a.name.localeCompare(b.name, 'zh')
      );
  }, [filteredData]);

  // 全年日历：12 个月
  const months = useMemo(() => {
    const year = dayjs().year();
    const byMonth = new Map<number, BirthdayData[]>();
    for (const item of filteredData) {
      const resolved = resolveMonthDay(item.month, item.day, year);
      const list = byMonth.get(resolved.month) ?? [];
      list.push({ ...item, month: resolved.month, day: resolved.day });
      byMonth.set(resolved.month, list);
    }
    return MONTH_NAMES.map((name, index) => {
      const month = index + 1;
      const list = (byMonth.get(month) ?? []).sort(
        (a, b) => a.day - b.day || a.name.localeCompare(b.name, 'zh')
      );
      return {
        month,
        name,
        list,
        firstWeekday: dateOf(year, month, 1).day(), // 0 = 周日
        daysInMonth: dateOf(year, month, 1).daysInMonth(),
      };
    });
  }, [filteredData]);

  if (!mounted) {
    return null;
  }

  const today = dayjs();
  const total = filteredData.length;

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header style={{ background: '#fff', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 8px #f0f1f2' }}>
        <Space size={4}>
          <span style={{ fontSize: '18px', fontWeight: 'bold' }}>SnapBirthday</span>
          <Button type="text" icon={<LeftOutlined />} onClick={() => router.push('/')}>
            生日管理
          </Button>
          <Button type="primary" onClick={() => router.push('/calendar')}>
            日历
          </Button>
        </Space>
        <Space>
          <Button
            type="text"
            icon={<GithubOutlined />}
            href="https://github.com/xiaofeiTM233/my-birthday-manager"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </Button>
        </Space>
      </Header>

      <Content style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
        <Spin spinning={loading}>
          {/* 上方：即将到来列表 */}
          <Card
            title="即将到来"
            extra={
              <Space>
                <span style={{ color: '#999', fontSize: 13 }}>接下来</span>
                <Select
                  placeholder="全部分组"
                  style={{ width: 130 }}
                  value={filterLabel || undefined}
                  onChange={(value) => setFilterLabel(value ?? '')}
                  allowClear
                  options={[
                    { value: '', label: '全部' },
                    ...labelOptions.map((opt) => ({ value: opt, label: opt })),
                  ]}
                />
              </Space>
            }
            style={{ marginBottom: 24 }}
          >
            {upcoming.length === 0 ? (
              <Empty description="暂无生日数据" />
            ) : (
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
                {upcoming.map((item, index) => {
                  const color = labelColor(item.label);
                  const isToday = item.days === 0;
                  return (
                    <div
                      key={item._id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 14px',
                        background: isToday ? '#fff7e6' : '#fff',
                        borderBottom: index < upcoming.length - 1 ? '1px solid #f5f5f5' : 'none',
                      }}
                    >
                      {/* 分组徽标 */}
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          background: color,
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 600,
                          flexShrink: 0,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          padding: '0 2px',
                        }}
                      >
                        {item.label}
                      </div>
                      <Avatar size={36} style={{ background: color, flexShrink: 0 }}>
                        {item.name.slice(0, 1)}
                      </Avatar>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                        <div style={{ color: '#999', fontSize: 12 }}>{item.month}月{item.day}日</div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: isToday ? '#fa541c' : undefined }}>
                        {isToday ? '今天' : `${item.days} 天`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* 下方：全年日历 */}
          <Card
            title="日历"
            extra={
              <span style={{ color: '#999', fontSize: 13 }}>
                全年一览 · {today.year()} 年 · 共 {total} 个生日
              </span>
            }
          >
            {total === 0 ? (
              <Empty description="暂无生日数据" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
                {months.map((m) => (
                  <div key={m.month} style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                    {/* 月份头部 */}
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #f0f0f0' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{m.name}</span>
                      <span style={{ color: '#999', fontSize: 12 }}>{m.list.length} 个生日</span>
                    </div>
                    <div style={{ padding: 8 }}>
                      {/* 用 1px 间距 + 容器底色画出日历网格线 */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#f0f0f0', border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
                        {WEEKDAY_NAMES.map((w) => (
                          <div key={w} style={{ background: '#fafafa', textAlign: 'center', fontSize: 11, color: '#999', padding: '3px 0' }}>
                            {w}
                          </div>
                        ))}
                        {/* 月初前置空白 */}
                        {Array.from({ length: m.firstWeekday }).map((_, i) => (
                          <div key={`empty-${i}`} style={{ background: '#fff', minHeight: 44 }} />
                        ))}
                        {/* 日期格子 */}
                        {Array.from({ length: m.daysInMonth }).map((_, i) => {
                          const d = i + 1;
                          const dayList = m.list.filter((item) => item.day === d);
                          const isToday = m.month === today.month() + 1 && d === today.date();
                          return (
                            <div key={d} style={{ background: isToday ? '#fff7e6' : '#fff', minHeight: 44, padding: '2px 3px' }}>
                              <div style={{ fontSize: 11, color: isToday ? '#fa541c' : '#999', fontWeight: isToday ? 700 : 400 }}>
                                {d}
                              </div>
                              {dayList.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 2 }}>
                                  {dayList.map((item) => (
                                    <Tooltip key={item._id} title={`${item.name} · ${item.month}月${item.day}日`}>
                                      <Avatar size={16} style={{ background: labelColor(item.label), fontSize: 10 }}>
                                        {item.name.slice(0, 1)}
                                      </Avatar>
                                    </Tooltip>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Spin>
      </Content>
    </Layout>
  );
}
