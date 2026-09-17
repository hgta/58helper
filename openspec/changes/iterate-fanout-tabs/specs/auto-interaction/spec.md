## ADDED Requirements

### Requirement: 轮询模式裂变执行
系统在「轮询页面所有相同元素」执行时，SHALL 支持裂变模式：当步骤启用 `iterate_open_tabs` 且不是任务的最后一步时，每个轮询元素在一个新标签页中触发点击与页面跳转，并在该标签页内顺序执行任务的后续步骤，完成后关闭标签页并继续下一个元素；主标签页 MUST 始终停留在轮询列表页不动；未启用或字段缺失时 MUST 保持原有原地轮询行为。

#### Scenario: 启用裂变的基本执行流
- **WHEN** 轮询步骤配置 `iterate_open_tabs = true` 且其后存在后续步骤
- **THEN** 系统创建一个临时标签页，在其中加载轮询页并点击第 1 个匹配元素（跳转发生在临时标签页内）
- **AND** 在该临时标签页内顺序执行后续步骤（含各自确认框处理）
- **AND** 该元素流程结束后，临时标签页重新加载轮询页处理下一个元素，主标签页全程不发生跳转
- **AND** 全部元素处理完毕后关闭临时标签页并激活主标签页

#### Scenario: 元素身份按描述符优先匹配
- **WHEN** 临时标签页重新加载轮询页后列表 DOM 顺序发生变化
- **THEN** 系统按扫描阶段记录的元素描述符（文本与 href）优先匹配目标元素，匹配失败时退化为按可见顺序索引匹配
- **AND** 两种方式均无法匹配时记录日志并跳过该元素，不中断整个任务

#### Scenario: 点击目标下钻到真正可点击元素
- **WHEN** 系统匹配到目标元素并执行点击
- **THEN** 系统不在外层容器上直接派发点击，而是按优先级选择可点击目标：元素自身或最近祖先 `<a>` → 元素内部 `<a>` → 子树中文本与描述符一致的最深叶子元素 → 元素自身
- **AND** 该规则保证在「外层为布局容器、交互事件绑定在内部子元素」的页面（如 uni-app 组件）中点击能真正触发交互，而非仅产生视觉点击痕迹
- **AND** 实际点击目标与选择依据（`clickReason`）记入日志，便于诊断「日志显示已点击但页面无反应」
- **AND** 点击后同标签页内未发生跳转时记录诊断日志，但不中断任务

#### Scenario: 间隔与分组节奏语义保持
- **WHEN** 裂变模式与 `iterate_interval` / `iterate_batch_size` / `iterate_batch_interval` 同时配置
- **THEN** 等待语义与原地模式一致：上一个元素的临时标签页流程结束后等待元素间隔；满 N 个元素后再额外等待组间休息时长

#### Scenario: 未启用裂变保持原有行为
- **WHEN** 轮询步骤不包含 `iterate_open_tabs` 字段或该字段为假
- **OR** 轮询步骤是任务的最后一步
- **THEN** 系统按原有原地轮询逻辑执行（同一页面内逐个点击，不创建标签页）

### Requirement: 轮询全局唯一计数
系统在「轮询页面所有相同元素」执行时，SHALL 支持可选的「全局唯一计数」模式：当步骤启用 `iterate_global_unique_count` 时，跨所有 `button_selectors` 匹配到的可见元素合并成一个全局队列统一计数，并采用 `iterate_global_batch_size` / `iterate_global_batch_interval` 控制全局分批休息；未启用时 MUST 保持原有按选择器独立计数的行为。

#### Scenario: 启用全局唯一计数
- **WHEN** 轮询步骤配置 `iterate_global_unique_count = true`
- **AND** 用户填写了有效的 `iterate_global_batch_size` 与 `iterate_global_batch_interval`
- **THEN** 系统把所有选择器匹配到的可见元素按 DOM/选择器顺序合并为一个全局队列
- **AND** 全局累计点击数达到 `iterate_global_batch_size` 后，额外休息 `iterate_global_batch_interval` 秒再继续
- **AND** 原「每组连续点击数 / 组间休息」字段被忽略

#### Scenario: 未启用全局唯一计数保持局部分批
- **WHEN** 轮询步骤未配置 `iterate_global_unique_count` 或该字段为假
- **THEN** 系统按原有行为：每个选择器独立计数，满 `iterate_batch_size` 后休息 `iterate_batch_interval`

#### Scenario: 全局唯一计数在裂变模式下同样生效
- **WHEN** 轮询步骤同时启用 `iterate_global_unique_count` 与 `iterate_open_tabs`
- **THEN** 主 tab 扫描时跨选择器合并描述符并记录全局序号
- **AND** 临时 tab 内按 `selector + selectorIndex` 定位元素，临时 tab 流程按全局计数执行分批休息

#### Scenario: 旧步骤经 UI 重存不静默启用裂变
- **WHEN** 用户在编辑界面打开一个不含 `iterate_open_tabs` 字段的存量轮询步骤且未勾选新复选框即保存
- **THEN** 保存后的步骤对象仍不包含该字段，执行行为与编辑前完全一致
- **AND** 新建轮询步骤时该复选框默认勾选

#### Scenario: 临时标签页内轮询不嵌套裂变
- **WHEN** 裂变模式下后续步骤本身也是启用了 `iterate_open_tabs` 的轮询步骤
- **THEN** 该后续步骤在临时标签页内按原地轮询模式执行，不再创建新的标签页

#### Scenario: 临时标签页执行异常不中断任务
- **WHEN** 某个元素的临时标签页流程中出现页面加载超时、元素找不到或执行异常
- **THEN** 系统记录日志、跳过该元素并继续处理下一个元素，任务不中断
