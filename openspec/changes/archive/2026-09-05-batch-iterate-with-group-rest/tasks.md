## 1. 步骤编辑界面（electron/renderer/index.html）

- [x] 1.1 在「轮询间隔（秒）」输入框下方新增「每组连续点击数（个，可选填）」（`#step-iterate-batch-size`，placeholder 10，`min="1"`）与「组间休息（秒，可选填）」（`#step-iterate-batch-interval`，placeholder 60，`min="1"`），并入现有 `iterate-interval-group` 显示/隐藏联动（仅勾选轮询时显示）；字段可选填，留空 = 不分批
- [x] 1.2 `addStep()` 清空并预填新字段默认 10 与 60（新建轮询步骤默认分批）
- [x] 1.3 `editStep(index)` 对已含字段步骤回填值、对无字段步骤留空（`step.iterate_batch_size || ''`）
- [x] 1.4 `step-form` 提交仅当已勾选轮询且 N/M 均填有效正整数时写入字段，否则步骤对象不含批次字段（空/NaN/未勾选轮询均不写）
- [x] 1.5 `renderSteps()` 步骤卡片轮询标记追加分批信息（如 `🔁 轮询所有(间隔10s, 分批10/休息60s)`），旧步骤无字段时不显示分批部分

## 2. 执行逻辑（electron/main.js）

- [x] 2.1 轮询分支读取并防御性校验新字段：`batchSize` / `batchIntervalSec` 均须为正整数/正数才启用分批，否则走原有不分组逻辑
- [x] 2.2 轮询循环维护 `clickedCount`（每 selector 从 0 累计）；每点击一个元素并处理确认框后，`clickedCount++`；当满 N（`clickedCount % batchSize === 0`）且仍有剩余元素时，在既有元素间隔等待后追加 `batchIntervalSec` 秒的组间休息
- [x] 2.3 组间休息触发时输出日志（沿用 RendererTransport 通道上屏）：`已连续点击 N 个，组间休息 M 秒后继续...`；最后一次点击或不足一组时不输出、不等待
- [x] 2.4 非轮询路径与分批未启用路径保持现状零改动

## 3. 验证

- [x] 3.1 `node --check` 校验 `electron/main.js` 语法；渲染层无 JS 报错
- [x] 3.2 界面：编辑步骤时能设置每组点击数/组间休息；保存后卡片显示分批标记；再次编辑能正确回填（以代码走查确认：form 读取/清空/回填三处均已接入新字段，HTML 结构闭合）
- [x] 3.3 执行：轮询任务每满 N 个后额外休息 M 秒再继续；末组不足 N 个时点完即停、不等待组间休息（以临时 Node 脚本模拟 25 元素 N=10 序列断言：10→休、20→休、25 结束无休，PASS）
- [x] 3.4 日志：UI 日志面板在每次组间休息触发时显示对应提示（沿用现有 logger.info `[Execute Task]` 前缀与上屏通道，代码走查确认）
- [x] 3.5 回归：旧步骤（无新字段）行为与之前完全一致（每元素间隔点击，不分组）；未勾选轮询的任务行为不变（字段缺省 `Number(undefined)`→NaN 使 `batchEnabled=false`，非轮询分支不进入，代码走查确认）

## 4. 审查修复（review:standard，code review 轮发现）

- [x] 4.1 Important #1（旧步骤经 UI 重存即被静默启用分批）：批次输入框改为「可选填」（HTML `placeholder` 替代 `value`，标签标注可选填）；`editStep()` 对无字段步骤回填空字符串而非默认值；submit 仅当 `iterate_all` 且 N/M 均为有效正整数时写入字段，否则步骤对象不含批次字段。同步 design doc（UI/取舍/测试策略）与 delta spec（新增场景「旧步骤经 UI 重存不静默启用分批」）。
- [x] 4.2 Important #2（M 整数截断）：接受不改——delta spec 场景明确定义 N/M 均为**正整数**，`parseInt` 截断即 UI 层对整数语义的强制实现；执行层 `Number.isFinite(batchIntervalSec) > 0` 的宽松判断属防御式取值，二者不冲突（原因已记录）。
- [x] 4.3 Minor #1（非轮询/新建步骤也写入默认字段）：随 4.1 一并消除——`batchValid` 要求 `iterate_all`，未勾选轮询保存的步骤对象不再含批次字段（原因已记录）。
- [x] 4.4 Minor #2（I+M 叠加时长可观测性）：接受不改——代码注释与日志文案已说明「组间休息叠加在元素间隔之后」，叠加总时长语义清晰（原因已记录）。
