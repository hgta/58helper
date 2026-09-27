## ADDED Requirements

### Requirement: 步骤可标记为答题模式

系统在编辑任务步骤时 SHALL 支持将步骤标记为答题模式，并提供预设答案列表。

#### Scenario: 用户新增答题步骤
- **WHEN** 用户在步骤编辑模态框中勾选「此步骤为答题模式」
- **THEN** 系统显示答案列表、答题间隔与可选选择器覆盖字段
- **AND** 系统隐藏普通按钮选择器与轮询配置

#### Scenario: 用户保存答题步骤
- **WHEN** 用户填写答案列表并保存
- **THEN** 系统保存 `is_answer_mode = true`、`answer_list`、`answer_interval` 等字段到步骤对象

### Requirement: 按答案列表自动答题

系统在执行答题模式步骤时 SHALL 按答案列表顺序，逐题选择选项并提交。

#### Scenario: 单题单选
- **GIVEN** 当前步骤为答题模式且答案列表第 N 项为 `C`
- **WHEN** 系统打开第 N 道未答题
- **THEN** 系统点击文本以 `C、` 开头或包含 `C` 答案文本的选项
- **AND** 系统点击提交按钮

#### Scenario: 多选题目
- **GIVEN** 答案列表第 N 项为 `A,B`（或 `AB` / `A B`）
- **WHEN** 系统打开第 N 道未答题
- **THEN** 系统依次点击 A 选项与 B 选项
- **AND** 系统点击提交按钮

#### Scenario: 顺序完成全部题目
- **GIVEN** 答案列表有 M 个答案
- **WHEN** 页面存在至少 M 道未答题
- **THEN** 系统逐题完成 M 次选择并提交
- **AND** 每道题之间等待配置的答题间隔

### Requirement: 跳过已答题

系统答题时 SHOULD 跳过页面上已标记为完成的题目。

#### Scenario: 部分题目已答
- **GIVEN** 页面上部分题目已带完成标记（如绿色对勾或 `.answered` 类）
- **WHEN** 系统按顺序寻找下一道未答题
- **THEN** 系统跳过已答题，仅对未答题使用答案列表

### Requirement: 答题过程可中断

系统在答题过程中 SHALL 支持任务暂停与停止。

#### Scenario: 用户点击停止
- **WHEN** 用户点击停止按钮
- **THEN** 系统在完成当前一题的提交判断后立即退出答题循环
