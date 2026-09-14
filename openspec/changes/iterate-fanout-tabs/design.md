# Design: iterate-fanout-tabs（轮询裂变新标签页执行后续步骤）

## 1. 背景与目标

当前 `execute-task`（`electron/main.js`）在单一 `BrowserView` 中顺序执行步骤。轮询步骤（`iterate_all`）原地逐个点击所有匹配元素——若点击导致页面跳转，轮询状态即被破坏，后续步骤无法执行。

目标：引入「裂变」模式。用户确认的核心决策：

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 后续步骤 URL 与轮询元素关联？ | **无关联，固定 URL**（以后再迭代） |
| 2 | 新 tab 形式 | **Chrome/Firefox 式多标签页**（同窗口 Tab 栏） |
| 3 | 主 tab 状态 | **保持不动**，只标记 + 点击交给新 tab |
| 4 | 串行/并发 | **严格串行** |
| 5 | 登录态 | **共享**（同默认 session，天然满足） |

补充决策（探索阶段确认）：
- **tab 复用**：每个轮询步骤建 1 个临时 tab，元素间复用，步骤结束关闭（视觉/行为与每元素建销毁完全等价，性能更稳）
- **显式开关**：新字段 `iterate_open_tabs`（布尔），不静默启用；新建轮询步骤且非最后一步时默认勾选

## 2. 架构

### 2.1 主窗口布局变化

```
┌─ 主窗口 (BrowserWindow, frame:false) ─────────────────────┐
│ 渲染层 index.html（左栏 280px 控制面板保持不变）            │
│ ┌─ 右侧内容区 ────────────────────────────────────────────┐│
│ │ Tab 栏 (新增, 高 34px, y:42)                             ││
│ │ [列表页●] [详情·元素2/8 ×] [激活tab高亮]                 ││
│ ├─ 工具栏 (现有, y:42 → 76)                                ││
│ │ ← → ⟳ [地址栏..........] − 100% +                       ││
│ ├─ WebContentsView 区域 (y:76 起) ───────────────────────┤│
│ │   仅激活 tab 可见，其余 setVisible(false)                ││
│ └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 2.2 TabManager（新模块 `electron/tab-manager.js`）

```
class TabManager {
  tabs: Map<id, { view: WebContentsView, title, url, kind: 'main'|'temp', meta }>
  activeId: string

  createTab(opts) -> id      // WebContentsView + 默认 session（共享登录态）
  closeTab(id)
  activate(id)               // setVisible 切换 + 通知渲染层
  getActiveWebContents()     // 兼容现有 browser-* IPC 的取用点
  broadcast('tabs-changed')  // 渲染层 Tab 栏刷新
  attachTo(window)           // mainWindow resize 联动
}
```

- **默认 session**：`new WebContentsView({ webPreferences: { session: session.defaultSession } })`（不显式设 partition 即默认 session）→ cookie/localStorage 与主 tab 共享。
- **事件路由**：仅激活 tab 的 `did-navigate` / `page-title-updated` 转发渲染层（`browser-url-changed` / `browser-title-changed` 保持不变，渲染层零感知）。
- **`target="_blank"` 劫持**：每个 tab 创建时 `setWindowOpenHandler(({url}) => { loadURL 自身; return {action:'deny'} })`，跳转留在 tab 内。

### 2.3 渲染层 Tab 栏（`electron/renderer/index.html`）

- DOM：`<div class="tabbar">` 内动态生成 `.tab-item`（favicon 位 + 标题 + 关闭 ×）
- IPC 监听：`tabs-changed`（全量 tab 列表 + activeId）→ 重绘；点击 tab → `tab-activate`；点击 × → `tab-close`
- 关闭保护：最后一个 tab（主 tab）不可关闭；任务执行中临时 tab 的 × 点击交给主进程判定（执行中则忽略并提示）
- 工具栏地址栏/后退/前进/刷新/缩放：通过现有 `browser-*` IPC，主进程路由到激活 tab，渲染层无需改逻辑

## 3. 裂变执行流程（串行状态机）

```
前置：step.iterate_open_tabs === true 且 step 非 steps[] 最后一步

SCAN   主tab(已加载列表页): querySelectorAll 统计可见元素 V
       快照描述符数组 D[k] = { text, href, aria, title, index }
       (V=0 → 跳过该选择器)
OPEN   TabManager.createTempTab(name='轮询')  → 自动激活(用户可围观)
FOR k = 0 .. V-1:
  LOAD    临时tab.loadURL(列表页URL) → did-finish-load → 稳定等待
  CLICK   在临时tab内按 D[k] 匹配元素:
            主匹配: text 完全相等 且 href 相等(有href时)
            兜底:   可见元素中第 k 个未标记项(按索引)
          匹配失败 → 记日志跳过该元素(continue)
          点击目标下钻: <a>(自身/祖先/后代) → 最深文本叶子 → 元素自身
          click → 跳转发生在临时tab内
  CONFIRM 临时tab内 handleConfirmBox(本步 confirm_selectors)
  SUBSTEP 临时tab内顺序执行 steps[k+1..N]:
            复用抽取出的 runStepInWebContents(wc, step)
            (后续步骤里的轮询一律按原地模式执行 — 已知限制)
  MARK    主tab: 对第k个元素加视觉标记(已完成描边) [纯进度提示]
  REST    若还有剩余元素: 等 iterate_interval
          满批且还有剩余: 再等 iterate_batch_interval (语义不变)
