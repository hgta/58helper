## ADDED Requirements

### Requirement: 轮询起始偏移
系统在「轮询页面所有相同元素」执行时，SHALL 支持配置起始元素偏移：用户可填写从第几个可见元素开始轮询，默认从第 1 个开始；执行引擎先跳过前 `startIndex - 1` 个可见元素，从第 `startIndex` 个开始点击；非法值、空值或缺失字段时按 1 处理。

#### Scenario: 从第 N 个元素开始轮询
- **WHEN** 轮询步骤配置 `iterate_start_index = N`（N 为大于 0 的整数）
- **THEN** 系统扫描可见元素后跳过前 `N - 1` 个
- **AND** 从第 N 个可见元素开始依次点击
- **AND** 日志中的点击序号从 1 开始计数，分母仍为总可见元素数

#### Scenario: 起始偏移同时支持原地轮询与裂变轮询
- **WHEN** 步骤启用轮询并配置 `iterate_start_index`
- **AND** 步骤未启用 `iterate_open_tabs`
- **THEN** 系统在原地轮询中按偏移跳过元素
- **AND** 当步骤启用 `iterate_open_tabs` 时，系统在裂变轮询的临时标签页中也按相同偏移处理

#### Scenario: 默认或非法值从第 1 个开始
- **WHEN** 步骤未包含 `iterate_start_index` 字段
- **OR** `iterate_start_index` 为空、0、负数或非整数
- **THEN** 系统按 1 处理，行为与未引入本能力前完全一致

#### Scenario: 起始偏移大于可见元素总数
- **WHEN** 步骤配置 `iterate_start_index` 大于总可见元素数
- **THEN** 系统记录警告日志并跳过本轮询，不中断任务

#### Scenario: 未勾选轮询时忽略起始偏移
- **WHEN** 步骤未启用轮询（`iterate_all` 为假）
- **THEN** 即使步骤对象带 `iterate_start_index` 字段，系统也忽略之
