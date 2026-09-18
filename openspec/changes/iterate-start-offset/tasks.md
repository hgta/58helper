## 1. UI 与数据模型

- [x] 1.1 在 `electron/renderer/index.html` 步骤编辑表单的「轮询间隔（秒）」上方新增输入框「从第几个元素开始轮询」，类型 `number`，`min="1"`，默认值 `1`
- [x] 1.2 配置该输入框仅在勾选「轮询页面所有相同元素」时显示，取消勾选时隐藏并清空
- [x] 1.3 在 `addStep()` / `editStep()` 中初始化/回填 `step-iterate-start-index` 字段
- [x] 1.4 在步骤保存逻辑中读取输入框，存入 `step.iterate_start_index`（空/非法时按 1 处理）

## 2. 执行引擎：原地轮询

- [x] 2.1 修改 `electron/main.js` 中的 `iterateInPlace`，扫描可见元素后解析 `iterate_start_index` 并计算 `skip = Math.max(0, startIndex - 1)`
- [x] 2.2 全局唯一计数模式：跳过可见元素时同步跳过 `dataset.iterateGlobalClicked` 标记，确保后续遍历从第 N 个未点击元素开始
- [x] 2.3 非全局模式：跳过可见元素时同步标记 `dataset.iterateClicked = '1'`，避免每个选择器从头计数被偏移影响
- [x] 2.4 当 `skip >= totalVisible` 时记录 `logger.warn` 并跳过本轮询
- [x] 2.5 保持日志 `轮询 [clickedCount/totalVisible]` 格式，实际点击序号从 1 开始

## 3. 执行引擎：裂变轮询

- [x] 3.1 修改 `electron/main.js` 中的 `runFanoutStep`，在扫描描述符列表后根据 `iterate_start_index` 截取子队列（前 `startIndex - 1` 个不进入处理队列）
- [x] 3.2 临时标签页按截取后的描述符列表逐个匹配并点击；主 tab 标记时同步跳过前 `startIndex - 1` 个元素
- [x] 3.3 当偏移超出可见元素总数时记录 warn 并退出轮询

## 4. 验证与交付

- [x] 4.1 运行 `openspec validate iterate-start-offset --strict` 通过
- [ ] 4.2 手动验证：设置起始偏移为 3，原地轮询从第 3 个元素开始点击，日志序号正确
- [ ] 4.3 手动验证：设置起始偏移大于元素总数时仅记录 warn，任务不中断
- [ ] 4.4 提交并推送到 GitHub
