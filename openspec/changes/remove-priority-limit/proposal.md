## Why

任务优先级输入框存在硬编码的 `max="100"` 上限。当任务数量超过 100 个后，新增任务时优先级会默认设为「任务数 + 1」（即 101 及以上），此时表单原生校验会拦截提交，导致"提交失败"。而用户并不希望有 100 这个优先级上限。

## What Changes

- **移除优先级 100 上限**：删除 Electron 界面与 Web 管理界面中优先级输入框的 `max="100"` 限制，允许优先级为任意正整数（仍保留 `min="1"`）。
- **默认值保持现状**：新增任务时优先级仍默认「任务数 + 1」自动递增，不改动默认值逻辑。

## Capabilities

### New Capabilities
<!-- 无新增能力 -->

### Modified Capabilities
- `task-management`: 任务优先级不再受 100 上限约束。

## Impact

- `electron/renderer/index.html`: 移除 `task-priority` 输入框的 `max="100"`。
- `src/web/views/index.html`: 移除 `priority-input` 输入框的 `max="100"`（保持一致）。

## 相关说明

- 数据库层面 `priority INTEGER` 无上限，后端 `UrlModel` 直接透传，均无 100 限制。上限仅存在于前端 HTML 的 `max` 属性。
- `src/browser-app.js` 命令行交互中的"优先级（1-100）"仅为提示文案，无强制校验，不在本次改动范围（该入口未使用）。
