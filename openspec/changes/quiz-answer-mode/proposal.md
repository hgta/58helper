## Why

用户需要在已登录状态下让 58helper 自动完成 BlockCity 学习页面（`https://www.blockcity.vip/pages/city/learn`）的答题任务。系统应允许用户在任务步骤中预设每道题的答案，执行时按顺序自动选题、提交，无需人工逐题操作。

## What Changes

- **步骤增加「答题模式」勾选框**
  - 在步骤编辑模态框中新增 `此步骤为答题模式` 选项
  - 勾选后隐藏普通按钮选择器 / 轮询配置，显示答题专用字段
- **答题配置字段**
  - 答案列表：每行一个答案（如 `C`、`A,B`、`AB`）
  - 答题间隔（秒）：每道题之间的等待时间
  - 可选覆盖选择器：题目项、选项、提交按钮（用于页面结构变化时兼容）
- **执行引擎扩展**
  - 在 `runStepInWebContents` 中识别 `is_answer_mode`
  - 新增 `answerQuiz` 函数负责：点击下一题 → 等待弹窗 → 选择答案 → 点击提交 → 等待弹窗关闭
  - 复用现有确认框处理与停止 / 暂停机制
- **规格补充**
  - 新增 `quiz-answering` 能力规格
  - 扩展 `auto-interaction` 能力规格支持步骤执行分支

## Capabilities

### New Capabilities
- `quiz-answering`: 按预设答案自动完成页面答题

### Modified Capabilities
- `auto-interaction`: 单步骤执行增加「普通点击 / 答题模式」分支

## Impact

- `electron/renderer/index.html`: 步骤编辑 UI、保存 / 回填 / 列表摘要
- `electron/main.js`: `runStepInWebContents` 分支、`answerQuiz` 执行函数
- `openspec/specs/quiz-answering/spec.md`: 新增
- `openspec/specs/auto-interaction/spec.md`: 扩展步骤分支需求