CLOSE  TabManager.closeTempTab() → 激活主tab → 轮询步骤结束
```

### 3.1 关键实现点

**元素身份跨加载漂移**：裂变模式下每次迭代都重新加载列表页，DOM 顺序可能变化。SCAN 阶段在主 tab 抓取描述符快照（去空白 text、href、aria-label、title、tagName、可见序号），CLICK 阶段优先按 `text+href` 精确匹配，失败退化为「第 k 个可见未标记元素」。不匹配则记 `logger.warn` 并跳过，不中断整个任务。

**点击目标下钻（可点击元素识别）**：匹配到目标元素后 MUST NOT 直接对该元素调用 `click()`——列表里的「按钮」常常只是布局容器（如 uni-app 的 `<uni-view class="loginBox">`），真正的 `@click` handler 挂在内部更深节点（`<uni-text>` / `<span>`）上；对容器派发点击事件不会冒泡触发内部（其实是同层/更内层）的 handler，表现为「日志显示已点击、页面毫无反应」。点击目标按以下优先级下钻：
1. 元素自身或最近祖先 `<a>`（href 导航场景，保持原有行为）
2. 元素内部第一个 `<a>`
3. 子树中「无 element 子节点且文本等于描述符 text」的最深叶子元素（uni-app 等事件代理场景，事件冒泡触发真正的 handler）
4. 兜底：元素自身

选择依据与结果写入日志（`clickReason`：`self-anchor` / `ancestor-anchor` / `descendant-anchor` / `deepest-text-match` / `self`），便于定位「日志显示已点击但页面无反应」。用户侧的 `button_selectors` 无需为此调整——选择器继续指向列表项/按钮容器即可，下钻由系统自动完成。

**点击生效校验**：点击后同标签页内跳转超时未发生时记 `logger.warn`（含扫描序号、实际点击序号、命中标签与 `clickReason`），仅作诊断，不中断流程（部分场景为 AJAX 切换账号、不改变 URL，属正常）。

**主 tab 标记**：主 tab 全程不点击、不跳转。MARK 仅 `dataset.iterateDone='1'` + 插入描边样式（`outline: 2px solid #4caf50`），供用户目视进度；主 tab 若被用户手动刷新，标记丢失但执行不受影响（快照在主进程内存中）。

**步骤执行函数抽取**：现 `execute-task` 内联的「loadURL → 稳定等待 → 点击/轮询 → confirm」重构为 `runStepInWebContents(webContents, step, {allowFanout:false})`。主循环与裂变 SUBSTEP 共用；`allowFanout=false` 保证临时 tab 内不再裂变。

**多个 button_selectors**：沿用现有语义——裂变模式仅对第一个有可见元素的选择器生效（原地模式是逐个选择器独立轮询）。记入已知限制。

## 4. 数据模型与 UI

### 4.1 步骤字段

```jsonc
{
  "url": "...",
  "button_selectors": ["..."],
  "confirm_selectors": [],
  "iterate_all": true,
  "iterate_interval": 10,
  "iterate_batch_size": 10,        // 上个 change 引入
  "iterate_batch_interval": 60,    // 上个 change 引入
  "iterate_open_tabs": true        // 本次新增, 可选布尔
}
```

### 4.2 步骤编辑 UI

- 位置：「轮询间隔（秒）/ 每组连续点击数 / 组间休息（秒）」之后新增复选框
- 文案：「每个元素在新标签页中执行后续步骤」
- 显隐逻辑：勾选「轮询页面所有相同元素」时显示（与现有轮询字段一致）
- 默认值：**新建步骤默认勾选**；编辑旧步骤（无字段）默认不勾，保持「不静默启用」原则（与 `iterate_batch_*` 修复一致）
- 步骤卡片展示：勾选时追加标记「🔀 新标签页」

## 5. 错误处理

| 场景 | 行为 |
|------|------|
| 临时 tab 页面加载失败/超时 | 记日志，跳过当前元素，继续下一个 |
| 元素匹配失败（列表变化） | 记日志，跳过该元素 |
| 临时 tab 执行后续步骤异常 | 记日志（沿用现有 try/catch 粒度），继续下一个元素 |
| 用户在执行中手动关闭临时 tab | 主进程检测 webContents destroyed → 跳过当前元素继续 |
| 任务中途取消/窗口关闭 | 临时 tab 随 BrowserWindow 销毁，无需特殊处理 |

## 6. 已知限制（v1 明确不做）

1. 嵌套裂变：临时 tab 内的轮询步骤一律原地模式
2. 并发裂变：严格串行，不留并发参数
3. 后续步骤 URL 与元素关联：固定 URL，不支持模板变量
4. 多 button_selectors 裂变：仅第一个有效选择器参与裂变
5. Web 定时服务（playwright 路径）不支持裂变

## 7. 测试策略

手动验证（项目无自动化 GUI 测试设施）：
1. **回归**：旧任务（无 `iterate_open_tabs`）行为与之前完全一致；原地轮询 + 分批休息正常
2. **裂变基本流**：2 步任务（列表页轮询 + 详情页点击确认），验证临时 tab 创建 → 每元素跳转 → 后续步骤执行 → tab 关闭 → 主 tab 未跳转
3. **登录态共享**：登录后跑裂变任务，临时 tab 内页面保持登录
4. **Tab 栏交互**：执行中切换/围观 tab，激活 tab 的地址栏/后退/刷新/缩放正确路由；关闭临时 tab 被正确处理
5. **异常**：列表页元素数量变化时跳过日志正确；执行中手动关临时 tab 不崩
