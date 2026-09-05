---
change: batch-iterate-with-group-rest
design-doc: docs/superpowers/specs/2026-09-05-batch-iterate-with-group-rest-design.md
base-ref: 5d98d44d13e555a6bb6d01e68443c44d49b6a7cf
---

# 轮询分批 + 组间休息 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「轮询页面所有相同元素」模式新增分批节奏控制——每连续点击 N 个元素后额外休息 M 秒再继续下一组。

**Architecture:** 步骤 JSON 新增 `iterate_batch_size`(N, 默认10) 与 `iterate_batch_interval`(M, 默认60)。UI 在现有 `#iterate-interval-group` 容器内追加两个 number 输入框，随轮询勾选联动显示；`main.js` 轮询 `while` 循环复用已有 `clickedCount`，在元素间隔等待后追加组间休息。字段缺省/无效时不启用分批，旧行为零影响。

**Tech Stack:** Electron（主进程 + 渲染进程原生 JS/HTML），SQLite JSON 列，无新增依赖。

## Global Constraints

- 项目为 Electron 桌面应用，主入口 `npm start`。
- `steps` 为 JSON 存储在 `urls.steps` 列，步骤对象新增字段无需数据库迁移（`src/db/database.js`、`src/models/UrlModel.js` **不得改动**）。
- 旧步骤（无 `iterate_batch_size`/`iterate_batch_interval`）行为必须与现状完全一致。
- 组间休息仅在轮询模式（`iterate_all`）下、且 N/M 字段有效（N 正整数、M 正数）时启用。
- 分组计数按「每个按钮选择器」独立累计（`clickedCount` 位于 `for (const selector ...)` 内层）。
- 修改文件仅限：`electron/renderer/index.html`、`electron/main.js`。**不得改动** Web 端（`src/web/*`）与 `TaskScheduler`。
- 所有日志沿用现有 `logger.info` 与 `[Execute Task]` 前缀风格。
- 提交消息用英文（PowerShell 中文会乱码），遵循 Conventional Commits。

---

### Task 1: UI — 步骤编辑弹窗新增分批配置输入框

**Files:**
- Modify: `electron/renderer/index.html:752-755`（`#iterate-interval-group` 容器）
- Modify: `electron/renderer/index.html:1164-1166`（`addStep()` 清空）
- Modify: `electron/renderer/index.html:1178-1180`（`editStep()` 回填）
- Modify: `electron/renderer/index.html:1203-1206`（step-form submit 读取）
- Modify: `electron/renderer/index.html:1151`（`renderSteps()` 卡片标记）

**Interfaces:**
- Consumes: 无
- Produces: DOM `#step-iterate-batch-size`(number, 默认10)、`#step-iterate-batch-interval`(number, 默认60)；步骤对象字段 `iterate_batch_size: number`、`iterate_batch_interval: number`

> **执行中修订（review 轮，commit 7c84726）：** 分批字段改为「可选填」语义。HTML 输入框用 `placeholder="10"/"60"` 而非 `value`；`editStep()` 对无字段旧步骤回填空字符串；submit 仅当 `iterate_all` 且两字段均为有效正整数时才写入，否则步骤对象不含字段。详见 `tasks.md` §4。

- [x] **Step 1: 在 `#iterate-interval-group` 容器内追加两个输入框**

将 `electron/renderer/index.html:752-755` 现有块：

```html
                <div class="form-group" id="iterate-interval-group" style="display: none;">
                    <label>轮询间隔（秒）</label>
                    <input type="number" id="step-iterate-interval" value="10" min="1">
                </div>
```

替换为（在轮询间隔输入框后、div 闭合前插入两个 form-group）：

```html
                <div class="form-group" id="iterate-interval-group" style="display: none;">
                    <label>轮询间隔（秒）</label>
                    <input type="number" id="step-iterate-interval" value="10" min="1">
                    <label>每组连续点击数（个，可选填）</label>
                    <input type="number" id="step-iterate-batch-size" placeholder="10" min="1">
                    <label>组间休息（秒，可选填）</label>
                    <input type="number" id="step-iterate-batch-interval" placeholder="60" min="1">
                </div>
```

