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

## 3. 轮询过程日志可观测性

- [x] 3.1 `src/utils/logger.js` 增加 `RendererTransport`（winston 自定义 transport）与 `loggerEvents`（EventEmitter），所有日志发出 `{ level, message, timestamp }` 事件
- [x] 3.2 `electron/main.js` 订阅 `loggerEvents.on('log')`，通过 `mainWindow.webContents.send('log-message', entry)` 推到渲染进程
- [x] 3.3 `electron/renderer/index.html` 监听 `log-message` IPC 调用 `addLog(message, level)` 实时渲染
- [x] 3.4 轮询循环输出结构化进度：开始显示总数，每个元素显示 `[k/N]` 进度与元素描述（innerText/aria-label/title/id/className/tagName 优先级），间隔等待显示秒数，最后一次点击后不等待
- [x] 3.5 轮询无可见元素时输出提示日志并跳过该选择器
- [x] 3.6 可见性判断从 `offsetParent` 升级为 `getBoundingClientRect()` 宽高检查，兼容 uni-app 自定义元素（如 `uni-image`），同步应用于轮询、非轮询按钮点击与确认框处理
- [x] 3.7 主界面侧边栏统计卡片下方新增「当前任务已执行」计时器条（`#task-timer`），执行中绿色脉冲高亮；单任务执行由 `executeTask` 启停，批量执行由外层 `batchRunning` 统一启停，批量总耗时含任务间间隔

## 4. 验证

- [x] 4.1 `node --check` 校验 `electron/main.js`、`src/utils/logger.js` 语法；渲染层无 JS 报错
- [x] 4.2 界面：编辑步骤时能勾选轮询、设置间隔；保存后步骤卡片显示轮询标记；再次编辑能正确回填
- [x] 4.3 执行：勾选轮询的任务对页面上多个匹配元素依次点击，每个间隔为配置秒数，每个元素点击后确认框被处理
- [x] 4.4 日志：执行轮询任务时 UI 日志面板实时显示总匹配数、`[k/N]` 进度、元素描述与等待提示
- [x] 4.5 回归：未勾选轮询的任务行为与之前一致（只点第一个）
