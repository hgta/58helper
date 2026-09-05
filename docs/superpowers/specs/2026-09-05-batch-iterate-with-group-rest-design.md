---
comet_change: batch-iterate-with-group-rest
role: technical-design
canonical_spec: openspec
archived-with: 2026-09-05-batch-iterate-with-group-rest
status: final
---

# 轮询分批 + 组间休息 — 技术设计

## Context

Electron 桌面任务应用（`electron/main.js` + `electron/renderer/index.html`）。任务步骤以 JSON 存于 `urls.steps` 列。上一 change 引入「轮询页面所有相同元素」：对每个按钮选择器用 `querySelectorAll` 找到全部可见元素，标记 + 点击 + 处理确认框，每个元素后按 `iterate_interval`（默认 10s）等待，直到无剩余可见元素。

痛点：页面匹配元素很多时，全程均匀等待总耗时过长；调小间隔又可能触发页面限制。需要在轮询中引入"分批"节奏：连续点 N 个后额外休息 M 秒再继续。

现有代码关键锚点（`electron/main.js` 轮询分支）：

- L430 `if (step.iterate_all)` 轮询入口
- L432 `intervalSec = Number(step.iterate_interval) > 0 ? ... : 10`
- L434 `for (const selector of buttonSelectors)` 外层循环
- L460 `let clickedCount = 0;`（每 selector 一个，位于 for 内）
- L461 `while (true)` 内层循环，每次点 1 个可见元素
- L501 `if (!result.clicked) break;`
- L502 `clickedCount++;`
- L513 `await handleConfirmBox(webContents, step.confirm_selectors || []);`
- L515-518 有剩余则等 `intervalSec` 秒

UI 锚点（`electron/renderer/index.html`）：

- L752-755 `#iterate-interval-group`（含 `#step-iterate-interval`），L786-789 勾选联动
- L1164-1166 `addStep()` 清空；L1178-1180 `editStep()` 回填；L1203-1206 submit 读取
- L1151 `renderSteps()` 卡片轮询标记

## Goals / Non-Goals

**Goals:**

- 步骤可为轮询模式配置 `iterate_batch_size`（N）与 `iterate_batch_interval`（M）。
- 执行时序：连续点满 N 个（每个之间仍有 I 秒间隔）→ 再额外休息 M 秒 → 继续下一组。
- 旧步骤（无新字段）行为完全不变；未勾选轮询的步骤忽略新字段。
- 参数随步骤 JSON 持久化，零数据库迁移。

**Non-Goals:**

- 不改变单元素间隔 `iterate_interval` 语义。
- 不轮询确认框选择器本身。
- 不改 Web 定时服务（`TaskScheduler`）/后台自动任务。
- 不做跨 selector 的全局分组计数；不做"休息到用户手动放行"等交互式暂停。

## 确认的技术方案

### 数据模型（步骤 JSON，向后兼容可选字段）

```
iterate_all: true
iterate_interval: 10          // I，已有：每元素点击后等待（秒）
iterate_batch_size: 10        // N，新增：每组连续点击数（默认 10）
iterate_batch_interval: 60    // M，新增：组间休息（秒，默认 60）
```

字段缺失、空、0、NaN 时该功能不启用（执行层防御），旧数据零影响。

### UI（`electron/renderer/index.html`）

`#iterate-interval-group` 容器内（L752-755 现有块下方）追加两个 `form-group`：

```html
<div class="form-group" id="iterate-interval-group" style="display: none;">
    <label>轮询间隔（秒）</label>
    <input type="number" id="step-iterate-interval" value="10" min="1">
    <!-- 新增 ↓（分批可选填：留空=不分批，placeholder 提示默认） -->
    <label>每组连续点击数（个，可选填）</label>
    <input type="number" id="step-iterate-batch-size" placeholder="10" min="1">
    <label>组间休息（秒，可选填）</label>
    <input type="number" id="step-iterate-batch-interval" placeholder="60" min="1">
</div>
```

联动逻辑保持现状：仅勾选轮询时整组显示。同步修改：

- `addStep()`：`step-iterate-batch-size` → 10，`step-iterate-batch-interval` → 60（与 interval 一并重置，新建步骤默认分批 10/60）。
- `editStep(index)`：回填 `step.iterate_batch_size` / `step.iterate_batch_interval`（值缺失/为 0 时留空，placeholder 显示默认）。**旧步骤（无字段）编辑后输入框留空**，避免「重存即被静默启用分批」。
- submit 读取：仅当已勾选轮询且两字段均填有效正整数时，才写入 `step.iterate_batch_size` / `step.iterate_batch_interval`；任一为空/无效则不写入（该步骤不分批，行为与旧版一致）。
- `renderSteps()` L1151 标记扩展为：`🔁 轮询所有(间隔10s, 分批10/休息60s)`；仅当 `iterate_all` 为真且字段有效时追加 `, 分批N/休息Ms` 片段，旧步骤不显示该片段。

### 执行逻辑（`electron/main.js` L460-519）

