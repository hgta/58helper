## Why

当前任务管理系统存在两个用户体验问题：1) 创建任务时未检查名称重复，导致用户可能无意中创建重复任务；2) 批量执行任务时日志显示"执行：undefined"，影响调试和监控。这些问题需要修复以提升系统可靠性。

## What Changes

- **任务名称重复检查**：在创建和编辑任务时，检查任务名称是否已存在
  - 若名称重复，弹出确认对话框让用户选择是否继续
  - 对话框显示提示信息："任务名称'xxx'已存在，是否继续保存？"
- **修复日志显示bug**：修复批量执行时任务日志显示"执行：undefined"的问题
  - 确保日志正确显示任务名称而非undefined

## Capabilities

### New Capabilities
- `task-validation`: 任务数据验证能力，包括名称唯一性检查

### Modified Capabilities
<!-- 无现有能力需要修改 -->

## Impact

- **electron/renderer/index.html**: 修改任务创建/编辑逻辑，添加名称检查
- **electron/main.js**: 修复批量执行时的日志记录
- **src/models/UrlModel.js**: 可能需要添加按名称查询任务的方法