- [x] **Step 2: `addStep()` 清空新字段**

在 `electron/renderer/index.html` 的 `addStep()` 内、`step-iterate-interval` 重置行（约 L1165）后追加两行：

```js
            document.getElementById('step-iterate-batch-size').value = 10;
            document.getElementById('step-iterate-batch-interval').value = 60;
```

- [x] **Step 3: `editStep()` 回填新字段**

在 `electron/renderer/index.html` 的 `editStep()` 内、`step-iterate-interval` 回填行（约 L1179）后追加两行：

```js
            document.getElementById('step-iterate-batch-size').value = step.iterate_batch_size || '';
            document.getElementById('step-iterate-batch-interval').value = step.iterate_batch_interval || '';
```

- [x] **Step 4: step-form submit 读取新字段**

在 `electron/renderer/index.html:1204` 行（`iterate_interval` 读取）后追加两行，并把 L1206 的 step 对象扩展：

```js
            // 分批字段可选填：仅当已勾选轮询且两字段均填有效正整数才写入，否则不带字段
            const batchSize = parseInt(document.getElementById('step-iterate-batch-size').value, 10);
            const batchInterval = parseInt(document.getElementById('step-iterate-batch-interval').value, 10);
            const batchValid = iterate_all
                && Number.isInteger(batchSize) && batchSize > 0
                && Number.isInteger(batchInterval) && batchInterval > 0;

            const step = { url, button_selectors, confirm_selectors, iterate_all, iterate_interval };
            if (batchValid) {
                step.iterate_batch_size = batchSize;
                step.iterate_batch_interval = batchInterval;
            }
```

- [x] **Step 5: `renderSteps()` 卡片展示分批标记**

将 `electron/renderer/index.html:1151` 行的轮询标记片段：

```js
                        ${step.iterate_all ? ` | 🔁 轮询所有(间隔${step.iterate_interval || 10}s)` : ''}
```

替换为（旧步骤无 N/M 字段时仅显示原标记，不出现 `分批` 片段）：

```js
                        ${step.iterate_all ? ` | 🔁 轮询所有(间隔${step.iterate_interval || 10}s${step.iterate_batch_size ? `, 分批${step.iterate_batch_size}/休息${step.iterate_batch_interval || 60}s` : ''})` : ''}
```

- [x] **Step 6: 语法与界面自检 + 提交**

```bash
node --check electron/main.js
```

（此文件本任务未改，但验证脚本可整体跑通）实际校验方式：编辑弹窗目测不可自动执行，改为检查 HTML 结构闭合无误。提交：

```bash
git add electron/renderer/index.html
git commit -m "feat(ui): add batch size and group interval fields to step editor"
```

### Task 2: 执行逻辑 — 轮询循环追加组间休息

**Files:**
- Modify: `electron/main.js:430-520`（轮询分支），核心插入点 L432 之后（参数读取）与 L515-518 之后（组间休息）

**Interfaces:**
- Consumes: Task 1 产生的步骤字段 `step.iterate_batch_size`、`step.iterate_batch_interval`；已有 `clickedCount`（L460/L502）、`result.remaining`、`intervalSec`、`handleConfirmBox`、`logger`
- Produces: 无（纯执行行为）

- [x] **Step 1: 在轮询分支读取并校验分批参数**

在 `electron/main.js:432`（`const intervalSec = ...` 行）之后追加：

```js
                        // 分批节奏：每组连续点击 N 个后额外休息 M 秒（仅字段有效时启用）
                        const batchSize = Number(step.iterate_batch_size);
                        const batchIntervalSec = Number(step.iterate_batch_interval);
                        const batchEnabled = Number.isInteger(batchSize) && batchSize > 0
                            && Number.isFinite(batchIntervalSec) && batchIntervalSec > 0;
```

- [x] **Step 2: 元素间隔等待后追加组间休息**

