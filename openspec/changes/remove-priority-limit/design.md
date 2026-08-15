## Context

任务优先级通过前端 `<input type="number" max="100">` 设置。当新增任务时，前端将默认值设为「任务数 + 1」（`tasks.length + 1`），任务数超过 100 后该默认值即为 101 及以上，触发 HTML 原生表单校验（`max="100"`），导致表单无法提交。

数据库 `priority INTEGER` 与后端 `UrlModel` 均无 100 上限，限制仅存在于前端。

## Goals / Non-Goals

**Goals:**
- 允许任务优先级为任意正整数，不再受 100 上限约束。

**Non-Goals:**
- 不修改默认优先级逻辑（保持「任务数 + 1」自动递增）。
- 不修改 `min="1"` 下限。
- 不改动 `src/browser-app.js` 命令行交互的提示文案（该入口未使用）。

## Decisions

### 决策: 仅移除前端 `max` 属性
在 Electron 界面（`electron/renderer/index.html`）与 Web 管理界面（`src/web/views/index.html`）的优先级输入框中删除 `max="100"`，保留 `min="1"`。

**替代方案:**
- 提高 `max` 到一个更大的值 → 仍存在隐性上限，治标不治本。
- 后端增加校验 → 数据库本身无限制，无需额外校验。

## Risks / Trade-offs

- [Risk] 优先级数值过大可能影响排序展示 → 优先级仅用于排序，数值大小无副作用，可接受。
- [Risk] 误输入非法值 → 输入框仍为 `type="number"` 且 `min="1"`，保留基本约束。
