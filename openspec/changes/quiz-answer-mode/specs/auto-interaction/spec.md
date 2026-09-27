## ADDED Requirements

### Requirement: 单步骤执行支持分支路径

`auto-interaction` 能力在执行单个步骤时 SHALL 根据步骤类型选择执行路径：普通按钮点击 / 轮询，或答题模式。

#### Scenario: 普通步骤执行
- **GIVEN** 步骤未启用答题模式
- **WHEN** 执行该步骤
- **THEN** 系统保持原有行为：加载页面后点击按钮 / 轮询，再处理确认框

#### Scenario: 答题模式步骤执行
- **GIVEN** 步骤启用答题模式且包含有效答案列表
- **WHEN** 执行该步骤
- **THEN** 系统加载页面后调用 `answerQuiz` 完成自动答题
- **AND** 答题结束后处理确认框（如果配置了确认框选择器）

### Requirement: 答题模式不影响原有步骤字段

系统对未启用答题模式的步骤 SHALL 完全保持向后兼容。

#### Scenario: 旧任务步骤未启用答题模式
- **GIVEN** 存量任务步骤不含 `is_answer_mode` 字段
- **WHEN** 执行该步骤
- **THEN** 系统按原有逻辑执行，行为不变
