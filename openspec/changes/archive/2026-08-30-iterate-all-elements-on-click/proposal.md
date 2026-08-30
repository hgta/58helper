## Why

Electron 桌面应用的任务步骤中，按钮选择器（`button_selectors`）当前只点击页面中**第一个**匹配的元素。但实际场景中，一个选择器（如 `.itemBox`）在页面上可能同时出现多个（列表/卡片），用户需要依次点击每一个，每个间隔可配置（如 10 秒）。

## What Changes

- **步骤数据模型扩展**：每个步骤新增两个可选字段：
  - `iterate_all`（boolean）：是否轮询页面所有匹配元素
  - `iterate_interval`（number，秒，默认 10）：元素间点击间隔
- **步骤编辑 UI**：按钮选择器下方增加勾选框「轮询页面所有相同元素」；勾选时显示「轮询间隔（秒）」输入框（默认 10）。
- **执行逻辑**：勾选后，对每个按钮选择器用 `querySelectorAll` 查找所有匹配元素，依次点击每一个（仅点击可见元素），每个元素点击后立即处理确认框（`confirm_selectors`），然后等待配置的间隔后再点下一个。

## Capabilities

### New Capabilities
<!-- 无新增能力 -->

### Modified Capabilities
- `task-management`: 步骤编辑支持配置「轮询所有匹配元素」及自定义轮询间隔。
- `task-execution`: 勾选轮询后，按钮选择器会依次点击所有匹配元素，每个元素后处理确认框。

## Impact

- `electron/renderer/index.html`: 步骤编辑弹窗新增勾选框与间隔输入框；`addStep`/`editStep`/步骤表单提交读取新字段；步骤列表展示轮询标记。
- `electron/main.js`: `execute-task` 处理器中按钮点击逻辑支持轮询模式（`querySelectorAll` 依次点击 + 间隔等待 + 每个元素后处理确认框）。
- `src/models/UrlModel.js`: 无需改动（`steps` 为 JSON 存储，新字段自动随步骤对象持久化）。
- `src/db/database.js`: 无需迁移（步骤是 JSON，非独立列）。

## 相关说明

- 轮询仅作用于**按钮选择器**；确认框选择器本身不轮询，但在轮询模式下每个元素点击后都会执行一次确认框处理。
- 若未勾选轮询，行为保持现状（只点第一个匹配元素）。
- 仅实现 Electron 桌面端（`electron/main.js` + `electron/renderer/index.html`）；Web 定时服务（`TaskScheduler`）为后台自动任务，不涉及步骤编辑界面，本次不改动。
