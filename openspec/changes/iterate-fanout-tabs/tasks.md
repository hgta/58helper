# Tasks: iterate-fanout-tabs

## Task 1: TabManager 模块与多标签页外壳

- [x] 1.1 新建 `electron/tab-manager.js`：基于 `WebContentsView` 的 TabManager（createTab / closeTab / activate / getActiveWebContents / tabs-changed 广播 / attachTo 主窗口 resize 联动），所有 tab 使用默认 session 共享登录态
- [x] 1.2 每个 tab 创建时 `setWindowOpenHandler` 劫持 `target="_blank"`：deny + 本 tab 内 loadURL
- [x] 1.3 `electron/main.js`：`browserView` 单例替换为 TabManager（含启动时创建主 tab）；所有 `browser-*` IPC 处理器改为作用于激活 tab；激活 tab 的 did-navigate / page-title-updated 事件转发渲染层；模态框 modal-show/hide 的 bounds 处理同步适配
- [x] 1.4 `electron/renderer/index.html`：新增 Tab 栏 UI（CSS + DOM + `tabs-changed` 监听 + `tab-activate` / `tab-close` IPC 发送）；工具栏及内容区 y 坐标下移 34px；主 tab 不可关闭；工具栏地址栏/后退/前进/刷新/缩放对激活 tab 生效
- [ ] 1.5 手动验证：多 tab 创建/切换/关闭、登录态共享、`_blank` 链接留在 tab 内、模态框显示时 tab 区域正确隐藏

## Task 2: 裂变执行逻辑

- [x] 2.1 `electron/main.js`：将 `execute-task` 内联的「loadURL → 稳定等待 → 点击/轮询 → confirm」重构为 `runStepInWebContents(webContents, step, { allowFanout })`，主循环与裂变子步骤共用；`allowFanout=false` 保证临时 tab 内不再裂变
- [x] 2.2 裂变分支（`step.iterate_open_tabs === true` 且非最后一步）：主 tab SCAN 快照描述符（text/href/aria/title/index）→ 创建 1 个临时 tab（自动激活）→ 逐元素 [加载列表页 → 描述符优先匹配 + 索引兜底 → 点击目标下钻（`<a>` 自身/祖先/后代 → 最深文本叶子 → 元素自身）后点击 → confirm → 临时 tab 内执行后续步骤 → 主 tab MARK 视觉标记 → 元素间隔/组间休息] → 关闭临时 tab 激活主 tab；点击后记录 `clickReason` 并做跳转校验（未跳转仅告警不中断）
- [x] 2.3 异常处理：加载超时/元素不匹配/后续步骤异常/webContents 被用户关闭 → 记日志跳过当前元素，任务不中断
- [ ] 2.4 手动验证：2 步任务裂变基本流、主 tab 不跳转、元素漂移跳过日志、执行中手动关临时 tab 不崩、旧任务（无字段）回归不变

## Task 3: 步骤编辑 UI 与验证回归

- [x] 3.1 `electron/renderer/index.html`：步骤编辑弹窗轮询选项区新增复选框「每个元素在新标签页中执行后续步骤」——新建步骤默认勾选、编辑旧步骤默认不勾；`addStep` 清空、`editStep` 回填、表单提交读取；步骤卡片展示「🔀 新标签页」标记
- [ ] 3.2 回归验证：原地轮询 + 分批休息（上一 change 功能）不受影响；未勾选轮询时新复选框不显示；步骤保存/读取持久化正确
