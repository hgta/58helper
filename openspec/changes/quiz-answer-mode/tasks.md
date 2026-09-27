## 1. UI：步骤编辑模态框增加答题模式

- [x] 1.1 在步骤表单中增加「此步骤为答题模式」复选框及事件监听
- [x] 1.2 增加答案列表文本域（`step-answer-list`）
- [x] 1.3 增加答题间隔输入（`step-answer-interval`）
- [ ] 1.4 增加可选覆盖选择器输入：题目项、选项、提交按钮（当前使用默认选择器，页面改版时再补）
- [x] 1.5 实现勾选「答题模式」后隐藏按钮选择器 / 轮询配置，显示答题配置
- [x] 1.6 更新 `saveStep` 逻辑，保存 `is_answer_mode`、`answer_list`、`answer_interval` 字段
- [x] 1.7 更新 `editStep` 逻辑，回填答题字段
- [x] 1.8 更新 `renderSteps` 列表摘要，显示「答题模式（N 题）」

## 2. 执行引擎：新增 `answerQuiz` 函数

- [x] 2.1 在 `runStepInWebContents` 中增加 `is_answer_mode` 分支
- [x] 2.2 实现 `findNextQuestion`：获取题目项列表并跳过已答题（`.main .nav` + `.uni-checkmarkempty`）
- [x] 2.3 实现 `openQuestion`：滚动到题目项并点击
- [x] 2.4 实现 `waitForAnswerModal`：轮询 `.popup_content.learnanswer` 可见且含选项
- [x] 2.5 实现 `selectOptions`：根据答案字母匹配 `.option` 文本前缀并点击
- [x] 2.6 实现 `submitAnswer`：点击 `.popup_content .button`
- [x] 2.7 实现 `waitForModalClose`：轮询弹窗消失
- [x] 2.8 在循环中支持 `taskControl.checkpoint` 与 `taskControl.wait` 间隔，确保可暂停 / 停止

## 3. 规格文档

- [ ] 3.1 创建 `openspec/specs/quiz-answering/spec.md`（主规格，归档时同步）
- [x] 3.2 创建 `openspec/changes/quiz-answer-mode/specs/quiz-answering/spec.md`
- [x] 3.3 创建 `openspec/changes/quiz-answer-mode/specs/auto-interaction/spec.md`（步骤执行分支 delta）

## 4. 测试验证

- [ ] 4.1 在已登录浏览器中打开答题页面，验证框架能识别题目项
- [ ] 4.2 使用用户提供的 4 组答案列表（22/33/44/55 题）分别跑一遍
- [ ] 4.3 验证每道题选择并提交正确，全部完成后出现「领取成功」弹窗
- [ ] 4.4 验证确认框选择器可关闭成功弹窗
- [ ] 4.5 验证暂停 / 停止按钮在答题过程中可正常中断
- [ ] 4.6 验证答题模式步骤与普通点击步骤可在同一任务中混用
