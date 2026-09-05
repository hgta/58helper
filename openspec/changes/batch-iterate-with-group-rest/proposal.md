## Why

「轮询页面所有相同元素」模式当前每点击一个元素就等待固定间隔（`iterate_interval`，默认 10 秒）。当页面上匹配元素非常多（如几十上百个）时，全程均匀等待会导致总耗时过长；而若把间隔调小，长时间连续高频操作又可能触发页面限制。需要一个「分批 + 组间休息」的节奏控制：连续点击 N 个元素后，额外休息 M 秒，再继续下一组。

## What Changes

- **步骤数据模型扩展**：每个步骤在 `iterate_all`/`iterate_interval` 基础上新增两个可选字段：
  - `iterate_batch_size`（number，默认 10）：每组连续点击的元素个数（N）
  - `iterate_batch_interval`（number，秒，默认 60）：每组点完后额外休息的时长（M）
- **步骤编辑 UI**：勾选「轮询页面所有相同元素」时，在「轮询间隔（秒）」下方新增两个输入框：「每组连续点击数」（默认 10）、「组间休息（秒）」（默认 60）。
- **执行逻辑**：轮询循环中累计已点击数，每满 N 个后，先按 `iterate_interval` 等待，再额外等待 `iterate_batch_interval` 秒，然后继续下一组；最后一组不足 N 个或元素已全部点完时不再额外等待。
- **向后兼容**：旧步骤无 `iterate_batch_size`/`iterate_batch_interval` 字段，或两字段任一无效（空/0/NaN）时，行为与现状完全一致（不分组）。

## Capabilities

### New Capabilities
<!-- 无新增能力 -->

### Modified Capabilities
- `auto-interaction`: 轮询点击执行支持「分组休息」节奏——每连续点击 N 个元素后额外休息 M 秒再继续下一组，且旧配置保持原有行为。

## Impact

- `electron/main.js`: `execute-task` 处理器轮询分支累计点击数，满 N 个时在既有间隔外追加组间休息等待。
- `electron/renderer/index.html`: 步骤编辑弹窗在轮询间隔下方新增「每组连续点击数」「组间休息（秒）」输入框；`addStep` 清空、`editStep` 回填、表单提交读取、步骤列表展示分组配置。
- `src/models/UrlModel.js`: 无需改动（`steps` 为 JSON 存储，新字段自动随步骤对象持久化）。
- `src/db/database.js`: 无需迁移（步骤是 JSON，非独立列）。

## 相关说明

- 组间休息仅在轮询模式（`iterate_all`）下生效；非轮询行为保持现状。
- 分组计数在每个按钮选择器内部独立累计（选择器之间互不影响）；同一选择器从 `querySelectorAll` 首次统计到全部点完为一个完整分组序列。
- 仅实现 Electron 桌面端（`electron/main.js` + `electron/renderer/index.html`）；Web 定时服务（`TaskScheduler`）本次不改动。
