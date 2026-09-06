## Why

「轮询页面所有相同元素」模式目前只能原地完成：所有元素在同一页面里逐个点完，然后才继续任务里的后续步骤。当轮询点击会导致页面跳转（如点击列表项进入详情页）时，后续步骤根本无法按预期执行。需要一种「裂变」模式：轮询每处理一个元素，就新开一个浏览器标签页，在其中执行该元素对应的后续步骤，完成后关闭，原 tab 保持列表页不动，继续处理下一个元素——整体行为与 Chrome/Firefox 多标签页浏览一致。

## What Changes

- **步骤数据模型扩展**：轮询步骤新增可选布尔字段 `iterate_open_tabs`：
  - 为真且轮询步骤**不是最后一步**时，启用「裂变模式」；其余情况（字段缺失/为假/是最后一步）保持现有原地轮询行为
- **多标签页浏览器外壳**：
  - 主进程新增 `TabManager`（基于 `WebContentsView`，Electron 41 中 `BrowserView` 已废弃）
  - 所有 tab 共用默认 session，自动共享登录态（cookie/localStorage），与 Chrome 同窗口多 tab 原理一致
  - 渲染层新增 Chrome 式 Tab 栏：显示各 tab 标题、可点击切换激活、可关闭；工具栏与地址栏作用于当前激活 tab
- **裂变执行逻辑**（串行）：
  - 主 tab 停留在轮询列表页不动，仅做元素扫描与进度标记（「调度台」）
  - 每个轮询步骤创建 1 个临时 tab（元素间复用，避免频繁建/销毁抖动），在其中加载列表页 → 按描述符（text/href 优先、索引兜底）匹配并点击第 k 个元素 → 页面跳转留在临时 tab 内（`setWindowOpenHandler` 劫持 `target="_blank"`）→ 在临时 tab 内顺序执行后续步骤（含各自确认框处理）
  - 全部元素处理完后关闭临时 tab，激活主 tab，继续任务
- **向后兼容**：旧步骤无 `iterate_open_tabs` 字段时行为与现状完全一致；新建轮询步骤且非最后一步时该复选框默认勾选，用户可取消

## Capabilities

### New Capabilities
- `tab-management`: 浏览器外壳支持多标签页——标签栏 UI、tab 创建/激活/关闭、激活 tab 与工具栏/地址栏联动、所有 tab 共享登录态。

### Modified Capabilities
- `auto-interaction`: 轮询模式支持「裂变」——每个元素在独立新 tab 中触发跳转并执行后续步骤，主 tab 保持列表页作为调度台。

## Impact

- 新增 `electron/tab-manager.js`: WebContentsView 的增删/激活/隐藏/事件广播（tabs-changed / url / title 事件）。
- 重构 `electron/main.js`:
  - `browserView` 单例替换为 TabManager；所有 `browser-*` IPC 处理器（navigate/back/forward/refresh/screenshot/zoom/url/title/execute-script/click-element）改为作用于当前激活 tab
  - `execute-task` 中抽出可复用的「在指定 webContents 上执行单个步骤」函数；轮询分支增加裂变路径
- 修改 `electron/renderer/index.html`: Tab 栏 UI（CSS + DOM + IPC 监听）、工具栏 y 坐标下移、步骤编辑弹窗轮询选项区新增复选框「每个元素在新标签页中执行后续步骤」（默认勾选，仅当非最后一步时显示/生效）
- `src/models/UrlModel.js` / `src/db/database.js`: 无需改动（steps 为 JSON 存储，新字段自动持久化）。

## 相关说明

- 仅实现 Electron 桌面端；Web 定时服务（`TaskScheduler`/playwright 路径）本次不改动。
- 嵌套裂变（临时 tab 内的后续步骤又是轮询+裂变）v1 不支持：临时 tab 内的轮询步骤一律按原地模式执行，记入设计文档作为已知限制。
- 裂变模式下元素间隔（`iterate_interval`）与分组休息（`iterate_batch_size`/`iterate_batch_interval`）语义不变：等待发生在「上一个元素的临时 tab 流程结束」与「下一个元素开始」之间。
