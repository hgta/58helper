## Context

Electron 桌面应用是当前用户主要的使用入口（`npm start`）。任务数据存储于 SQLite（`urls` 表），通过 `UrlModel` 访问。任务列表由主进程 `url-get-all` IPC 处理器返回，渲染进程 `loadTasks()` 拉取并渲染。

## Goals / Non-Goals

**Goals:**
- 任务列表无数量上限，`url-get-all` 返回全部任务。
- 任务执行成功后不再截图、不写文件、不记录 `screenshot_path`。

**Non-Goals:**
- 不修改优先级字段（`task-priority` 的 `max="100"` 是优先级数值上限，与任务数量无关）。
- 不改动 Web 定时服务（`TaskScheduler`）的调度间隔（`config.yaml` 的 `schedule.interval`）。
- 不删除数据库历史表中的 `screenshot_path` 字段（保留兼容，避免迁移）。
- 任务间隔的调整暂缓，待用户确认具体需求后再定（详见"待澄清事项"）。

## Decisions

### 决策1: 移除任务数量上限的方式
修改 `UrlModel.getAll()`，移除默认 `limit = 100`，改为不传 `LIMIT` 时返回全部记录（`limit` 仍作为可选参数供分页场景使用）。

**替代方案:**
- 在 `url-get-all` 处理器里显式传大 `limit` → 治标不治本，仍存在隐性上限。
- 前端分页加载 → 改动过大，当前场景无需分页。

### 决策2: 移除截图的实现
在 `electron/main.js` 的 `execute-task` 处理器中删除截图代码块（`capturePage` + 写文件），并在记录历史时 `screenshot_path` 传 `null`。渲染进程 `executeTask` 中移除对 `result.screenshot` 的展示逻辑。为保持一致性，`TaskScheduler.executeTask`（Web 端）的截图逻辑一并移除。

**替代方案:**
- 增加配置开关控制是否截图 → 引入额外复杂度，用户明确表示不需要截图。

### 决策3: 任务间隔调整（暂缓）
当前 `executeAllTasks` 中任务间等待为 2 秒（`setTimeout(r, 2000)`）。用户反馈"任务间隔 1 分钟"与代码现状不符，存在理解差异。本次**不修改**任务间隔，待用户澄清实际观察到的等待来源后再定。

## 待澄清事项

- 用户感知的"两个任务之间间隔 1 分钟"具体指哪个环节？可能来源：
  - `execute-task` 中页面加载超时 60000ms（页面加载慢时会等待较久）
  - 步骤内部等待（3 秒页面稳定 + 5 秒步骤间隔）
  - 或其他用户实际操作中的等待
- 待确认后再决定是否调整、以及调整到多少。

## Risks / Trade-offs

- [Risk] 移除截图后，历史记录中 `screenshot_path` 为空 → 用户已明确不需要截图，可接受。
- [Risk] 任务数量无上限后，列表过长可能影响渲染性能 → 当前场景任务量级（数百）不会构成性能瓶颈。
