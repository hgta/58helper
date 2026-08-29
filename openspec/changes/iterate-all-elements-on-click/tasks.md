## 1. 步骤编辑界面（electron/renderer/index.html）

- [x] 1.1 在步骤编辑弹窗「按钮选择器」textarea 下方新增勾选框「轮询页面所有相同元素」（`#step-iterate-all`）和「轮询间隔（秒）」输入框（`#step-iterate-interval`，默认 10，`min="1"`），并实现勾选时显示间隔输入框的联动
- [x] 1.2 `addStep()` 清空新字段（勾选框取消、间隔恢复默认 10）
- [x] 1.3 `editStep(index)` 回填 `step.iterate_all` / `step.iterate_interval`
- [x] 1.4 `step-form` 提交时读取勾选框与间隔值写入步骤对象
- [x] 1.5 `renderSteps()` 步骤卡片展示轮询标记（如 `🔁 轮询所有(间隔10s)`）

## 2. 执行逻辑（electron/main.js）

- [x] 2.1 将现有确认框处理逻辑抽取为 `handleConfirmBox(webContents, confirmSelectors)` 函数，非轮询路径复用
- [x] 2.2 按钮点击块：`step.iterate_all` 为真时进入轮询模式（`querySelectorAll` 循环点击未处理且可见的元素，每个元素后调用 `handleConfirmBox`，间隔 `iterate_interval` 秒，间隔取值容错默认 10）
- [x] 2.3 非轮询路径保持现状（只点第一个匹配元素）

## 3. 验证

- [x] 3.1 `node --check` 校验 `electron/main.js` 语法；渲染层无 JS 报错
- [x] 3.2 界面：编辑步骤时能勾选轮询、设置间隔；保存后步骤卡片显示轮询标记；再次编辑能正确回填
- [x] 3.3 执行：勾选轮询的任务对页面上多个匹配元素依次点击，每个间隔为配置秒数，每个元素点击后确认框被处理
- [x] 3.4 回归：未勾选轮询的任务行为与之前一致（只点第一个）
