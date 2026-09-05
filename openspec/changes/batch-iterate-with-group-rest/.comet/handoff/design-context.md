# Comet Design Handoff

- Change: batch-iterate-with-group-rest
- Phase: design
- Mode: compact
- Context hash: f76de78c1b58d464fc5862f09e1681e18a3b1da1b97639a081124b93a3ae49f6

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/batch-iterate-with-group-rest/proposal.md

- Source: openspec/changes/batch-iterate-with-group-rest/proposal.md
- Lines: 1-33
- SHA256: 5caa0c37868bf8a293f11d1da306918faf0199901edf5670cc286777de5f745b

```md
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
```

## openspec/changes/batch-iterate-with-group-rest/design.md

- Source: openspec/changes/batch-iterate-with-group-rest/design.md
- Lines: 1-56
- SHA256: 01c9ab32b0b50e916e78937a65af948ea46123d4a60cb87e387290fdc18609da

```md
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
```

## openspec/changes/batch-iterate-with-group-rest/tasks.md

- Source: openspec/changes/batch-iterate-with-group-rest/tasks.md
- Lines: 1-22
- SHA256: 675b8b3fabf4a7d1e17d7359fd652c9baa6586fcf98688e094f5efb9de6acd0b

```md
## 1. 步骤编辑界面（electron/renderer/index.html）

- [ ] 1.1 在「轮询间隔（秒）」输入框下方新增「每组连续点击数（个）」（`#step-iterate-batch-size`，默认 10，`min="1"`）与「组间休息（秒）」（`#step-iterate-batch-interval`，默认 60，`min="1"`），并入现有 `iterate-interval-group` 显示/隐藏联动（仅勾选轮询时显示）
- [ ] 1.2 `addStep()` 清空新字段（分别恢复默认 10 与 60）
- [ ] 1.3 `editStep(index)` 回填 `step.iterate_batch_size` / `step.iterate_batch_interval`
- [ ] 1.4 `step-form` 提交时读取新字段写入步骤对象（数值容错：空/NaN 落默认 10 / 60）
- [ ] 1.5 `renderSteps()` 步骤卡片轮询标记追加分批信息（如 `🔁 轮询所有(间隔10s, 分批10/休息60s)`），旧步骤无字段时不显示分批部分

## 2. 执行逻辑（electron/main.js）

- [ ] 2.1 轮询分支读取并防御性校验新字段：`batchSize` / `batchIntervalSec` 均须为正整数/正数才启用分批，否则走原有不分组逻辑
- [ ] 2.2 轮询循环维护 `clickedCount`（每 selector 从 0 累计）；每点击一个元素并处理确认框后，`clickedCount++`；当满 N（`clickedCount % batchSize === 0`）且仍有剩余元素时，在既有元素间隔等待后追加 `batchIntervalSec` 秒的组间休息
- [ ] 2.3 组间休息触发时输出日志（沿用 RendererTransport 通道上屏）：`已连续点击 N 个，组间休息 M 秒后继续...`；最后一次点击或不足一组时不输出、不等待
- [ ] 2.4 非轮询路径与分批未启用路径保持现状零改动

## 3. 验证

- [ ] 3.1 `node --check` 校验 `electron/main.js` 语法；渲染层无 JS 报错
- [ ] 3.2 界面：编辑步骤时能设置每组点击数/组间休息；保存后卡片显示分批标记；再次编辑能正确回填
- [ ] 3.3 执行：轮询任务每满 N 个后额外休息 M 秒再继续；末组不足 N 个时点完即停、不等待组间休息
- [ ] 3.4 日志：UI 日志面板在每次组间休息触发时显示对应提示
- [ ] 3.5 回归：旧步骤（无新字段）行为与之前完全一致（每元素间隔点击，不分组）；未勾选轮询的任务行为不变
```

## openspec/changes/batch-iterate-with-group-rest/specs/auto-interaction/spec.md

- Source: openspec/changes/batch-iterate-with-group-rest/specs/auto-interaction/spec.md
- Lines: 1-22
- SHA256: 728630addb13c82fa64d51f258195fc02b61f2e34b6f390e0f332f263e04c0f3

```md
## ADDED Requirements

### Requirement: 轮询分批组间休息
系统在「轮询页面所有相同元素」执行时，SHALL 支持配置分组节奏：每连续点击 N 个元素后，在原有元素间隔之外额外休息 M 秒，再继续点击下一组；旧步骤配置缺失或字段无效时 MUST 保持原有行为（每元素间隔点击，不分批）。

#### Scenario: 满一组后执行组间休息
- **WHEN** 步骤配置了轮询（`iterate_all`）且 `iterate_batch_size = N`、`iterate_batch_interval = M`（N、M 均为正整数）
- **AND** 当前选择器已连续点击满 N 个元素且仍有未点击的可见元素
- **THEN** 系统等待该元素间隔后再额外等待 M 秒，然后继续点击下一组元素

#### Scenario: 最后一组不足 N 个或已全部点完
- **WHEN** 剩余未点击元素不足 N 个或已全部点击完毕
- **THEN** 系统不再执行组间休息 M 的等待，按原有元素间隔逻辑收尾

#### Scenario: 旧配置或无效字段保持原有行为
- **WHEN** 步骤对象不包含 `iterate_batch_size`/`iterate_batch_interval` 字段
- **OR** 两者任一为空、为 0 或非数值
- **THEN** 系统不进行分批，行为与未引入本能力前完全一致

#### Scenario: 未勾选轮询时字段不生效
- **WHEN** 步骤未勾选轮询（`iterate_all` 为假）
- **THEN** 即使步骤对象带 `iterate_batch_size`/`iterate_batch_interval` 字段，系统也忽略之并执行非轮询点击行为
```

