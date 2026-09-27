## Context

当前 58helper 的任务步骤是统一结构：每个步骤包含 `url`、`button_selectors`、`confirm_selectors` 与轮询相关字段。执行时统一走「加载页面 → 点击按钮 → 处理确认框」流程。

答题场景与点击场景差异较大：
- 不需要 CSS 选择器去点击题目，而是按**顺序**与每道题交互
- 每道题有「题干 → 选项 → 提交」的固定小流程
- 需要预先知道正确答案

## Goals / Non-Goals

**Goals:**
- 在步骤层面提供「答题模式」开关
- 支持用户以每行一个答案的方式预设答案
- 自动按顺序选题、提交，直到答案列表用完或页面无未答题
- 支持单选与多选（答案可写 `C` 或 `A,B` / `AB`）
- 复用现有的加载、确认框、暂停 / 停止机制

**Non-Goals:**
- 不自动识别题目内容或 OCR
- 不处理登录流程（由用户事先在浏览器登录）
- 不处理复杂的分页 / 虚拟列表翻页（如题目未一次性渲染，需额外处理）
- 不处理需要滑动、拖拽等非点击交互的特殊题型

## 答案数据

用户已提供 154 道题目的完整答案，分为 4 组：

| 奖学金 | 题数 | URL 参数 | 答案字母序列 |
|--------|------|----------|--------------|
| 新人奖学金 | 22 | `type=1` | B C C A C C A B C B B C C A B A C C B A C A |
| 达人奖学金 | 33 | `type=2` | C C C B B C C B C A A C B A C A B A B A C B B C B B A A B B C C B |
| 高人奖学金 | 44 | `type=3` | A C C A C B A C A B A B A A B B B C B A C C C B B B C B A C A B A B A B C A B C C B C A |
| 神人奖学金 | 55 | `type=4` | C C A A B B C B C B B A A A A B C C B B B A A B B B C B B A A C A C A C B A B B C A A B A C B B C C C B A B B |

建议每个奖学金作为一个独立步骤，URL 分别设为：

```
https://www.blockcity.vip/pages/city/learnAnswer?type=1
https://www.blockcity.vip/pages/city/learnAnswer?type=2
https://www.blockcity.vip/pages/city/learnAnswer?type=3
https://www.blockcity.vip/pages/city/learnAnswer?type=4
```

每步只需粘贴对应答案字母（每行一个）。

## Decisions

### 决策 1: 用勾选框扩展现有步骤，而非新增步骤类型

在现有步骤模态框中增加「答题模式」复选框。勾选后该步骤不再执行按钮点击 / 轮询逻辑，而是执行答题逻辑。

**替代方案:**
- 新增独立步骤类型下拉框 → 需要重构现有 UI 与保存逻辑，改动较大
- 用特殊 URL 或选择器约定触发答题 → 隐蔽、难维护

### 决策 2: 答案格式采用「每行一个答案」

用户可在文本域中粘贴答案，例如：
```
C
A
B
A,C
AB
```
执行时按行顺序对应页面题目顺序。

**替代方案:**
- JSON 数组输入 → 对非技术用户不友好
- 题目文本 → 答案映射 → 需要精确题目文本，且页面文本可能变化

### 决策 3: 选项匹配优先按选项字母前缀

页面选项通常呈现为 `A、加入参与无技术门槛`、`B、组织与目标融为一体` 等。执行脚本优先匹配文本以 `A、` / `B、` / `C、` 开头的选项；若匹配不到，再按完整答案文本做子串匹配。

多选答案支持以下写法：
- `A,B`
- `A B`
- `AB`

### 决策 4: 题目导航采用「索引 + 已答检测」双保险

每轮执行时：
1. 获取页面题目项列表：`.main .nav`
2. 跳过已答题：项内存在 `.uni-checkmarkempty` 图标（绿色对勾）
3. 点击第一个未答题项
4. 答案索引与未答题项顺序对应

**风险:** 如果页面未渲染全部题目（虚拟列表），需滚动加载；此版本先做「滚动到元素并点击」，若仍不可见则记录警告。

### 决策 5: 弹窗检测采用轮询可见性

答题点击题目后，题目弹窗异步出现。执行脚本会轮询以下任一条件成立：
- 弹窗容器 `.popup_content.learnanswer` 可见
- 选项 `.popup_content .option` 存在且可见
- 提交按钮 `.popup_content .button` 可见

提交后同样轮询弹窗消失或题目项出现已答标记。

### 决策 6: 复用现有 `runStepInWebContents` 加载与确认框流程

答题模式步骤仍然先由 `runStepInWebContents` 加载 URL，再进入 `answerQuiz`。`answerQuiz` 结束后返回，由外层统一调用 `handleConfirmBox` 处理可能的提交成功弹窗。

### 决策 7: 每个奖学金作为一个独立步骤

BlockCity 的答题页面 URL 带 `type` 参数：`type=1`（新人）、`type=2`（达人）、`type=3`（高人）、`type=4`（神人）。每个奖学金的题目数与答案相互独立，因此建议每个奖学金配置为一个步骤。这样：

- 任务可只执行部分奖学金
- 每个步骤的答案列表长度与页面题目数一一对应
- 避免在一个步骤内处理奖学金间跳转

### 决策 8: 最终成功弹窗用确认框选择器关闭

从截图可见，全部题目答完后会出现「恭喜你！已成功领取...」弹窗，按钮为「关闭」。该弹窗可通过步骤的 `confirm_selectors`（文本或类名 `.buttonBox` / `关闭`）统一关闭，无需在 `answerQuiz` 内部处理。

## 默认 DOM 选择器（基于截图）

| 目标 | 选择器 | 说明 |
|------|--------|------|
| 题目列表项 | `.main .nav` | 每道题对应一个 `uni-view.nav` |
| 已答题标记 | `.uni-checkmarkempty` | 题项内出现该图标即表示已答 |
| 题目弹窗 | `.popup_content.learnanswer` | 答题弹窗容器 |
| 选项 | `.popup_content .option` | 每个选项对应一个 `.option`；选中后带 `.on` |
| 选项文本 | `.popup_content .option .text.black span` | 文本形如 `B、区块城市` |
| 提交按钮 | `.popup_content .button` | 弹窗底部「提交」 |
| 成功弹窗关闭 | `.buttonBox` 或文本 `关闭` | 作为步骤的 `confirm_selectors` |

> 注意：页面使用 `uni-view` / `uni-text` 等自定义组件，选择器按 class 编写，不依赖 `data-v-*` 动态 hash，相对稳定。

## Risks / Trade-offs

- [Risk] 已答题检测（绿色对勾）依赖 `.uni-checkmarkempty` 类，若类名变化会导致跳过失败
- [Risk] 弹窗出现 / 消失时机不稳定，轮询逻辑需要足够鲁棒
- [Risk] 多选题目若页面要求按特定顺序点击选项，简单遍历点击可能失败（当前题库暂未观察到多选）
- [Risk] 页面若使用虚拟滚动，后期题目未渲染时点击会失败
- [Risk] 默认选择器基于当前页面结构，若平台后续改版需更新选择器覆盖配置

## 待用户提供的信息

1. ✅ 答案列表已提供（154 题，分 4 组）
2. ✅ DOM 选择器已从截图推断（见上表）
3. 是否希望答题步骤执行结束后自动关闭成功弹窗？（建议用 `confirm_selectors = .buttonBox` 或文本 `关闭`）
4. 是否希望重新执行时跳过已答题（绿色对勾）？
