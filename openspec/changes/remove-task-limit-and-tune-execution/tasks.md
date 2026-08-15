## 1. 移除任务数量上限

- [x] 1.1 修改 `src/models/UrlModel.js` 的 `getAll()`，移除默认 `limit = 100`，改为仅当显式传入 `limit` 时才加 `LIMIT` 子句（默认返回全部）
- [x] 1.2 确认 `electron/main.js` 的 `url-get-all` 处理器调用 `UrlModel.getAll()` 时能返回全部任务
- [ ] 1.3 验证任务超过 100 个时列表能完整显示

## 2. 移除任务执行完成后的截图

- [x] 2.1 修改 `electron/main.js` 的 `execute-task` 处理器，删除截图代码块（`capturePage` + 写文件），记录历史时 `screenshot_path` 传 `null`
- [x] 2.2 修改 `electron/renderer/index.html` 的 `executeTask`，移除对 `result.screenshot` 的展示逻辑
- [x] 2.3 修改 `src/services/TaskScheduler.js` 的 `executeTask`，移除截图逻辑（保持 Web 端一致）
- [ ] 2.4 验证任务执行完成后不再生成截图文件

## 3. 测试验证

- [ ] 3.1 测试添加超过 100 个任务后列表完整显示
- [ ] 3.2 测试执行任务后 `logs/screenshots` 目录不再生成新截图
