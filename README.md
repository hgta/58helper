# 定时网页浏览器点击助手 (Timed URL Browser Clicker)

这是一个基于 Node.js 和 Playwright 的浏览器自动化工具，用于根据设定的时间间隔定时浏览一批网址，并自动点击页面上的特定按钮。

## 功能特性

- **定时浏览**: 每隔 1 分钟（可配置）从待访问列表中取出一个网址进行浏览。
- **自动点击**: 页面加载完成后，自动查找并点击预设的选择器（支持 CSS/XPath）。
- **频率限制**: 每个网址每天仅成功执行一次。
- **重试机制**: 任务失败时支持自动重试。
- **截图记录**: 每次执行完成后自动截图并保存到 `logs/screenshots`。
- **数据持久化**: 使用 SQLite 记录配置、网址列表和访问历史。
- **命令行工具**: 提供方便的命令行接口管理网址和查看历史。

## 快速开始

### 1. 环境准备

确保你已经安装了 Node.js (推荐 v18+)。

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器引擎 (Chromium)
npx playwright install chromium
```

### 2. 初始化数据库

```bash
npm run db:init
```

### 3. 配置

复制 `.env.example` 并重命名为 `.env`，根据需要修改配置。

```bash
cp .env.example .env
```

或者使用 `config.yaml` 进行更详细的配置。

### 4. 添加网址

使用命令行工具添加你想要定时访问的网址：

```bash
node src/index.js add-url "https://example.com/checkin" --selectors ".btn-checkin" "#confirm-btn" --priority 1
```

### 5. 启动服务

```bash
npm start
```

## 命令行参考

- `node src/index.js start`: 启动定时服务。
- `node src/index.js add-url <url> [options]`: 添加新网址。
- `node src/index.js list-urls`: 查看所有网址配置。
- `node src/index.js history`: 查看今日执行历史。

## 目录结构

- `src/`: 源代码
  - `db/`: 数据库连接与初始化
  - `models/`: 数据模型 (CRUD)
  - `services/`: 核心业务逻辑 (浏览器控制、调度器)
  - `utils/`: 通用工具 (日志、配置加载)
- `logs/`: 日志与截图
- `data/`: SQLite 数据库文件
- `config/`: 配置文件目录

## 注意事项

- 请确保你的网络环境可以正常访问目标网址。
- 自动化行为应遵守目标网站的服务条款。
- 建议在无头模式 (`HEADLESS=true`) 下运行以节省资源，调试时可设为 `false`。