在 `electron/main.js:515-518` 元素间隔等待块之后（即 `while` 循环体内该块闭合 `}` 之后、循环底部）追加：

```js
                                // 满一组且仍有剩余：先完成元素间隔等待，再额外组间休息
                                if (batchEnabled && result.remaining > 0 && clickedCount % batchSize === 0) {
                                    logger.info(`[Execute Task] 轮询: 已连续点击 ${batchSize} 个，组间休息 ${batchIntervalSec} 秒后继续...`);
                                    await new Promise(resolve => setTimeout(resolve, batchIntervalSec * 1000));
                                }
```

注意：该插入块必须与 L515 的 `if (result.remaining > 0 && intervalSec > 0) { ... }` 块平级（同为 `while` 内），位于其右花括号之后。

- [x] **Step 3: 语法校验 + 提交**

```bash
node --check electron/main.js
```

Expected: 无输出（通过），exit code 0。

```bash
git add electron/main.js
git commit -m "feat(exec): add group rest after each batch of N clicks in iterate mode"
```

### Task 3: 执行验证与回归

**Files:**
- 无源码改动（仅手动验证）

- [x] **Step 1: 静态检查**

```bash
node --check electron/main.js
node --check src/utils/logger.js
```

Expected: 均无输出，exit 0。

- [x] **Step 2: 执行路径代码走查**

人工复核 `main.js` 轮询分支最终形态，确认：
- `batchSize`/`batchIntervalSec`/`batchEnabled` 在 `if (step.iterate_all)` 块内、`for (const selector ...)` 循环之前声明（L432 附近），三个 selector 共享一组只读配置，无状态问题；
- `clickedCount` 仍位于 `for` 循环体内（L460）、`while` 外，每 selector 从 0 独立累计——这是「按 selector 分批」的机制保证，不得移动到 for 外。
- 组间休息块在 L515-518 块之后（同为 `while` 循环体内），逻辑上：第 N 次点击后 `remaining > 0` → 先等 I 再等 M。
- 末组不足 N：最后点击后 `remaining === 0` → 两等待块均跳过。
- `clickedCount % batchSize === 0` 在第 N、2N、3N… 次命中。

- [x] **Step 3: 运行时验证（手动/临时测试页）**

启动应用构造测试：25 个匹配元素的页面，配置 N=10、M=60、I=10，确认：
- 日志每满 10 个出现 `组间休息 60 秒后继续`；
- 第 10 与第 20 个点击后各休一次，末组 5 个点完即停；
- 每个元素点击后确认框被处理（如有配置）。

若无法启动 GUI，则将验证缩小为：代码走查 + 用一个小 Node 脚本模拟 `clickedCount % batchSize` 触发序列断言（10→休, 20→休, 25 结束），脚本可放临时文件并在验证后删除。

> 执行记录：GUI 无法自动启动，采用备选方案——临时 Node 脚本 `verify-batch-rest.js` 模拟 25 元素 N=10 触发序列，断言 10→休、20→休、25 结束无休，PASS 后删除脚本。

- [x] **Step 4: 回归验证**

- 直接编辑 SQLite/或临时构造步骤对象，令其无 `iterate_batch_size`/`iterate_batch_interval` 字段 → 执行日志无任何分批输出，行为与旧版一致。
- 字段为 `0`/空/NaN → 等同不分批。
- `iterate_all` 为假但字段存在 → 忽略字段，只点第一个元素。
- 勾选轮询但 UI 未填分批（默认 10/60）→ 保存后卡片显示 `分批10/休息60s`，编辑回填一致。

> 执行记录：GUI 手动路径不可自动执行，回归点以最终代码形态走查确认（`batchEnabled` 对 undefined/0/NaN 全禁、非轮询分支不进入、可选填 UI 语义）。GUI 目测项转由用户在应用内人工确认。

- [x] **Step 5: 完成确认**

`tasks.md` 勾选本 change 全部任务后提交状态文件（无源码改动则本任务不单独提交）。
