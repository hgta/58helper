## ADDED Requirements

### Requirement: 网页加载检测
系统必须检测网页是否已完全加载，以确保后续操作可以执行。

#### Scenario: 网页加载完成
- **WHEN** 页面触发 `load` 事件
- **THEN** 系统确认页面已就绪，准备进行自动交互

### Requirement: 自动点击特定按钮
系统必须能够识别网页上的特定按钮（通过 CSS 选择器或文本）并执行点击操作。

#### Scenario: 成功点击按钮
- **WHEN** 页面加载完成且特定按钮可见
- **THEN** 系统自动模拟鼠标点击该按钮
