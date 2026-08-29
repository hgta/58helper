---
change: iterate-all-elements-on-click
design-doc: openspec/changes/iterate-all-elements-on-click/design.md
base-ref: 14c151782d153888151cc60aadfadeb89c8ccf42
---

# 轮询点击所有匹配元素 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 步骤编辑界面新增「轮询页面所有相同元素」勾选框与间隔配置，执行时对按钮选择器匹配的所有元素依次点击，每个元素点击后处理确认框，间隔可配置（默认 10 秒）。

**Architecture:** 在 `electron/renderer/index.html` 步骤弹窗新增勾选框 `#step-iterate-all` 与间隔输入框 `#step-iterate-interval`，数据写入步骤 JSON 的 `iterate_all` / `iterate_interval` 字段（`urls.steps` 为 JSON 存储，无需迁移）。在 `electron/main.js` 的 `execute-task` 中，将确认框处理抽取为 `handleConfirmBox()` 复用；按钮点击块在 `step.iterate_all` 为真时进入轮询模式：每轮 `querySelectorAll` 重查、点击第一个「未处理且可见」元素、打 `dataset.iterateClicked` 标记，随后立即处理确认框，若还有剩余元素则等待 `iterate_interval` 秒后继续。

**Tech Stack:** Electron（主进程 + 渲染进程原生 JS/HTML），SQLite（JSON 列），无新增依赖。

## Global Constraints

- 项目为 Electron 桌面应用，主入口 `npm start`。
- `steps` 为 JSON 存储在 `urls.steps` 列，步骤对象新增字段无需数据库迁移（`src/db/database.js`、`src/models/UrlModel.js` **不得改动**）。
- 未勾选轮询时行为必须与现状完全一致（只点第一个匹配元素）。
- 轮询仅作用于**按钮选择器**；确认框选择器本身不轮询。
- 修改文件仅限：`electron/renderer/index.html`、`electron/main.js`。**不得改动** Web 端（`src/web/*`）与 `TaskScheduler`。
- 所有日志沿用现有 `logger.info/warn/debug` 与 `[Execute Task]` 前缀风格。
- 提交消息用英文（PowerShell 中文会乱码），遵循 Conventional Commits。

---

### Task 1: 步骤编辑界面新增轮询勾选框与间隔输入框

**Files:**
- Modify: `electron/renderer/index.html:694-697`（步骤弹窗按钮选择器下方）
- Modify: `electron/renderer/index.html:1038-1088`（`addStep`/`editStep`/`step-form` submit）
- Modify: `electron/renderer/index.html:1019-1035`（`renderSteps` 展示轮询标记）
- Modify: `electron/renderer/index.html:726-727`（`setupEventListeners` 绑定联动）

**Interfaces:**
- Consumes: 无（本任务不依赖其他任务）
- Produces: 步骤对象新增字段 `iterate_all: boolean`、`iterate_interval: number`；DOM 元素 `#step-iterate-all`（checkbox）、`#step-iterate-interval`（number input）、`#iterate-interval-group`（包裹输入框的 div）

- [ ] **Step 1: 在步骤弹窗新增勾选框与间隔输入框**

在 `electron/renderer/index.html` 第 694-697 行「按钮选择器」textarea 之后、「确认框按钮」之前，插入以下 HTML：

```html
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="step-iterate-all">
                        轮询页面所有相同元素
                    </label>
                </div>
                <div class="form-group" id="iterate-interval-group" style="display: none;">
                    <label>轮询间隔（秒）</label>
                    <input type="number" id="step-iterate-interval" value="10" min="1">
                </div>
```

- [ ] **Step 2: 绑定勾选联动显隐**

在 `setupEventListeners()` 函数内（`electron/renderer/index.html` 约第 726 行起）追加：

```js
            // 轮询勾选联动：勾选时显示间隔输入框
            document.getElementById('step-iterate-all').addEventListener('change', (e) => {
                document.getElementById('iterate-interval-group').style.display =
                    e.target.checked ? 'block' : 'none';
            });
```

- [ ] **Step 3: `addStep()` 清空新字段**

将 `addStep()`（约 1039-1046 行）改为：

```js
        // 添加步骤
        function addStep() {
            editingStepIndex = -1;
            document.getElementById('step-url').value = '';
            document.getElementById('step-selectors').value = '';
            document.getElementById('step-confirm-selectors').value = '';
            document.getElementById('step-iterate-all').checked = false;
            document.getElementById('step-iterate-interval').value = 10;
            document.getElementById('iterate-interval-group').style.display = 'none';
            document.getElementById('step-modal-title').textContent = '添加步骤';
            document.getElementById('step-modal').classList.add('show');
        }
```

- [ ] **Step 4: `editStep(index)` 回填新字段**

将 `editStep(index)`（约 1049-1057 行）改为：

