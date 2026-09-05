# Brainstorm Summary

- Change: batch-iterate-with-group-rest
- Date: 2026-09-05

## 确认的技术方案

「轮询页面所有相同元素」模式新增分批节奏控制。步骤 JSON 新增两个可选字段：

- `iterate_batch_size`（N，默认 10）：每组连续点击元素个数
- `iterate_batch_interval`（M，秒，默认 60）：满一组后额外休息时长

改动位置：

- `electron/renderer/index.html`：在 `iterate-interval-group` 容器内「轮询间隔（秒）」下方新增「每组连续点击数（个）」（`#step-iterate-batch-size`，默认 10）与「组间休息（秒）」（`#step-iterate-batch-interval`，默认 60），随勾选联动显示/隐藏；`addStep`/`editStep`/表单提交/`renderSteps` 卡片标记同步处理。
- `electron/main.js` 轮询分支（L430-520）：复用已有 `clickedCount` 与 `for selector` 内层 `while` 结构。每点一个元素并处理确认框后 `clickedCount++`；若 `remaining > 0` 且 `clickedCount % batchSize === 0`，在既有元素间隔等待之后追加 `batchIntervalSec` 秒组间休息并输出日志。末组不足 N 或已点完不等待。
- 防御性取值：`batchSize` 须为正整数、`batchIntervalSec` 须为正数才启用分批；否则走原不分组逻辑。旧步骤无字段 → 行为零变化。

## 关键取舍与风险

| 取舍 | 内容 |
|---|---|
| 字段缺省 = 不分组 | 存量轮询步骤节奏完全不变；新建步骤经 UI 保存即带 N=10/M=60 |
| I 与 M 叠加而非替换 | 元素间隔保最小时间窗，组间休息叠加其上；第 N 与 N+1 个之间共等待 I+M |
| clickedCount 每 selector 独立 | 变量在 `for selector` 内声明，天然满足按 selector 独立累计 |
| 日志 | 沿用 RendererTransport 上屏；仅启用分批且触发时输出提示，不启用无噪声 |

风险：M 等待期间页面变化 → 复用每轮重查 + `dataset.iterateClicked` 机制，仅点未标记且可见元素。无数据库迁移（steps 为 JSON）。

## 测试策略

- `node --check` 校验 `electron/main.js` 语法
- 界面：新建/编辑回填/卡片分批标记
- 执行：25 元素 N=10 → 第 10/20 个后各休 M 一次，末组 5 个点完即停
- 回归：旧步骤（无字段）与未勾选轮询零影响

## Spec Patch

无——open 阶段 delta spec（`specs/auto-interaction/spec.md`，ADDED Requirement「轮询分批组间休息」含 4 个验收场景）已与设计一致。
