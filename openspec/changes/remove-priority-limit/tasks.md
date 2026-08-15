## 1. 移除优先级上限

- [x] 1.1 修改 `electron/renderer/index.html`，删除 `task-priority` 输入框的 `max="100"` 属性（保留 `min="1"`）
- [x] 1.2 修改 `src/web/views/index.html`，删除 `priority-input` 输入框的 `max="100"` 属性（保持一致）

## 2. 测试验证

- [ ] 2.1 测试任务数超过 100 后，新增任务（优先级默认 101+）能正常保存
- [ ] 2.2 测试手动输入大于 100 的优先级能正常保存
- [ ] 2.3 测试优先级小于 1 时仍被 `min="1"` 拦截