在现有 `for (const selector ...)` 内、`while(true)` 外，`clickedCount = 0` 附近读取并校验：

```js
// 在 intervalSec 之后追加：
const rawBatchSize = Number(step.iterate_batch_size);
const batchIntervalSec = Number(step.iterate_batch_interval);
const batchEnabled = Number.isInteger(rawBatchSize) && rawBatchSize > 0
    && Number.isFinite(batchIntervalSec) && batchIntervalSec > 0;
```

`while` 循环内，在 `result.remaining > 0` 的元素间隔等待块之后追加：

```js
if (result.remaining > 0 && intervalSec > 0) {
    logger.info(`[Execute Task] 轮询: 等待 ${intervalSec} 秒后点击下一个...`);
    await new Promise(resolve => setTimeout(resolve, intervalSec * 1000));
}
// 新增：满一组且仍有剩余 → 组间休息
if (batchEnabled && result.remaining > 0 && clickedCount % rawBatchSize === 0) {
    logger.info(`[Execute Task] 轮询: 已连续点击 ${rawBatchSize} 个，组间休息 ${batchIntervalSec} 秒后继续...`);
    await new Promise(resolve => setTimeout(resolve, batchIntervalSec * 1000));
}
```

关键语义：

- `clickedCount` 已存在且每 selector 独立（声明于 `for selector` 内层），天然满足"按 selector 累计"。
- 满 N 判定发生在点击、确认框、日志、元素间隔等待**之后** → 第 N 与 N+1 个之间共 I+M 秒。
- `clickedCount % N === 0` 覆盖第 N、2N、3N… 次。
- 末组不足 N：最后一次点击后 `result.remaining === 0`，两个等待块都跳过 → 不额外休息，与现状一致。
- 无元素时（`initResult.visibleCount === 0`）continue 跳过该 selector；循环内 `result.clicked === false` break——均不涉及新逻辑。

### 日志可观测性

沿用既有 RendererTransport（`src/utils/logger.js`）→ `log-message` IPC → UI `addLog`。仅在分批启用且真正触发组间休息时输出一行，未启用时零噪声。

## 关键取舍与风险

| 取舍 | 说明 |
|---|---|
| 分批字段可选填 = 不分组 | 存量轮询步骤无论是否重新保存均节奏不变（编辑旧步骤时批次输入框留空、不填就不写字段）；仅当用户显式填写 N/M（或新建步骤接受默认 10/60）才启用分批 |
| I 与 M 叠加而非替换 | 元素间隔保证单次操作最小时间窗，组间休息是叠加的长休，语义清晰互不干扰 |
| clickedCount 每 selector 独立 | 变量在 `for selector` 循环体内声明，无需新增状态；跨 selector 不纠缠 |
| 防御式取值 | 即使 JSON 被外部工具写入坏值，执行层也退回不分组，不崩溃不误等待 |

**风险与缓解：**

- [组间休息期间页面 DOM 变化] → 每轮重查 + `dataset.iterateClicked` 标记，休息后仍只点未标记可见元素；元素被删则自然跳过。
- [N 设得极大 ≈ 不分批] → 属用户配置自由，UI 默认值合理即可，不做强限制。
- [M 很大导致任务很久] → 日志实时上屏（含"已连续点击 N 个，组间休息 M 秒"提示），用户可感知进度而非误以为卡死。

## 测试策略

- **静态**：`node --check electron/main.js`。
- **手动界面验证**：
  - 新建步骤勾选轮询 → 显示三个输入框，批次默认 10/60（输入框已填）；保存后卡片显示 `分批10/休息60s`；再次编辑回填一致。
  - 编辑旧步骤（无字段）→ 批次输入框留空（placeholder 显示 10/60），直接保存后卡片仍无分批标记、运行时不分批（重存不改变行为）。
  - 编辑旧步骤并显式填写 N/M → 保存后卡片显示分批标记、运行时启用分批。
  - 不勾选轮询时整组隐藏；保存的步骤对象不含批次字段。
- **执行验证**：构造 25 个匹配元素的测试页，N=10/M=60/I=10：
  - 第 10 个点完后等 10s + 额外 60s（日志出现"组间休息"）；
  - 第 20 个点完后再休一次；末组 5 个点完即停，无第三次组间休息。
  - 确认框在组间休息前每次点击后仍被处理。
- **回归**：
  - 直接构造无新字段的步骤 JSON 执行 → 行为与现状一致（无分组日志）。
  - 通过 UI 重新编辑并保存旧步骤（未填批次字段）→ 步骤对象仍无批次字段，执行与旧版一致。
  - 字段为 0 / 空 / NaN 的步骤 → 等同不分批。
  - 未勾选轮询步骤（`iterate_all` 假）即使带字段也忽略 → 只点第一个。

## Spec Patch

delta spec（`openspec/changes/batch-iterate-with-group-rest/specs/auto-interaction/spec.md`，ADDED Requirement「轮询分批组间休息」）追加一个场景：「旧步骤经 UI 重存不静默启用分批」。其余 4 个场景与本设计一致。
