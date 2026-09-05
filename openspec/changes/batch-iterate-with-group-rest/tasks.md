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
