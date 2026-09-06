## ADDED Requirements

### Requirement: 多标签页浏览器外壳
系统 SHALL 在主窗口内提供 Chrome/Firefox 式多标签页能力：Tab 栏 UI、标签页创建/激活/关闭、所有标签页共享同一登录态（cookie 与 localStorage），且工具栏与地址栏 SHALL 作用于当前激活的标签页。

#### Scenario: Tab 栏展示与切换
- **WHEN** 存在多个标签页（含主标签页与临时标签页）
- **THEN** Tab 栏展示每个标签页的标题，当前激活标签页高亮，其余标签页内容隐藏
- **AND** 用户点击某个标签页后，该标签页成为激活标签页且内容可见，工具栏/地址栏/缩放作用于它

#### Scenario: 标签页共享登录态
- **WHEN** 用户在任一标签页完成登录后打开或创建新标签页
- **THEN** 新标签页访问同一站点时保持登录状态（cookie/localStorage 共享）

#### Scenario: 关闭标签页
- **WHEN** 用户点击临时标签页的关闭按钮
- **THEN** 该标签页关闭并激活主标签页
- **AND** 最后一个标签页（主标签页）不可关闭

#### Scenario: 新窗口打开的链接留在标签页内
- **WHEN** 标签页内点击 `target="_blank"` 链接或触发 window.open
- **THEN** 跳转在当前标签页内完成，不弹出独立浏览器窗口
