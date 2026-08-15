## Why

Electron 桌面应用（`npm start`）的任务管理存在三个影响使用体验的问题：

1. **任务数量上限**：任务添加到约 100 个后无法继续增加。根因是 `UrlModel.getAll()` 的默认 `limit = 100`，而主进程 `url-get-all` IPC 处理器调用时未传 `limit`，导致任务列表永远只返回前 100 条，界面上表现为"加不进去了"。
2. **多余截图**：任务执行完成后会自动截图并写入 `logs/screenshots`，既拖慢执行速度，又占用磁盘空间，用户并不需要。

## What Changes

- **移除任务数量限制**：让 `url-get-all` 返回全部任务，不再受 100 条默认上限约束。
- **移除执行完成后的截图**：任务执行成功后不再截图、不再写文件、不再记录 `screenshot_path`。
- **任务间隔暂缓**：任务间隔相关调整暂不实施，待用户澄清实际需求后再定。

## Capabilities

### New Capabilities
<!-- 无新增能力 -->

### Modified Capabilities
- `task-management`: 任务列表读取不再受数量上限限制。
- `task-execution`: 任务执行完成后不再截图。

## Impact

- `src/models/UrlModel.js`: `getAll()` 移除默认 `limit = 100` 上限。
- `electron/main.js`: `execute-task` 处理器移除截图逻辑；`url-get-all` 确保返回全部任务。
- `electron/renderer/index.html`: 移除对 `result.screenshot` 的展示。
- `src/services/TaskScheduler.js`: （保持一致）移除 `executeTask` 中的截图逻辑。

## 相关说明

- 前端 `task-priority` 输入框的 `max="100"` 是**优先级数值**上限（数字越大优先级越高），并非任务数量限制，不在此次改动范围内。
- 间隔调整针对 Electron 界面"执行全部"场景。Web 定时服务（`TaskScheduler`）的 `interval` 由 `config.yaml` 的 `schedule.interval` 控制，默认 60000ms，本次不改动该配置。
