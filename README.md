# SnapBirthday | my-birthday-manager

一个基于 [Next.js](https://nextjs.org/) 和 [Ant Design](https://ant.design/) 构建的生日记录工具（改造自 [SnapIP](https://github.com/xiaofeiTM233/SnapIP)）。支持生日（月-日）的统一管理、批量导入导出、分组管理和按姓名查询。

## ✨ 核心特性

- 🎨 **优雅用户界面**：深度集成 [Ant Design](https://ant.design/) v6 组件库，提供精致的视觉体验。
- ⚡ **现代化技术栈**：采用 [Next.js](https://nextjs.org/)、React 19 和 TypeScript，确保高性能和良好的开发体验。
- 🎂 **仅需月日**：日期选择器固定闰年年份，2 月 29 日也可选择，年份不会保存。
- 🏷️ **分组管理**：自定义分组标签，支持按分组筛选和查询。
- 🔍 **姓名查询**：按姓名模糊搜索。
- 📦 **批量导入**：支持从文本批量导入（格式：`姓名 月-日`，空格分隔；日期内分隔符支持 `-` `/` `.` `,`，纯数字无需前导零，一行一条）。
- 💾 **灵活导出**：支持一行一个和逗号分隔两种导出格式，按月日排序。
- 🔁 **重复检测**：同一姓名 + 同一生日自动跳过，防止重复录入。
- 💾 **数据持久化**：基于 MongoDB 存储，数据安全可靠。

## 🛠️ 技术栈

- **框架**: [Next.js](https://nextjs.org/)
- **UI 库**: [Ant Design](https://ant.design/)
- **语言**: TypeScript
- **数据库**: [MongoDB](https://www.mongodb.com/)
- **日期处理**: [dayjs](https://day.js.org/)
- **React 版本**: React 19

## 🚀 快速开始

1. 复制 `.env.example` 为 `.env`，配置 `MONGODB_URI`（本地 MongoDB 或 MongoDB Atlas 连接串）。
2. `npm install`
3. `npm run dev`

## 📚 说明

本项目改造自 [SnapIP](https://github.com/xiaofeiTM233/SnapIP)，原 README 由 AI 辅助生成。
