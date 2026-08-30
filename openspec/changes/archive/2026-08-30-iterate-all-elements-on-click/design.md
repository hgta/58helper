## Context

Electron 桌面应用（`npm start`）的任务由多步骤组成，每个步骤含 `url`、`button_selectors`（按钮选择器）、`confirm_selectors`（确认框按钮）。步骤以 JSON 存储在 `urls.steps` 列，`UrlModel` 读写时 JSON 序列化/反序列化。

当前 `electron/main.js` 的 `execute-task` 处理器对每个按钮选择器执行 `document.querySelector`，只点击**第一个**可见元素后 `break`。实际业务中 `.itemBox` 一类选择器在页面中会同时匹配多个元素，用户需要依次点击每一个，每个间隔可配置（默认 10 秒），且每个元素点击后都要处理确认框。

## Goals / Non-Goals

**Goals:**
- 步骤编辑界面可为按钮选择器配置「轮询所有匹配元素」及「轮询间隔（秒）」（默认 10）。
- 执行时对匹配选择器的所有可见元素依次点击，每个元素点击后立即处理确认框，再等待配置间隔后点击下一个。
- 未勾选轮询时行为与现状完全一致。

**Non-Goals:**
- 不轮询确认框选择器本身（确认框只在每个元素点击后被处理）。
- 不改动 Web 定时服务（`TaskScheduler`）——它不涉及步骤编辑界面。
- 不做数据库迁移（`steps` 为 JSON 存储，新字段随对象持久化）。

## Decisions

### 决策1: 轮询实现的执行方式
在按钮点击块中，当 `step.iterate_all === true` 时进入轮询模式：
- 对每个按钮选择器，在页面内用 `querySelectorAll` 循环查找"第一个**未点击过且可见**"（`offsetParent !== null`）的元素，通过 `el.click()` 点击，并在该元素上打标记 `el.dataset.iterateClicked = '1'`。
- 每轮点击后：立即执行确认框处理（复用现有逻辑，抽取为函数），记录日志，然后等待 `step.iterate_interval * 1000` ms（默认 10 秒）再进入下一轮。
- 当某轮查询不到新的可点击元素时，跳出当前选择器的循环，继续下一个按钮选择器（若还有）。

**为何用"重新查询 + dataset 标记"而不是一次性 `querySelectorAll` 收集后逐个点:**
页面元素在点击后可能因确认框弹出/局部渲染而变化，一次性收集的引用可能失效。每轮重新查询更稳健。

**替代方案:**
- 一次 `querySelectorAll` 收集全部元素再逐个 `click()` → 点击后 DOM 变化会导致后续元素失效或重复点击。
- 每轮点击索引递增 → 点击后元素被移除时索引错乱，易漏点或重复点。

### 决策2: 确认框处理复用
将 `execute-task` 中现有的确认框处理逻辑（先 `querySelector` 选择器，找不到则按文本匹配 `button/input` 等，点击第一个可见元素，成功后等 500ms）抽取为独立函数 `handleConfirmBox(webContents, confirmSelectors)`，在轮询模式下每个元素点击后调用；非轮询模式保持原有调用点。

### 决策3: 界面交互
在 `electron/renderer/index.html` 的步骤编辑弹窗「按钮选择器」textarea 下方新增：
- 勾选框 `#step-iterate-all`（label: 轮询页面所有相同元素）。
- 数字输入框 `#step-iterate-interval`（label: 轮询间隔（秒），默认 10，`min="1"`），默认隐藏，仅勾选时显示。
- `addStep()` 清空新字段；`editStep(i)` 回填；`step-form` submit 时读取并写入步骤对象；`renderSteps()` 在步骤卡片上展示轮询标记（如 `🔁 轮询所有(间隔10s)`）。

### 决策4: 间隔取值容错
`step.iterate_interval` 从输入框读取，可能为 NaN 或 0；执行时做防御：`const interval = Number(step.iterate_interval) > 0 ? Number(step.iterate_interval) : 10`。

### 决策5: 轮询过程日志可观测性
UI「执行日志」面板当前只显示 renderer 手动 `addLog()` 的内容（高层进度），主进程 `logger.info()` 仅写文件不推 UI。轮询是长时间逐个点击的过程，用户需要实时看到进度。为此：
- `src/utils/logger.js` 为 winston 增加自定义 `RendererTransport`，通过 `loggerEvents`（`EventEmitter`）发出 `{ level, message, timestamp }` 事件。
- `electron/main.js` 启动时订阅 `loggerEvents.on('log', ...)`，通过 `mainWindow.webContents.send('log-message', entry)` 推到渲染进程。
- `electron/renderer/index.html` 监听 `log-message` IPC，调用 `addLog(message, level)` 渲染（debug 级别映射为 info 显示，避免噪声）。
- 效果：所有 `logger.info/warn/error` 自动实时显示到 UI 日志面板，无需手动 addLog。

### 决策6: 轮询日志内容
轮询循环中输出结构化进度日志：
- 开始时：`[轮询] 选择器 X 共 N 个可见元素，开始依次点击`（先查询总数）。
- 每点击一个元素：`[轮询] 选择器 X [k/N] 点击: <元素描述>（剩余 r 个未点击）`。
- 元素描述在页面内提取，优先级：`innerText 前 30 字 > aria-label > title > id > className > tagName`，并带回 `href` 等关键属性。
- 间隔等待时：`[轮询] 等待 S 秒后继续...`（最后一次点击后不等待、不输出）。
- 选择器无可见元素时：`[轮询] 选择器 X 无可见元素，跳过`。

## 待澄清事项

- 轮询过程中若确认框处理失败（找不到确认按钮），是继续下一个元素还是中止？当前设计为**继续下一个元素并记录 warn 日志**（与"尽可能多处理"的轮询语义一致）。如用户需要"失败即中止"，可后续加一个开关。

## Risks / Trade-offs

- [Risk] 页面在轮询过程中整页刷新/跳转会导致 `dataset.iterateClicked` 标记丢失，可能重复点击已处理元素 → 用户场景是弹确认框不刷新，概率低；如遇刷新场景，可后续引入元素去重指纹。
- [Risk] 元素点击有副作用（如打开新页面）时，轮询可能不符合预期 → 由用户自行选择是否开启轮询。
- [Risk] 步骤 JSON 中新增字段对旧版本应用透明（多余字段被忽略），无兼容问题。
