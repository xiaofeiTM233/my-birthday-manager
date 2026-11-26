// app/page.tsx
'use client';
import { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Layout, Table, Input, Button, Form, Tag, Select, message, Card, Modal, DatePicker, Space, Divider } from 'antd';
import type { InputRef } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, UploadOutlined, DownloadOutlined, GithubOutlined, CalendarOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import CharAvatar from '@/components/CharAvatar';
import type { CatalogGame, CatalogItem } from '@/lib/catalog';

const { Header, Content } = Layout;
const { TextArea } = Input;

// 生日日期选择器固定使用的年份（闰年，使 2 月 29 日可选择）
const FIXED_YEAR = 2000;

interface BirthdayData {
  _id: string;
  name: string;
  month: number;
  day: number;
  label: string;
  note: string;
  createdAt: string;
}

interface BatchResult {
  original?: string;
  name?: string | null;
  status: 'success' | 'error' | 'skipped';
  error?: string | null;
}

interface BatchItem {
  original: string;
  name: string | null;
  month?: number;
  day?: number;
  label?: string;
  note?: string;
  error?: string;
}

interface FormValues {
  name: string;
  birthday: Dayjs;
  label: string | string[];
  note?: string;
}

// 图鉴条目在预览表格与「已有」集合中的唯一键
function catalogKey(item: { name: string; month: number; day: number }): string {
  return `${item.name}|${item.month}|${item.day}`;
}

// 从一行文本解析生日和姓名，固定格式：姓名 日期（空格分隔，姓名在前）
// 日期支持两种写法：① 中文格式「1月1日」（结尾「日/号」可省略）② 分隔符格式「1-1」，
// 分隔符支持 - / . , （半角或全角逗号），纯数字无需前导零
function parseBirthdayLine(line: string): { name: string; month: number; day: number } | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length !== 2) return null; // 格式：姓名 日期

  const [name, dateToken] = tokens;
  if (!name || /^\d+$/.test(name)) return null; // 姓名缺失或纯数字视为无效

  const match = dateToken.match(/^(?:(\d{1,2})月(\d{1,2})[日号]?|(\d{1,2})[-/.,，](\d{1,2}))$/);
  if (!match) return null;

  const month = parseInt(match[1] ?? match[3], 10);
  const day = parseInt(match[2] ?? match[4], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return { name, month, day };
}