```js
        // 编辑步骤
        function editStep(index) {
            editingStepIndex = index;
            const step = currentSteps[index];
            document.getElementById('step-url').value = step.url || '';
            document.getElementById('step-selectors').value = (step.button_selectors || []).join('\n');
            document.getElementById('step-confirm-selectors').value = (step.confirm_selectors || []).join('\n');
            document.getElementById('step-iterate-all').checked = !!step.iterate_all;
            document.getElementById('step-iterate-interval').value = step.iterate_interval || 10;
            document.getElementById('iterate-interval-group').style.display = step.iterate_all ? 'block' : 'none';
            document.getElementById('step-modal-title').textContent = '编辑步骤';
            document.getElementById('step-modal').classList.add('show');
        }
```

- [ ] **Step 5: `step-form` submit 读取新字段**

将 `step-form` submit 监听（约 1066-1088 行）中 `const step = { url, button_selectors, confirm_selectors };` 改为：

```js
            const iterate_all = document.getElementById('step-iterate-all').checked;
            const iterate_interval = parseInt(document.getElementById('step-iterate-interval').value, 10) || 10;

            const step = { url, button_selectors, confirm_selectors, iterate_all, iterate_interval };
```

- [ ] **Step 6: `renderSteps()` 展示轮询标记**

将 `renderSteps()`（约 1019-1035 行）中 `.step-selectors` div 末尾追加轮询标记。将：

```js
                    <div class="step-selectors">
                        ${step.button_selectors?.length ? '按钮: ' + step.button_selectors.join(', ') : ''}
                        ${step.confirm_selectors?.length ? ' | 确认: ' + step.confirm_selectors.join(', ') : ''}
                        ${!step.button_selectors?.length && !step.confirm_selectors?.length ? '无按钮操作' : ''}
                    </div>
```

改为：

```js
                    <div class="step-selectors">
                        ${step.button_selectors?.length ? '按钮: ' + step.button_selectors.join(', ') : ''}
                        ${step.confirm_selectors?.length ? ' | 确认: ' + step.confirm_selectors.join(', ') : ''}
                        ${!step.button_selectors?.length && !step.confirm_selectors?.length ? '无按钮操作' : ''}
                        ${step.iterate_all ? ` | 🔁 轮询所有(间隔${step.iterate_interval || 10}s)` : ''}
                    </div>
```

- [ ] **Step 7: 校验并提交**

运行 `node --check` 不适用于 HTML，改为确认无语法错误：渲染层为内联 JS，需启动应用手动确认。提交：

```bash
git add electron/renderer/index.html
git commit -m "feat(ui): add iterate-all checkbox and interval input to step editor"
```

---

### Task 2: 执行逻辑支持轮询点击所有匹配元素

**Files:**
- Modify: `electron/main.js:370-433`（`execute-task` 中按钮点击 + 确认框处理两块）

**Interfaces:**
- Consumes: Task 1 写入步骤对象的 `step.iterate_all: boolean`、`step.iterate_interval: number`（可能缺失/NaN，需容错）
- Produces: 独立函数 `handleConfirmBox(webContents, confirmSelectors) → Promise<boolean>`；按钮点击块轮询分支（使用 `browserView.webContents.executeJavaScript`）

- [ ] **Step 1: 抽取确认框处理为独立函数**

在 `electron/main.js` 中 `setupIpc` 函数（`execute-task` 所在函数）**之前**新增顶层函数：

```js
// 处理确认框：先按选择器查找，找不到则按文本匹配按钮，点击第一个可见的
async function handleConfirmBox(webContents, confirmSelectors) {
    if (!confirmSelectors || confirmSelectors.length === 0) return false;

    await new Promise(resolve => setTimeout(resolve, 1500));
    logger.info(`[Execute Task] 尝试点击确认框按钮: ${confirmSelectors.join(', ')}`);

    for (const selector of confirmSelectors) {
        try {
            const confirmClicked = await webContents.executeJavaScript(`
                (function() {
                    let el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                    if (!el || el.offsetParent === null) {
                        const buttons = document.querySelectorAll('button, [role="button"], .btn, input[type="button"], input[type="submit"]');
                        const targetText = '${selector.replace(/'/g, "\\'")}'.toLowerCase();
                        for (const btn of buttons) {
                            if (btn.innerText && btn.innerText.toLowerCase().includes(targetText)) {
                                el = btn;
                                break;
                            }
                        }
                    }
                    if (el && el.offsetParent !== null) {
                        el.click();
                        return true;
                    }
                    return false;
                })()
            `);
            if (confirmClicked) {
                logger.info(`[Execute Task] 确认框按钮点击成功: ${selector}`);
                await new Promise(resolve => setTimeout(resolve, 500));
                return true;
            }
        } catch (e) {
            logger.debug(`[Execute Task] 确认框选择器 ${selector} 失败: ${e.message}`);
        }
    }
    return false;
}
```

- [ ] **Step 2: 将原确认框处理块替换为函数调用**

将 `electron/main.js` 约 396-433 行的「处理确认框」整块替换为：

