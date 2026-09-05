## ADDED Requirements

### Requirement: 轮询分批组间休息
系统在「轮询页面所有相同元素」执行时，SHALL 支持配置分组节奏：每连续点击 N 个元素后，在原有元素间隔之外额外休息 M 秒，再继续点击下一组；旧步骤配置缺失或字段无效时 MUST 保持原有行为（每元素间隔点击，不分批）。

#### Scenario: 满一组后执行组间休息
- **WHEN** 步骤配置了轮询（`iterate_all`）且 `iterate_batch_size = N`、`iterate_batch_interval = M`（N、M 均为正整数）
- **AND** 当前选择器已连续点击满 N 个元素且仍有未点击的可见元素
- **THEN** 系统等待该元素间隔后再额外等待 M 秒，然后继续点击下一组元素

#### Scenario: 最后一组不足 N 个或已全部点完
- **WHEN** 剩余未点击元素不足 N 个或已全部点击完毕
- **THEN** 系统不再执行组间休息 M 的等待，按原有元素间隔逻辑收尾

#### Scenario: 旧配置或无效字段保持原有行为
- **WHEN** 步骤对象不包含 `iterate_batch_size`/`iterate_batch_interval` 字段
- **OR** 两者任一为空、为 0 或非数值
- **THEN** 系统不进行分批，行为与未引入本能力前完全一致

#### Scenario: 未勾选轮询时字段不生效
- **WHEN** 步骤未勾选轮询（`iterate_all` 为假）
- **THEN** 即使步骤对象带 `iterate_batch_size`/`iterate_batch_interval` 字段，系统也忽略之并执行非轮询点击行为
