## Why

当前轮询模式总是从匹配到的第一个可见元素开始依次点击。当任务需要跳过已经处理过的前 N 个元素、或从失败断点继续时，用户无法指定起始位置，只能手动等待前 N 个元素被无谓点击。增加「从第几个元素开始轮询」参数后，用户可自定义起始偏移，默认从第 1 个开始，提升灵活性和断点续跑效率。

## What Changes

- 在步骤编辑表单的「轮询间隔（秒）」上方新增一个数字输入框：**从第几个元素开始轮询（默认 1）**。
- 数据模型新增字段 `iterate_start_index`（正整数，默认 1）。
- 执行引擎在 `iterateInPlace`（原地轮询）和 `runFanoutStep`（裂变轮询）中均遵守该起始偏移：跳过前 `iterate_start_index - 1` 个可见元素，从第 `iterate_start_index` 个开始点击。
- UI 仅在勾选「轮询页面所有相同元素」时显示该字段；未勾选时隐藏且不参与逻辑。

## Capabilities

### New Capabilities

- `iterate-start-offset`: 允许用户配置轮询起始元素索引，支持原地轮询与裂变轮询两种模式。

### Modified Capabilities

- `auto-interaction`: 扩展「轮询所有相同元素」行为，新增 `iterate_start_index` 参数影响元素遍历顺序与进度计算。

## Impact

- `electron/renderer/index.html`：步骤编辑 UI 新增输入框及显隐控制。
- `electron/main.js`：`iterateInPlace` 与 `runFanoutStep` 需支持起始偏移；进度统计需考虑跳过的元素。
- 持久化数据：任务对象新增 `iterate_start_index` 字段，向后兼容（旧任务无该字段时按 1 处理）。