```js
                // 处理确认框
                await handleConfirmBox(browserView.webContents, step.confirm_selectors || []);
```

- [ ] **Step 3: 按钮点击块支持轮询模式**

将 `electron/main.js` 约 370-394 行的「点击按钮」整块替换为：

```js
                // 点击按钮
                const buttonSelectors = step.button_selectors || [];
                if (buttonSelectors.length > 0) {
                    if (step.iterate_all) {
                        // 轮询模式：依次点击所有匹配的可见元素，每个元素后处理确认框，间隔可配置（默认10秒）
                        const intervalSec = Number(step.iterate_interval) > 0 ? Number(step.iterate_interval) : 10;
                        logger.info(`[Execute Task] 轮询点击按钮: ${buttonSelectors.join(', ')}`);
                        for (const selector of buttonSelectors) {
                            while (true) {
                                const result = await browserView.webContents.executeJavaScript(`
                                    (function() {
                                        const els = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
                                        let clicked = false;
                                        for (const el of els) {
                                            if (el.dataset.iterateClicked === '1') continue;
                                            if (el.offsetParent === null) continue;
                                            el.dataset.iterateClicked = '1';
                                            el.click();
                                            clicked = true;
                                            break;
                                        }
                                        let remaining = 0;
                                        for (const el of els) {
                                            if (el.dataset.iterateClicked === '1') continue;
                                            if (el.offsetParent === null) continue;
                                            remaining++;
                                        }
                                        return { clicked, remaining };
                                    })()
                                `);
                                if (!result.clicked) break;
                                logger.info(`[Execute Task] 轮询点击成功: ${selector}（剩余 ${result.remaining} 个未点击）`);
                                // 每个元素点击后立即处理确认框
                                await handleConfirmBox(browserView.webContents, step.confirm_selectors || []);
                                // 还有剩余元素才等待间隔，最后一次点击后不额外等待
                                if (result.remaining > 0 && intervalSec > 0) {
                                    logger.info(`[Execute Task] 等待 ${intervalSec} 秒后点击下一个元素...`);
                                    await new Promise(resolve => setTimeout(resolve, intervalSec * 1000));
                                }
                            }
                        }
                    } else {
                        // 原逻辑：只点击第一个匹配元素
                        logger.info(`[Execute Task] 尝试点击按钮: ${buttonSelectors.join(', ')}`);
                        for (const selector of buttonSelectors) {
                            try {
                                const clicked = await browserView.webContents.executeJavaScript(`
                                    (function() {
                                        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                                        if (el && el.offsetParent !== null) {
                                            el.click();
                                            return true;
                                        }
                                        return false;
                                    })()
                                `);
                                if (clicked) {
                                    logger.info(`[Execute Task] 按钮点击成功: ${selector}`);
                                    break;
                                }
                            } catch (e) {
                                logger.debug(`[Execute Task] 选择器 ${selector} 失败: ${e.message}`);
                            }
                        }
                    }
                }
```

- [ ] **Step 4: 语法校验**

```bash
node --check electron/main.js
```

预期：无输出（exit code 0）。

- [ ] **Step 5: 提交**

```bash
git add electron/main.js
git commit -m "feat(exec): iterate and click all matching elements with interval"
```

---

### Task 3: 验证

**Files:**
- 无代码改动，仅验证

- [ ] **Step 1: 全量语法校验**

```bash
node --check electron/main.js
```

预期：exit code 0，无输出。

- [ ] **Step 2: 启动应用手动验证界面**

```bash
npm start
```

预期验证项：
1. 编辑步骤弹窗：按钮选择器下方出现「轮询页面所有相同元素」勾选框；勾选后出现「轮询间隔（秒）」输入框（默认 10），取消勾选后隐藏。
2. 保存步骤后，步骤卡片显示 `🔁 轮询所有(间隔10s)` 标记。
3. 再次编辑该步骤，勾选框与间隔值正确回填。
4. 未勾选轮询的步骤保存后无轮询标记，编辑时勾选框为未选中。

- [ ] **Step 3: 手动验证执行行为（可选，视页面场景）**

勾选轮询的任务在目标页面上执行，观察日志（`[Execute Task] 轮询点击成功: ...（剩余 N 个未点击）`）：多个匹配元素被依次点击、每个元素后确认框被处理、间隔为配置秒数、最后一个元素点击后无多余等待。

- [ ] **Step 4: 确认 openspec 任务全部勾选**

```bash
grep -c '\- \[ \]' openspec/changes/iterate-all-elements-on-click/tasks.md
```

预期输出 `0`。将 `openspec/changes/iterate-all-elements-on-click/tasks.md` 中所有 `[ ]` 勾选为 `[x]`（界面 5 项、执行 3 项、验证 4 项），然后提交：

```bash
git add openspec/changes/iterate-all-elements-on-click/tasks.md
git commit -m "docs: complete iterate-all-elements-on-click tasks"
```
