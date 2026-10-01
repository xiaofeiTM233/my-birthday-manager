'use client';

import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';

// 让 dayjs 使用中文 locale（DatePicker 面板的月份/星期等文本依赖它）
dayjs.locale('zh-cn');

export default function Providers({ children }: { children: React.ReactNode }) {
  return <ConfigProvider locale={zhCN}>{children}</ConfigProvider>;
}