export default function Home() {
  const router = useRouter();
  const [data, setData] = useState<BirthdayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  // 编辑弹窗
  const [editForm] = Form.useForm();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BirthdayData | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [filterLabel, setFilterLabel] = useState<string>('');
  const [filterName, setFilterName] = useState<string>('');
  const [filterBirthday, setFilterBirthday] = useState<Dayjs | null>(null); // 生日筛选（仅月日）
  const [mounted, setMounted] = useState(false);
  const [labelOptions, setLabelOptions] = useState<string[]>(['A', 'B', 'C']); // 存储所有可用的组
  const [selectedLabel, setSelectedLabel] = useState<string>('A'); // 当前选择的组
  const [batchImportModalOpen, setBatchImportModalOpen] = useState(false); // 批量导入模态框
  const [batchImportText, setBatchImportText] = useState<string>(''); // 批量导入文本
  const [batchImportLabel, setBatchImportLabel] = useState<string>('A'); // 批量导入的组
  const [batchImportNote, setBatchImportNote] = useState<string>(''); // 批量导入的备注
  const [batchImportResults, setBatchImportResults] = useState<BatchResult[]>([]); // 批量导入结果
  const [exportFormat, setExportFormat] = useState<'line' | 'csv'>('line'); // 导出格式：line(一行一个) 或 csv(逗号分隔)
  const [pageSize, setPageSize] = useState(10); // 每页条数
  const [newLabelInput, setNewLabelInput] = useState(''); // 添加分组输入框的值
  const addLabelInputRef = useRef<InputRef>(null); // 添加分组输入框引用
  // 头像 图/文 模式，与日历页共用
  const [avatarMode, setAvatarMode] = useState<'image' | 'text'>('image');
  // 图鉴导入模态框
  const [catalogModalOpen, setCatalogModalOpen] = useState(false);
  const [catalogGame, setCatalogGame] = useState<CatalogGame>('B');
  const [catalogLabel, setCatalogLabel] = useState<string>('B');
  const [catalogNote, setCatalogNote] = useState<string>('');
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogExisting, setCatalogExisting] = useState<Set<string>>(new Set());
  const [catalogSelectedKeys, setCatalogSelectedKeys] = useState<React.Key[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogResults, setCatalogResults] = useState<BatchResult[]>([]);
  const [catalogPageSize, setCatalogPageSize] = useState(10);
  // 标记最近一次图鉴请求，避免快速切换来源时旧响应覆盖新数据
  const catalogRequestRef = useRef(0);

  // 添加新分组
  const handleAddLabel = (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    e.preventDefault();
    const value = newLabelInput.trim();
    if (!value) {
      message.warning('请输入分组名称');
      return;
    }
    if (labelOptions.includes(value)) {
      message.warning(`分组 ${value} 已存在`);
      return;
    }
    setLabelOptions([...labelOptions, value]);
    setNewLabelInput('');
    message.success(`分组 ${value} 添加成功`);
    setTimeout(() => {
      addLabelInputRef.current?.focus();
    }, 0);
  };

  // 分组选择下拉框：在选项列表下方提供添加分组入口
  const renderGroupPopup = (menu: React.ReactNode) => (
    <>
      {menu}
      <Divider style={{ margin: '8px 0' }} />
      <Space style={{ padding: '0 8px 4px' }}>
        <Input
          placeholder="输入新分组名称"
          ref={addLabelInputRef}
          value={newLabelInput}
          onChange={(e) => setNewLabelInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') handleAddLabel(e as unknown as React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>);
          }}
        />
        <Button icon={<PlusOutlined />} onClick={handleAddLabel}>
        </Button>
      </Space>
    </>
  );

  // 获取数据
  const fetchBirthdays = async (label = '', name = '', birthday: Dayjs | null = null) => {
    setLoading(true);
    try {
      let url = '/api/birthdays';
      const params = new URLSearchParams();
      if (label && label !== 'All') params.append('label', label);
      if (name) params.append('name', name);
      if (birthday) {
        params.append('month', String(birthday.month() + 1));
        params.append('day', String(birthday.date()));
      }
      if (params.toString()) url += '?' + params.toString();

      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        // 只在无过滤条件时更新组选项，避免过滤查询时丢失其他组
        if (!label && !name && !birthday) {
          const labels = [...new Set(json.data.map((item: BirthdayData) => item.label))] as string[];
          setLabelOptions(labels);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // 从localStorage加载保存的数据
  useEffect(() => {
    const savedLabels = localStorage.getItem('labelOptions');
    const savedSelectedLabel = localStorage.getItem('selectedLabel');

    if (savedLabels) {
      setLabelOptions(JSON.parse(savedLabels));
    }

    if (savedSelectedLabel) {
      setSelectedLabel(savedSelectedLabel);
    }

    // 读取头像展示模式（默认图片模式）
    const savedAvatarMode = localStorage.getItem('avatarMode');
    if (savedAvatarMode === 'image' || savedAvatarMode === 'text') {
      setAvatarMode(savedAvatarMode);
    }

    setMounted(true);
    fetchBirthdays();
  }, []);

  // 保存到localStorage
  const saveToLocalStorage = (options: string[], selected: string) => {
    localStorage.setItem('labelOptions', JSON.stringify(options));
    localStorage.setItem('selectedLabel', selected);
  };

  // 当labelOptions或selectedLabel变化时保存
  useEffect(() => {
    if (mounted) {
      saveToLocalStorage(labelOptions, selectedLabel);
    }
  }, [labelOptions, selectedLabel, mounted]);

  // 初始化表单默认值
  useEffect(() => {
    if (mounted) {
      form.setFieldsValue({ label: [selectedLabel] }); // mode="tags" 需要数组格式
    }
  }, [mounted, form, selectedLabel]);

  // 提交数据
  const onFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      // 获取label值，可能是数组也可能是字符串
      const labelValue = Array.isArray(values.label) ? values.label[0] : values.label;

      // 如果是新组，添加到选项列表
      if (!labelOptions.includes(labelValue)) {
        const newOptions = [...labelOptions, labelValue];
        setLabelOptions(newOptions);
      }

      // 更新当前选择的组
      setSelectedLabel(labelValue);

      // 从 DatePicker 的 dayjs 对象中提取月日
      const birthday = values.birthday;
      if (!birthday || !labelValue) {
        message.error('请完整填写姓名、生日和分组');
        return;
      }
      const payload = {
        name: values.name,
        month: birthday.month() + 1,
        day: birthday.date(),
        note: values.note,
        label: labelValue,
      };

      const res = await fetch('/api/birthdays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (res.status === 200 && json.success) {
        message.success('生日添加成功');
        form.setFieldsValue({ label: [labelValue] }); // 保持当前选择的组，使用数组格式
        form.setFieldsValue({ name: '', birthday: null }); // 只清空姓名和生日，保留分组和备注供下一次使用
        fetchBirthdays(filterLabel, filterName, filterBirthday); // 刷新列表
      } else {
        message.error(json.message || '添加失败');
      }
    } catch {
      message.error('网络请求错误');
    } finally {
      setLoading(false);
    }
  };

  // 删除数据
  const handleDelete = async (id: string) => {
    await fetch(`/api/birthdays?id=${id}`, { method: 'DELETE' });
    message.success('已删除');
    fetchBirthdays(filterLabel, filterName, filterBirthday);
  };

  // 打开编辑弹窗
  const handleOpenEdit = (record: BirthdayData) => {
    setEditingRecord(record);
    editForm.setFieldsValue({
      name: record.name,
      // 月日固定挂在闰年上，2 月 29 日也能正常显示
      birthday: dayjs(
        `${FIXED_YEAR}-${String(record.month).padStart(2, '0')}-${String(record.day).padStart(2, '0')}`
      ),
      label: [record.label],
      note: record.note || '',
    });
    setEditModalOpen(true);
  };

  // 保存编辑
  const handleUpdate = async () => {
    if (!editingRecord) return;

    let values: FormValues;
    try {
      values = await editForm.validateFields();
    } catch {
      return;
    }

    const labelValue = Array.isArray(values.label) ? values.label[0] : values.label;
    if (!values.birthday || !labelValue) {
      message.error('请完整填写姓名、生日和分组');
      return;
    }

    setEditSaving(true);
    try {
      const res = await fetch(`/api/birthdays?id=${editingRecord._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          month: values.birthday.month() + 1,
          day: values.birthday.date(),
          label: labelValue,
          note: values.note,
        }),
      });
      const json: { success: boolean; message?: string } = await res.json();

      if (!res.ok || !json.success) {
        message.error(json.message || '保存失败');
        return;
      }

      if (!labelOptions.includes(labelValue)) {
        setLabelOptions([...labelOptions, labelValue]);
      }
      message.success('已保存');
      setEditModalOpen(false);
      setEditingRecord(null);
      fetchBirthdays(filterLabel, filterName, filterBirthday);
    } catch {
      message.error('网络请求错误');
    } finally {
      setEditSaving(false);
    }
  };

  // 导出数据
  const handleExport = () => {
    if (data.length === 0) {
      message.warning('当前没有数据可导出');
      return;
    }

    // 对数据进行排序：按月日排序
    const sortedData = [...data].sort((a, b) =>
      a.month - b.month || a.day - b.day || a.name.localeCompare(b.name, 'zh')
    );

    let content = '';

    if (exportFormat === 'line') {
      // 一行一个格式：姓名 月-日（纯数字，无前导零）
      content = sortedData.map(item => `${item.name} ${item.month}-${item.day}`).join('\n');
    } else {
      // 逗号分隔格式：姓名,月-日
      content = sortedData.map(item => `${item.name},${item.month}-${item.day}`).join(',');
    }

    // 创建Blob并下载
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);

    // 生成文件名
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const fileName = `birthday_export_${dateStr}.txt`;

    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    message.success(`已导出 ${data.length} 条生日记录`);
  };

  // 打开批量导入模态框
  const handleOpenBatchImport = () => {
    setBatchImportText('');
    setBatchImportLabel(selectedLabel);
    setBatchImportNote('');
    setBatchImportResults([]);
    setBatchImportModalOpen(true);
  };

  // 批量导入处理
  const handleBatchImport = async () => {
    if (!batchImportText.trim()) {
      message.warning('请输入要导入的生日记录');
      return;
    }

    if (!batchImportLabel) {
      message.warning('请选择分组');
      return;
    }

    setLoading(true);

    try {
      // 解析输入的生日记录
      const lines = batchImportText.split('\n').filter(line => line.trim());
      const items: BatchItem[] = [];

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const parsed = parseBirthdayLine(trimmedLine);
        if (!parsed) {
          items.push({
            original: trimmedLine,
            name: null,
            error: '无法解析（格式：姓名 1月1日 或 姓名 月-日，空格分隔）',
          });
        } else {
          items.push({
            original: trimmedLine,
            ...parsed,
            label: batchImportLabel,
            note: batchImportNote,
          });
        }
      }

      // 调用批量导入API
      const res = await fetch('/api/birthdays/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json: { success: boolean; message?: string; results?: BatchResult[] } = await res.json();

      setLoading(false);

      if (json.success) {
        const results = json.results ?? [];
        setBatchImportResults(results);

        const successCount = results.filter((r) => r.status === 'success').length;
        const errorCount = results.filter((r) => r.status === 'error').length;
        const skippedCount = results.filter((r) => r.status === 'skipped').length;

        if (errorCount === 0) {
          message.success(`批量导入成功！成功 ${successCount} 个，跳过 ${skippedCount} 个`);
        } else {
          message.warning(`批量导入部分完成！成功 ${successCount} 个，错误 ${errorCount} 个，跳过 ${skippedCount} 个`);
        }

        // 更新组选项
        if (!labelOptions.includes(batchImportLabel)) {
          const newOptions = [...labelOptions, batchImportLabel];
          setLabelOptions(newOptions);
        }
      } else {
        message.error(json.message || '批量导入失败');
      }
    } catch {
      setLoading(false);
      message.error('网络请求错误');
    }
  };

  // 拉取图鉴名单，同时取全部现有记录用于标记「已有」
  const loadCatalog = async (game: CatalogGame) => {
    const requestId = catalogRequestRef.current + 1;
    catalogRequestRef.current = requestId;
    setCatalogLoading(true);
    setCatalogResults([]);
    try {
      const [catalogRes, allRes] = await Promise.all([
        fetch(`/api/catalog?game=${game}`),
        fetch('/api/birthdays'),
      ]);
      const catalogJson: { success: boolean; message?: string; data?: CatalogItem[] } =
        await catalogRes.json();
      const allJson: { success: boolean; data?: BirthdayData[] } = await allRes.json();

      // 已有更新的一次请求，丢弃本次结果
      if (catalogRequestRef.current !== requestId) return;

      if (!catalogJson.success || !catalogJson.data) {
        setCatalogItems([]);
        setCatalogSelectedKeys([]);
        message.error(catalogJson.message || '图鉴拉取失败');
        return;
      }

      const existing = new Set(
        (allJson.success ? allJson.data ?? [] : []).map((item) => catalogKey(item))
      );
      setCatalogExisting(existing);
      setCatalogItems(catalogJson.data);
      // 默认勾选所有尚未导入的角色
      setCatalogSelectedKeys(
        catalogJson.data.filter((item) => !existing.has(catalogKey(item))).map(catalogKey)
      );
    } catch {
      if (catalogRequestRef.current !== requestId) return;
      setCatalogItems([]);
      setCatalogSelectedKeys([]);
      message.error('图鉴拉取失败，请稍后重试');
    } finally {
      if (catalogRequestRef.current === requestId) setCatalogLoading(false);
    }
  };

  // 打开图鉴导入模态框
  const handleOpenCatalog = () => {
    setCatalogModalOpen(true);
    setCatalogGame('B');
    setCatalogLabel('B');
    setCatalogNote('');
    setCatalogSearch('');
    setCatalogResults([]);
    setCatalogItems([]);
    setCatalogSelectedKeys([]);
    void loadCatalog('B');
  };

  // 切换图鉴来源
  const handleCatalogGameChange = (game: CatalogGame) => {
    setCatalogGame(game);
    setCatalogLabel(game);
    setCatalogSearch('');
    setCatalogItems([]);
    setCatalogSelectedKeys([]);
    void loadCatalog(game);
  };

  // 导入选中
  const handleCatalogImport = async () => {
    const selected = catalogItems.filter((item) => catalogSelectedKeys.includes(catalogKey(item)));
    if (selected.length === 0) {
      message.warning('请选择要导入的角色');
      return;
    }
    if (!catalogLabel) {
      message.warning('请选择分组');
      return;
    }

    setCatalogImporting(true);
    try {
      const items: BatchItem[] = selected.map((item) => ({
        original: `${item.name} ${item.month}-${item.day}`,
        name: item.name,
        month: item.month,
        day: item.day,
        label: catalogLabel,
        note: catalogNote.trim() || undefined,
      }));
      const res = await fetch('/api/birthdays/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json: { success: boolean; message?: string; results?: BatchResult[] } = await res.json();
      if (!json.success) {
        message.error(json.message || '导入失败');
        return;
      }

      const results = json.results ?? [];
      setCatalogResults(results);
      const successCount = results.filter((r) => r.status === 'success').length;
      const errorCount = results.filter((r) => r.status === 'error').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;
      message.success(
        `导入完成：成功 ${successCount} 个，跳过 ${skippedCount} 个${errorCount ? `，错误 ${errorCount} 个` : ''}`
      );

      // 已处理的条目在预览里标记为已有，避免重复点选
      setCatalogExisting((prev) => {
        const next = new Set(prev);
        for (const item of selected) next.add(catalogKey(item));
        return next;
      });
      setCatalogSelectedKeys([]);

      if (!labelOptions.includes(catalogLabel)) {
        setLabelOptions([...labelOptions, catalogLabel]);
      }
      fetchBirthdays(filterLabel, filterName, filterBirthday);
    } catch {
      message.error('网络请求错误');
    } finally {
      setCatalogImporting(false);
    }
  };

  // 表格列定义
  const columns = [
    {
      title: '头像',
      key: 'avatar',
      width: 60,
      render: (_value: unknown, record: BirthdayData) => (
        // 图片模式下取不到头像则不展示 Avatar 组件
        <CharAvatar
          name={record.name}
          label={record.label}
          size={32}
          mode={avatarMode}
          fallback="none"
        />
      ),
    },
    {
      title: '分组',
      dataIndex: 'label',
      key: 'label',
      width: 100,
      render: (text: string) => <Tag color={text === 'A' ? 'blue' : text === 'B' ? 'green' : 'default'}>{text}</Tag>,
    },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <b>{text}</b>,
    },
    {
      title: '生日 (月-日)',
      key: 'birthday',
      width: 130,
      render: (_value: unknown, record: BirthdayData) => (
        <b style={{ fontFamily: 'monospace' }}>
          {record.month}-{record.day}
        </b>
      ),
      // 按月日排序，方便查看生日先后
      sorter: (a: BirthdayData, b: BirthdayData) => a.month - b.month || a.day - b.day,
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      width: 200,
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      render: (_value: unknown, record: BirthdayData) => (
        <Space size={0}>
          <Button
            type="text"
            icon={<EditOutlined />}
            title="编辑"
            onClick={() => handleOpenEdit(record)}
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            title="删除"
            onClick={() => handleDelete(record._id)}
          />
        </Space>
      ),
    },
  ];

  // 图鉴预览列
  const catalogColumns = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '生日',
      key: 'birthday',
      width: 110,
      render: (_value: unknown, record: CatalogItem) => `${record.month}月${record.day}日`,
    },
    {
      title: '学校 / 阵营',
      dataIndex: 'extra',
      key: 'extra',
      width: 180,
      render: (value?: string) => value || '-',
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_value: unknown, record: CatalogItem) =>
        catalogExisting.has(catalogKey(record)) ? <Tag>已有</Tag> : <Tag color="green">新增</Tag>,
    },
  ];

  const catalogKeyword = catalogSearch.trim();
  const catalogFiltered = catalogItems.filter(
    (item) =>
      !catalogKeyword ||
      item.name.includes(catalogKeyword) ||
      (item.extra ?? '').includes(catalogKeyword)
  );
  const catalogNewCount = catalogItems.filter(
    (item) => !catalogExisting.has(catalogKey(item))
  ).length;

  if (!mounted) {
    return null;
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header style={{ background: '#fff', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 8px #f0f1f2' }}>
        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>SnapBirthday</div>
        <Space>
          <Button
            type="text"
            icon={<CalendarOutlined />}
            onClick={() => router.push('/calendar')}
          >
            日历
          </Button>
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

        {/* 输入区域 */}
        <Card
          title="添加生日"
          style={{ marginBottom: 24 }}
          extra={
            <Space>
              <Button
                type="default"
                icon={<CloudDownloadOutlined />}
                onClick={handleOpenCatalog}
              >
                图鉴导入
              </Button>
              <Button
                type="default"
                icon={<UploadOutlined />}
                onClick={handleOpenBatchImport}
              >
                批量导入
              </Button>
            </Space>
          }
        >
          <Form form={form} layout="horizontal" onFinish={onFinish}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <Form.Item
                name="name"
                rules={[{ required: true, message: '请输入姓名' }]}
                style={{ flex: 1.5, marginBottom: 0 }}
              >
                <Input
                  placeholder="姓名，例如: 张三"
                  allowClear
                />
              </Form.Item>
              <Form.Item
                name="birthday"
                rules={[{ required: true, message: '请选择生日' }]}
                style={{ flex: 1, marginBottom: 0 }}
              >
                <DatePicker
                  picker="date"
                  format="M-D"
                  placeholder="选择生日 (月-日)"
                  style={{ width: '100%' }}
                  disabledDate={(current) => current && current.year() !== FIXED_YEAR}
                />
              </Form.Item>
              <Form.Item
                name="label"
                rules={[{ required: true, message: '请选择或输入分组' }]}
                style={{ flex: 1, marginBottom: 0 }}
              >
                <Select
                  placeholder="选择分组"
                  mode="tags"
                  maxTagCount={1}
                  options={labelOptions.map(opt => ({ value: opt, label: opt }))}
                  popupRender={renderGroupPopup}
                />
              </Form.Item>
              <Form.Item name="note" style={{ flex: 1.5, marginBottom: 0 }}>
                <Input placeholder="备注 (可选)" />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={loading}>
                  存入
                </Button>
              </Form.Item>
            </div>
          </Form>
        </Card>

        {/* 列表区域 */}
        <Card title="生日列表">
          <div style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <Input
              placeholder="输入姓名查询..."
              prefix={<SearchOutlined />}
              style={{ width: 200 }}
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              onPressEnter={() => fetchBirthdays(filterLabel, filterName, filterBirthday)}
              allowClear
            />
            <DatePicker
              picker="date"
              format="M-D"
              placeholder="选择生日 (月-日)"
              style={{ width: 150 }}
              value={filterBirthday}
              onChange={(value) => setFilterBirthday(value)}
              disabledDate={(current) => current && current.year() !== FIXED_YEAR}
              allowClear
            />
            <Select
              placeholder="选择分组"
              style={{ width: 120 }}
              value={filterLabel || 'All'}
              onChange={(value) => setFilterLabel(value)}
              options={['All', ...labelOptions].map(opt => ({ value: opt, label: opt }))}
              popupRender={renderGroupPopup}
            />
            <Button type="primary" onClick={() => fetchBirthdays(filterLabel, filterName, filterBirthday)}>查询</Button>
            <Button icon={<ReloadOutlined />} onClick={() => { setFilterLabel(''); setFilterName(''); setFilterBirthday(null); fetchBirthdays(''); }}>重置</Button>

            <Space.Compact style={{ borderLeft: '1px solid #e0e0e0', paddingLeft: 10, marginLeft: 10 }}>
              <Select
                value={exportFormat}
                onChange={(value) => setExportFormat(value)}
                size="small"
                style={{ width: 120, marginRight: -1 }}
                options={[
                  { value: 'line', label: '一行一个' },
                  { value: 'csv', label: '逗号分隔' }
                ]}
              />
              <Button type="default" icon={<DownloadOutlined />} onClick={handleExport}>
                导出
              </Button>
            </Space.Compact>
          </div>

          <Table
            columns={columns}
            dataSource={data}
            rowKey="_id"
            loading={loading}
            size="small"
            pagination={{
              pageSize,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50', '100'],
              onShowSizeChange: (_, size) => setPageSize(size),
            }}
          />
        </Card>

      </Content>

      {/* 批量导入模态框 */}
      <Modal open={batchImportModalOpen} title="批量导入生日" onCancel={() => setBatchImportModalOpen(false)} footer={[
        <Button key="cancel" onClick={() => setBatchImportModalOpen(false)}>
          取消
        </Button>,
        <Button
          key="import"
          type="primary"
          onClick={handleBatchImport}
          loading={loading}
          disabled={!batchImportText.trim() || !batchImportLabel}
        >
          导入
        </Button>,
      ]}
        width={600}
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>选择分组：</label>
          <Select
            style={{ width: '100%' }}
            value={batchImportLabel}
            onChange={setBatchImportLabel}
            options={labelOptions.map(opt => ({ value: opt, label: opt }))}
            placeholder="选择分组"
            popupRender={renderGroupPopup}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>备注（可选）：</label>
          <Input
            placeholder="为所有导入的生日记录添加备注"
            value={batchImportNote}
            onChange={(e) => setBatchImportNote(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 500 }}>生日列表（一行一条，格式：姓名 日期，空格分隔；日期支持「1月1日」或「1-1」，分隔符还可用 / . , ，纯数字无需前导零）：</label>
          <TextArea
            rows={10}
            placeholder={`例如：\n重岳 1月1日\n阿米娅 12月23日\n砂狼白子 5/16\n小鸟游星野 01,02\n白洲梓 12.26`}
            value={batchImportText}
            onChange={(e) => setBatchImportText(e.target.value)}
          />
        </div>

        {batchImportResults.length > 0 && (
          <div>
            <div style={{ marginBottom: 16, fontSize: '13px' }}>
              <p style={{ marginBottom: 8 }}>💡 导入结果：</p>
              <p style={{ color: '#52c41a', marginBottom: 8 }}>• <strong>✓ 成功</strong>：{batchImportResults.filter(r => r.status === 'success').length} 个</p>
              <p style={{ color: '#ff4d4f', marginBottom: 8 }}>• <strong>✗ 错误</strong>：{batchImportResults.filter(r => r.status === 'error').length} 个</p>
              <p style={{ color: '#999', marginBottom: 8 }}>• <strong>⊘ 跳过</strong>：{batchImportResults.filter(r => r.status === 'skipped').length} 个</p>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto', background: '#f5f5f5', padding: '12px', borderRadius: '4px' }}>
              {batchImportResults.map((result, index) => (
                <div
                  key={index}
                  style={{
                    marginBottom: '12px',
                    paddingBottom: '12px',
                    borderBottom: '1px solid #e0e0e0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <span style={{
                    color: result.status === 'success' ? '#52c41a' : result.status === 'skipped' ? '#999' : '#ff4d4f',
                    fontWeight: 'bold',
                    minWidth: '24px',
                    fontSize: '16px'
                  }}>
                    {result.status === 'success' ? '✓' : result.status === 'skipped' ? '⊘' : '✗'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                      {result.name || result.original}
                    </div>
                    {result.error && result.status !== 'success' && (
                      <div style={{ fontSize: '12px', color: result.status === 'skipped' ? '#999' : '#ff4d4f' }}>
                        {result.error}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* 编辑生日模态框 */}
      <Modal
        open={editModalOpen}
        title="编辑生日"
        onCancel={() => {
          setEditModalOpen(false);
          setEditingRecord(null);
        }}
        onOk={handleUpdate}
        confirmLoading={editSaving}
        okText="保存"
        width={520}
        forceRender
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input placeholder="姓名" />
          </Form.Item>
          <Form.Item
            name="birthday"
            label="生日"
            rules={[{ required: true, message: '请选择生日' }]}
          >
            <DatePicker
              picker="date"
              format="M-D"
              placeholder="选择生日 (月-日)"
              style={{ width: '100%' }}
              disabledDate={(current) => current && current.year() !== FIXED_YEAR}
            />
          </Form.Item>
          <Form.Item
            name="label"
            label="分组"
            rules={[{ required: true, message: '请选择或输入分组' }]}
          >
            <Select
              placeholder="选择分组"
              mode="tags"
              maxTagCount={1}
              options={labelOptions.map((opt) => ({ value: opt, label: opt }))}
              popupRender={renderGroupPopup}
            />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input placeholder="备注 (可选)" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 图鉴导入模态框 */}
      <Modal
        open={catalogModalOpen}
        title="从图鉴导入生日"
        onCancel={() => setCatalogModalOpen(false)}
        width={860}
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        footer={[
          <Button key="cancel" onClick={() => setCatalogModalOpen(false)}>
            取消
          </Button>,
          <Button
            key="import"
            type="primary"
            onClick={handleCatalogImport}
            loading={catalogImporting}
            disabled={catalogSelectedKeys.length === 0}
          >
            导入选中（{catalogSelectedKeys.length}）
          </Button>,
        ]}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Select<CatalogGame>
            value={catalogGame}
            onChange={handleCatalogGameChange}
            style={{ width: 230 }}
            options={[
              { value: 'B', label: '蔚蓝档案 · schaledb' },
              { value: 'S', label: '星塔旅人 · stella' },
            ]}
          />
          <Select
            value={catalogLabel}
            onChange={setCatalogLabel}
            style={{ width: 120 }}
            placeholder="导入分组"
            options={Array.from(new Set([...labelOptions, catalogLabel])).map((opt) => ({
              value: opt,
              label: opt,
            }))}
            popupRender={renderGroupPopup}
          />
          <Input
            placeholder="搜索姓名 / 学校 / 阵营"
            prefix={<SearchOutlined />}
            value={catalogSearch}
            onChange={(e) => setCatalogSearch(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <Button onClick={() => void loadCatalog(catalogGame)} loading={catalogLoading}>
            刷新
          </Button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 8,
            fontSize: 13,
            color: '#666',
          }}
        >
          <span>
            共 {catalogItems.length} 个，新增 {catalogNewCount} 个，已有{' '}
            {catalogItems.length - catalogNewCount} 个（有本体的变体已自动去除）
          </span>
          <Button
            size="small"
            onClick={() =>
              setCatalogSelectedKeys(
                catalogItems
                  .filter((item) => !catalogExisting.has(catalogKey(item)))
                  .map(catalogKey)
              )
            }
          >
            全选新增
          </Button>
          <Button size="small" onClick={() => setCatalogSelectedKeys([])}>
            清空选择
          </Button>
        </div>

        <Table
          columns={catalogColumns}
          dataSource={catalogFiltered}
          rowKey={(record) => catalogKey(record)}
          loading={catalogLoading}
          size="small"
          pagination={{
            pageSize: catalogPageSize,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50', '100'],
            onShowSizeChange: (_, size) => setCatalogPageSize(size),
            showTotal: (total) => `共 ${total} 条`,
          }}
          rowSelection={{
            selectedRowKeys: catalogSelectedKeys,
            onChange: (keys) => setCatalogSelectedKeys(keys),
            getCheckboxProps: (record) => ({
              disabled: catalogExisting.has(catalogKey(record)),
            }),
          }}
        />

        <div style={{ marginTop: 12 }}>
          <Input
            placeholder="为本次导入添加备注（可选）"
            value={catalogNote}
            onChange={(e) => setCatalogNote(e.target.value)}
          />
        </div>

        {catalogResults.length > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: '#fafafa',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <p style={{ color: '#52c41a', marginBottom: 4 }}>
              ✓ 成功：{catalogResults.filter((r) => r.status === 'success').length} 个
            </p>
            <p style={{ color: '#999', marginBottom: 4 }}>
              ⊘ 跳过（已存在）：{catalogResults.filter((r) => r.status === 'skipped').length} 个
            </p>
            <p style={{ color: '#ff4d4f', marginBottom: 0 }}>
              ✗ 错误：{catalogResults.filter((r) => r.status === 'error').length} 个
            </p>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
