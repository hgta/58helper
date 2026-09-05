## Context

Electron 桌面应用的任务步骤以 JSON 存储在 `urls.steps` 列。上一 change（`iterate-all-elements-on-click`）为步骤引入了 `iterate_all`（轮询所有匹配元素）与 `iterate_interval`（每元素点击间隔，默认 10 秒）字段，执行时用 `querySelectorAll` + `dataset.iterateClicked` 标记依次点击每个可见元素，每点击一个后处理确认框并等待间隔。

当前痛点：当匹配元素很多时，全程以固定间隔逐个点击，总耗时 = 元素数 × 间隔。用户无法通过单一间隔同时满足「单个操作不要太快」与「整体不要拖太久」两个诉求。需要引入分批节奏：连续点 N 个后额外休息 M 秒，再点下一组。

## Goals / Non-Goals

**Goals:**
- 步骤可为轮询模式配置「每组连续点击数 N」与「组间休息 M 秒」，每满 N 个后先等元素间隔再额外等 M。
- 旧步骤（无新字段）与字段无效时行为完全不变。
- 分组参数随步骤 JSON 持久化，无需数据库迁移。

**Non-Goals:**
- 不改动单元素间隔 `iterate_interval` 的语义。
- 不轮询确认框选择器本身。
- 不改动 Web 定时服务（`TaskScheduler`）。
- 不引入全局（跨 selector）批次计数器持久化。

## Decisions

### 决策1: 分组计数按"每个按钮选择器内部独立累计"
轮询循环已按 selector 逐层遍历（外层 `for (const selector of buttonSelectors)`，内层 `while(true)` 逐元素点击）。分组计数 `clickedCount` 在每个 selector 进入轮询时从 0 开始，累计满 N 即触发一次组间休息。

**为何不跨 selector 全局累计：** 页面通常一次只处理一个 selector 的全部同类元素；selector 之间分组互相纠缠会使行为难以预测与排查。按 selector 独立分批更符合"一组同类操作后稍歇"的直觉。

### 决策2: 组间休息触发位置与条件
在每个元素点击、确认框处理、日志输出之后：
- 若 `result.remaining > 0` 且元素间隔 `intervalSec > 0`，先等待元素间隔（保持既有节奏）。
- 若 `clickedCount % N === 0` 且 `result.remaining > 0`，则追加等待 `batchIntervalSec` 秒，并输出日志 `组间休息`。
- 最后一次点击（`remaining === 0`）或不足一组时不额外等待。

**为何不在满 N 时替换元素间隔：** 元素间隔保证每次点击之间的最小时间窗（多为加载/响应缓冲），组间休息是叠加在其上的"长休"，两者目的不同，故叠加而非替换。

### 决策3: 字段取值与容错
- UI 层：`step-iterate-batch-size` 与 `step-iterate-batch-interval` 两个 number 输入框，`min="1"`，仅当 `iterate_all` 勾选时显示（与 `iterate-interval-group` 同一组）。
- 数据层：步骤对象新增 `iterate_batch_size`（默认 10）与 `iterate_batch_interval`（默认 60）。
- 执行层防御：`batchSize = Number(step.iterate_batch_size)`，仅当 `Number.isInteger(batchSize) && batchSize > 0` 才启用分批；`batchIntervalSec = Number(step.iterate_batch_interval)`，同样要求 `> 0`；任一不满足则跳过组间休息逻辑。默认值处理与上一 change 的 `intervalSec` 一致（无字段 → 不启用，保持旧行为）。

**为何不默认启用：** 旧步骤对象缺少这两个字段。若执行层对缺失字段套默认值（N=10/M=60），会悄悄改变所有存量轮询步骤的节奏，违背向后兼容目标。因此缺省 = 不分组。

### 决策4: UI 布局与复用
`iterate_interval_group` 容器内追加两行，复用同一 `form-group`/`label`/`input` 样式：
- 「每组连续点击数（个）」→ `#step-iterate-batch-size`，默认 10
- 「组间休息（秒）」→ `#step-iterate-batch-interval`，默认 60

沿用既有交互：`addStep()` 清空新字段；`editStep(i)` 回填（`step.iterate_batch_size || 10`）；表单 submit 读取（`parseInt(...) || 默认`）；`renderSteps()` 卡片标记追加 `分批N/休息Ms`。

### 决策5: 日志可观测性
沿用上一 change 决策5 的 RendererTransport 通道，主进程 `logger.info` 自动上屏。组间休息触发时输出：`轮询: 已连续点击 N 个，组间休息 M 秒后继续...`；若分批未启用（字段无效）但流程正常运行，不加额外日志，避免噪声。

## Risks / Trade-offs

- [Risk] 组间休息期间页面元素被外部改动（如确认框残留） → 继续沿用每轮"重新查询 + dataset 标记"机制，休息后仍只点击未标记且可见元素。
- [Risk] 用户把 N 设得很大、M 很小，等于没分批 → 属于配置自由，UI 默认值提供合理起点，不在代码层强限制。
- [Risk] 新增字段对旧版本应用透明（多余字段被忽略） → 无兼容问题；反向（新版本读旧步骤）由缺省不启用兜底。
