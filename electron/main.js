const { app, BrowserWindow, ipcMain, session, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const { getDatabase } = require('../src/db/database');
const UrlModel = require('../src/models/UrlModel');
const AccessHistoryModel = require('../src/models/AccessHistoryModel');
const logger = require('../src/utils/logger');
const { loggerEvents } = require('../src/utils/logger');
const { getScreenshotsDir, getLogsDir } = require('../src/utils/paths');
const { TaskControl } = require('./task-control');
const fs = require('fs');

let mainWindow;
const TabManager = require('./tab-manager');
const tabManager = new TabManager();

// 任务执行控制器：暂停 / 继续 / 停止（全局单例，同一时刻只允许一个任务在跑）
const taskControl = new TaskControl();

// 创建应用图标
function createAppIcon() {
    try {
        // 优先使用 PNG 图标（nativeImage 不支持 SVG）
        const pngPath = path.join(__dirname, 'assets/icon.png');
        if (fs.existsSync(pngPath)) {
            const icon = nativeImage.createFromPath(pngPath);
            if (!icon.isEmpty()) {
                return icon;
            }
        }
        const svgPath = path.join(__dirname, 'assets/icon.svg');
        if (fs.existsSync(svgPath)) {
            const icon = nativeImage.createFromPath(svgPath);
            if (!icon.isEmpty()) {
                return icon;
            }
        }
    } catch (e) {
        console.log('Icon load failed:', e.message);
    }
    return null;
}

// 创建主窗口
function createWindow() {
    const windowOptions = {
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        frame: false,
        backgroundColor: '#1a1a2e',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true
        }
    };
    
    const icon = createAppIcon();
    if (icon) {
        windowOptions.icon = icon;
    }
    
    mainWindow = new BrowserWindow(windowOptions);

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// 初始化浏览器标签页（主标签页）
function initBrowserTabs() {
    tabManager.attachTo(mainWindow);
    if (!tabManager.getMainTab()) {
        tabManager.createTab({ kind: 'main' });
    }
}

// 更新标签页视图位置
function updateBrowserViewBounds() {
    tabManager.updateBounds();
}

// 处理确认框：先按选择器查找，找不到则按文本匹配按钮，点击第一个可见的
async function handleConfirmBox(webContents, confirmSelectors, runId) {
    if (!confirmSelectors || confirmSelectors.length === 0) return false;

    await taskControl.wait(1500, runId);
    logger.info(`[Execute Task] 尝试点击确认框按钮: ${confirmSelectors.join(', ')}`);

    for (const selector of confirmSelectors) {
        try {
            const confirmClicked = await webContents.executeJavaScript(`
                (function() {
                    function isVisible(node) {
                        try {
                            const rect = node.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        } catch (e) {
                            return false;
                        }
                    }
                    let el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                    if (!el || !isVisible(el)) {
                        const buttons = document.querySelectorAll('button, [role="button"], .btn, input[type="button"], input[type="submit"]');
                        const targetText = '${selector.replace(/'/g, "\\'")}'.toLowerCase();
                        for (const btn of buttons) {
                            if (btn.innerText && btn.innerText.toLowerCase().includes(targetText) && isVisible(btn)) {
                                el = btn;
                                break;
                            }
                        }
                    }
                    if (el && isVisible(el)) {
                        el.click();
                        return true;
                    }
                    return false;
                })()
            `);
            if (confirmClicked) {
                logger.info(`[Execute Task] 确认框按钮点击成功: ${selector}`);
                await taskControl.wait(500, runId);
                return true;
            }
        } catch (e) {
            // 用户停止导致的终止需向上抛出，不能被当作普通失败吞掉
            if (e && e.aborted) throw e;
            logger.debug(`[Execute Task] 确认框选择器 ${selector} 失败: ${e.message}`);
        }
    }
    return false;
}

// ===== 步骤执行辅助（主标签页与裂变临时标签页共用） =====

// 原地轮询：在同一页面内逐个点击所有匹配的可见元素（现有行为，保持不变）
async function iterateInPlace(webContents, step, runId) {
    const intervalSec = Number(step.iterate_interval) > 0 ? Number(step.iterate_interval) : 10;
    // 分批节奏：每组连续点击 N 个后额外休息 M 秒（仅字段有效时启用）
    const batchSize = Number(step.iterate_batch_size);
    const batchIntervalSec = Number(step.iterate_batch_interval);
    const batchEnabled = Number.isInteger(batchSize) && batchSize > 0
        && Number.isFinite(batchIntervalSec) && batchIntervalSec > 0;

    for (const selector of step.button_selectors) {
        // 先统计该选择器的可见元素总数
        const initResult = await webContents.executeJavaScript(`
            (function() {
                function isVisible(node) {
                    try {
                        const rect = node.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    } catch (e) {
                        return false;
                    }
                }
                const els = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
                let visibleCount = 0;
                for (const el of els) {
                    if (isVisible(el)) visibleCount++;
                }
                return { total: els.length, visibleCount };
            })()
        `).catch(() => ({ total: 0, visibleCount: 0 }));
        if (!initResult || initResult.visibleCount === 0) {
            logger.info(`[Execute Task] 轮询: 选择器 ${selector} 无可见元素，跳过`);
            continue;
        }
        logger.info(`[Execute Task] 轮询: 选择器 ${selector} 共 ${initResult.visibleCount} 个可见元素，开始依次点击`);
        // 扫描完成后才知道真实元素数，补入进度总量（用于估算剩余耗时）
        taskControl.addProgressTotal(initResult.visibleCount, '轮询点击');

        let clickedCount = 0;
        while (true) {
            await taskControl.checkpoint(runId);
            const result = await webContents.executeJavaScript(`
                (function() {
                    function isVisible(node) {
                        try {
                            const rect = node.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        } catch (e) {
                            return false;
                        }
                    }
                    const els = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
                    let clicked = false;
                    let info = null;
                    for (const el of els) {
                        if (el.dataset.iterateClicked === '1') continue;
                        if (!isVisible(el)) continue;
                        el.dataset.iterateClicked = '1';
                        el.click();
                        clicked = true;
                        // 提取元素描述：文本 > aria-label > title > id > class > tag
                        const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 30);
                        info = {
                            tag: (el.tagName || '').toLowerCase(),
                            id: el.id || '',
                            cls: typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''),
                            text: text,
                            aria: el.getAttribute('aria-label') || '',
                            title: el.getAttribute('title') || ''
                        };
                        break;
                    }
                    let remaining = 0;
                    for (const el of els) {
                        if (el.dataset.iterateClicked === '1') continue;
                        if (isVisible(el)) remaining++;
                    }
                    return { clicked, remaining, info };
                })()
            `).catch(() => ({ clicked: false, remaining: 0, info: null }));
            if (!result.clicked) break;
            clickedCount++;
            // 进度 label 用「轮询 N/总数」格式，跟日志一致，方便用户对照
            taskControl.tickProgress(1, `轮询 ${clickedCount}/${initResult.visibleCount}`);

            // 构造元素描述
            let desc = '未知元素';
            if (result.info) {
                const i = result.info;
                desc = i.text || i.aria || i.title || (i.id ? '#' + i.id : '') || (i.cls ? '.' + i.cls.split(' ')[0] : '') || i.tag;
            }
            logger.info(`[Execute Task] 轮询 [${clickedCount}/${initResult.visibleCount}] 点击: ${selector} -> ${desc}（剩余 ${result.remaining} 个未点击）`);

            // 每个元素点击后立即处理确认框
            await handleConfirmBox(webContents, step.confirm_selectors || [], runId);
            // 还有剩余元素才等待间隔，最后一次点击后不额外等待
            if (result.remaining > 0 && intervalSec > 0) {
                logger.info(`[Execute Task] 轮询: 等待 ${intervalSec} 秒后点击下一个...`);
                await taskControl.wait(intervalSec * 1000, runId);
            }
            // 满一组且仍有剩余：先完成元素间隔等待，再额外组间休息
            if (batchEnabled && result.remaining > 0 && clickedCount % batchSize === 0) {
                logger.info(`[Execute Task] 轮询: 已连续点击 ${batchSize} 个，组间休息 ${batchIntervalSec} 秒后继续...`);
                await taskControl.wait(batchIntervalSec * 1000, runId);
            }
        }
    }
}

// 非轮询模式：只点击第一个匹配的可见元素
async function clickFirstMatch(webContents, step, runId) {
    logger.info(`[Execute Task] 尝试点击按钮: ${step.button_selectors.join(', ')}`);
    for (const selector of step.button_selectors) {
        await taskControl.checkpoint(runId);
        try {
            const clicked = await webContents.executeJavaScript(`
                (function() {
                    function isVisible(node) {
                        try {
                            const rect = node.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        } catch (e) {
                            return false;
                        }
                    }
                    const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                    if (el && isVisible(el)) {
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

// 在指定 webContents 上执行单个步骤：加载页面 → 稳定等待 → 点击/轮询 → 确认框
async function runStepInWebContents(webContents, step, runId) {
    await taskControl.checkpoint(runId);

    // 加载页面
    const loadPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('页面加载超时'));
        }, 60000);

        webContents.once('did-finish-load', () => {
            clearTimeout(timeout);
            resolve();
        });

        webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
            clearTimeout(timeout);
            reject(new Error(`页面加载失败: ${errorDescription}`));
        });

        webContents.loadURL(step.url);
    });

    try {
        // 被停止时可提前结束等待，无需等页面加载完
        await taskControl.abortable(loadPromise, runId);
    } catch (loadError) {
        if (loadError && loadError.aborted) throw loadError;
        logger.warn(`[Execute Task] 页面加载警告: ${loadError.message}`);
    }
    await taskControl.checkpoint(runId);

    // 等待页面稳定
    await taskControl.wait(3000, runId);
    logger.info(`[Execute Task] 页面加载完成: ${step.url}`);

    // 点击按钮
    const buttonSelectors = step.button_selectors || [];
    if (buttonSelectors.length > 0) {
        await taskControl.checkpoint(runId);
        if (step.iterate_all) {
            // 轮询模式（原地，不裂变——临时标签页内的后续步骤一律原地执行）
            logger.info(`[Execute Task] 轮询点击按钮: ${buttonSelectors.join(', ')}`);
            await iterateInPlace(webContents, step, runId);
        } else {
            await clickFirstMatch(webContents, step, runId);
        }
    }

    // 处理确认框
    await handleConfirmBox(webContents, step.confirm_selectors || [], runId);
}

// 裂变前等待：临时标签页的列表由 JS 异步渲染，固定等待容易在「列表还没渲染出来」时就去点击，
// 从而点到占位元素或错误元素。这里轮询可见元素数量，直到达到扫描时的数量、或连续多次稳定为止。
async function waitForListRendered(webContents, selectorLiteral, expected, runId) {
    const countScript = `
        (function() {
            function isVisible(node) {
                try {
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                } catch (e) {
                    return false;
                }
            }
            const els = document.querySelectorAll('${selectorLiteral}');
            let n = 0;
            for (const el of els) {
                if (isVisible(el)) n++;
            }
            return n;
        })()
    `;
    const deadline = Date.now() + 10000;
    let last = -1;
    let stable = 0;
    while (Date.now() < deadline) {
        if (webContents.isDestroyed()) return -1;
        const n = await webContents.executeJavaScript(countScript).catch(() => -1);
        if (n >= expected) return n;
        // 数量稳定（且非 0）说明渲染已结束，只是与扫描时不一致，不必干等到超时
        if (n > 0 && n === last) {
            stable++;
            if (stable >= 3) return n;
        } else {
            stable = 0;
        }
        last = n;
        await taskControl.wait(400, runId);
    }
    return last;
}

// 裂变模式：主标签页停在列表页做调度台（只扫描+标记），临时标签页逐元素
// 「加载列表页 → 点击第 k 个元素（跳转留在临时标签页内）→ 执行后续步骤」
async function runFanoutStep(mainWc, steps, stepIndex, runId) {
    const step = steps[stepIndex];
    const buttonSelectors = step.button_selectors || [];
    // 已知限制：裂变仅对第一个选择器生效（与原地模式的逐选择器轮询不同）
    const selector = buttonSelectors[0];
    if (!selector) return;

    await taskControl.checkpoint(runId);

    const intervalSec = Number(step.iterate_interval) > 0 ? Number(step.iterate_interval) : 10;
    const batchSize = Number(step.iterate_batch_size);
    const batchIntervalSec = Number(step.iterate_batch_interval);
    const batchEnabled = Number.isInteger(batchSize) && batchSize > 0
        && Number.isFinite(batchIntervalSec) && batchIntervalSec > 0;

    // 主标签页先加载列表页（作为调度台，SCAN 快照与 MARK 标记均在此页面进行）
    const mainLoadPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('页面加载超时'));
        }, 60000);

        mainWc.once('did-finish-load', () => {
            clearTimeout(timeout);
            resolve();
        });

        mainWc.once('did-fail-load', (event, errorCode, errorDescription) => {
            clearTimeout(timeout);
            reject(new Error(`页面加载失败: ${errorDescription}`));
        });

        mainWc.loadURL(step.url);
    });

    try {
        await taskControl.abortable(mainLoadPromise, runId);
    } catch (loadError) {
        if (loadError && loadError.aborted) throw loadError;
        logger.warn(`[Execute Task] 裂变: 列表页加载警告: ${loadError.message}`);
    }
    await taskControl.wait(3000, runId);

    // SCAN：主标签页（已加载列表页）快照可见元素的描述符，作为跨加载的元素身份
    const scanResult = await mainWc.executeJavaScript(`
        (function() {
            function isVisible(node) {
                try {
                    const rect = node.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                } catch (e) {
                    return false;
                }
            }
            const els = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
            const items = [];
            let visibleIndex = 0;
            for (const el of els) {
                if (!isVisible(el)) continue;
                const a = el.closest('a');
                const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
                items.push({
                    index: visibleIndex++,
                    text: text.slice(0, 60),
                    href: a ? (a.href || '') : (el.href || ''),
                    aria: el.getAttribute('aria-label') || '',
                    title: el.getAttribute('title') || ''
                });
            }
            return items;
        })()
    `).catch(() => []);
    const descriptors = Array.isArray(scanResult) ? scanResult : [];
    if (descriptors.length === 0) {
        logger.info(`[Execute Task] 裂变: 选择器 ${selector} 无可见元素，跳过`);
        return;
    }
    logger.info(`[Execute Task] 裂变: 选择器 ${selector} 共 ${descriptors.length} 个可见元素，新标签页逐元素执行`);
    // 扫描完成后才知道真实元素数，补入进度总量（用于估算剩余耗时）
    taskControl.addProgressTotal(descriptors.length, '裂变元素');

    // 创建临时标签页（元素间复用，全部完成后关闭）
    let tempTabId = tabManager.createTab({ kind: 'temp' });
    tabManager.setTabTitle(tempTabId, `裂变 0/${descriptors.length}`);

    try {
        for (let k = 0; k < descriptors.length; k++) {
            await taskControl.checkpoint(runId);
            const desc = descriptors[k];

            // 临时标签页可能被用户手动关闭：关闭则重建，继续下一个元素
            let tempTab = tabManager.getTab(tempTabId);
            if (!tempTab || tempTab.view.webContents.isDestroyed()) {
                tempTabId = tabManager.createTab({ kind: 'temp' });
                tempTab = tabManager.getTab(tempTabId);
                logger.warn(`[Execute Task] 裂变: 临时标签页已被关闭，重建后继续元素 ${k + 1}/${descriptors.length}`);
            }
            const tempWc = tempTab.view.webContents;
            tabManager.activate(tempTabId);
            tabManager.setTabTitle(tempTabId, `裂变 ${k + 1}/${descriptors.length}`);

            // LOAD：临时标签页加载列表页
            const loadPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('页面加载超时'));
                }, 60000);

                tempWc.once('did-finish-load', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                tempWc.once('did-fail-load', (event, errorCode, errorDescription) => {
                    clearTimeout(timeout);
                    reject(new Error(`页面加载失败: ${errorDescription}`));
                });

                tempWc.loadURL(step.url);
            });

            try {
                await taskControl.abortable(loadPromise, runId);
            } catch (loadError) {
                if (loadError && loadError.aborted) throw loadError;
                logger.warn(`[Execute Task] 裂变 [${k + 1}/${descriptors.length}] 列表页加载警告: ${loadError.message}，跳过该元素`);
                taskControl.tickProgress(1, `裂变 ${k + 1}/${descriptors.length}`);
                continue;
            }
            await taskControl.wait(3000, runId);

            // 列表页由 JS 异步渲染，固定等待可能落在「列表还没渲染完」的时刻，从而点到占位/错误元素
            const selectorLiteral = selector.replace(/'/g, "\\'");
            const renderedCount = await waitForListRendered(tempWc, selectorLiteral, descriptors.length, runId);
            if (renderedCount < descriptors.length) {
                logger.warn(`[Execute Task] 裂变 [${k + 1}/${descriptors.length}] 列表只渲染出 ${renderedCount} 个可见元素（扫描时为 ${descriptors.length} 个），可能点到错误元素`);
            }

            const urlBefore = tempWc.isDestroyed() ? '' : tempWc.getURL();

            // CLICK：描述符（文本+href）优先匹配，可见顺序索引兜底
            // 关键：必须点「可点击元素」本身（优先 <a>），而不是 .loginBox 这类容器——
            // 容器自身没有跳转行为，对容器 click() 只会日志显示已点击、页面却毫无反应。
            const clickResult = await tempWc.executeJavaScript(`
                (function() {
                    function isVisible(node) {
                        try {
                            const rect = node.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        } catch (e) {
                            return false;
                        }
                    }
                    function normalize(t) {
                        return (t || '').trim().replace(/\\s+/g, ' ');
                    }
                    function hrefOf(el) {
                        const a = el.closest('a');
                        return a ? (a.href || '') : (el.getAttribute('href') || '');
                    }
                    // 子树里找「无 element 子节点、文本等于 targetText」的最深叶子——
                    // 解决 uni-app 等事件代理场景：外层容器（如 .loginBox）没有 @click，
                    // handler 挂在内部更深的元素（<uni-text>/<span>）上，必须下钻才能触发。
                    function findDeepestTextMatch(root, targetText) {
                        function dfs(node) {
                            let deepest = null;
                            for (const child of node.children) {
                                const d = dfs(child);
                                if (d) deepest = d;
                            }
                            if (node.children.length === 0) {
                                const t = normalize(node.textContent || '');
                                if (t === targetText) return node;
                            }
                            return deepest;
                        }
                        return dfs(root);
                    }
                    const desc = ${JSON.stringify(desc)};
                    const els = document.querySelectorAll('${selectorLiteral}');
                    const visible = [];
                    for (const el of els) {
                        if (isVisible(el)) visible.push(el);
                    }
                    // 1) 文本 + href 精确匹配；文本重复时取可见序号最接近扫描记录的，
                    //    避免永远命中列表里第一个同名元素（例如多个「登录」）
                    let targetIndex = -1;
                    let by = '';
                    let bestDist = Infinity;
                    for (let i = 0; i < visible.length; i++) {
                        const el = visible[i];
                        const text = normalize(el.innerText || el.textContent);
                        if (!desc.text || text !== desc.text) continue;
                        if (desc.href) {
                            const href = hrefOf(el);
                            if (href && href !== desc.href) continue;
                        }
                        const dist = Math.abs(i - desc.index);
                        if (dist < bestDist) {
                            bestDist = dist;
                            targetIndex = i;
                            by = 'desc';
                        }
                    }
                    // 2) 兜底：按可见序号取
                    if (targetIndex < 0 && desc.index < visible.length) {
                        targetIndex = desc.index;
                        by = 'index';
                    }
                    if (targetIndex < 0) return { clicked: false, visibleCount: visible.length };
                    const el = visible[targetIndex];
                    // 选择真正可点击的目标：
                    //   1) 自身或祖先 <a>（href 导航场景）
                    //   2) 子代 <a>
                    //   3) 子树里最深、文本等于 desc.text 的叶子（uni-app 事件代理，handler 挂在内部元素上）
                    //   4) 兜底：元素自身
                    let clickable = null;
                    let clickReason = '';
                    if (el.tagName === 'A') {
                        clickable = el; clickReason = 'self-anchor';
                    } else {
                        const ancA = el.closest('a');
                        if (ancA) { clickable = ancA; clickReason = 'ancestor-anchor'; }
                        else {
                            const descA = el.querySelector('a');
                            if (descA) { clickable = descA; clickReason = 'descendant-anchor'; }
                            else if (desc.text) {
                                const deepest = findDeepestTextMatch(el, desc.text);
                                if (deepest) { clickable = deepest; clickReason = 'deepest-text-match'; }
                                else { clickable = el; clickReason = 'self'; }
                            } else {
                                clickable = el; clickReason = 'self';
                            }
                        }
                    }
                    const info = {
                        clicked: true,
                        by: by,
                        index: targetIndex,
                        descIndex: desc.index,
                        clickTag: clickable.tagName,
                        clickReason: clickReason,
                        text: normalize(el.innerText || el.textContent).slice(0, 30),
                        href: hrefOf(el),
                        visibleCount: visible.length
                    };
                    clickable.click();
                    return info;
                })()
            `).catch(() => ({ clicked: false, visibleCount: 0 }));
            if (!clickResult || !clickResult.clicked) {
                logger.warn(`[Execute Task] 裂变 [${k + 1}/${descriptors.length}] 未匹配到元素（列表可能已变化），跳过`);
                taskControl.tickProgress(1, `裂变 ${k + 1}/${descriptors.length}`);
                continue;
            }
            logger.info(`[Execute Task] 裂变 [${k + 1}/${descriptors.length}] 点击元素(${clickResult.by}): 第${clickResult.index}个 <${clickResult.clickTag}>${clickResult.clickReason ? ' [' + clickResult.clickReason + ']' : ''} ${clickResult.text || '未知元素'}${clickResult.href ? ' -> ' + clickResult.href : ''}`);

            // 校验点击是否真的生效（同标签页内跳转）；未跳转时打印诊断，便于定位「日志说点了但页面没动」
            let navigated = !tempWc.isDestroyed() && tempWc.getURL() !== urlBefore;
            for (let t = 0; !navigated && t < 7; t++) {
                await taskControl.wait(300, runId);
                if (tempWc.isDestroyed()) break;
                if (tempWc.getURL() !== urlBefore) navigated = true;
            }
            if (!navigated && !tempWc.isDestroyed()) {
                logger.warn(`[Execute Task] 裂变 [${k + 1}/${descriptors.length}] 点击后页面未跳转（仍停留在 ${urlBefore}）`
                    + `；扫描时该元素为第 ${clickResult.descIndex} 个「${desc.text || '无文本'}」，本次实际点了第 ${clickResult.index} 个 <${clickResult.clickTag}>${clickResult.clickReason ? ' [' + clickResult.clickReason + ']' : ''}>`);
            }

            // CONFIRM：本步骤的确认框在临时标签页内处理
            await handleConfirmBox(tempWc, step.confirm_selectors || [], runId);

            // SUBSTEP：后续步骤在临时标签页内顺序执行（不再裂变）
            for (let j = stepIndex + 1; j < steps.length; j++) {
                logger.info(`[Execute Task] 裂变 [${k + 1}] 执行后续步骤 ${j + 1}/${steps.length}: ${steps[j].url}`);
                try {
                    await runStepInWebContents(tempWc, steps[j], runId);
                } catch (subError) {
                    // 用户停止导致的终止需向上抛出，不能当成普通异常跳过
                    if (subError && subError.aborted) throw subError;
                    logger.warn(`[Execute Task] 裂变 [${k + 1}] 后续步骤 ${j + 1} 异常: ${subError.message}，跳过该元素`);
                    break;
                }
                if (j < steps.length - 1) {
                    await taskControl.wait(2000, runId);
                }
            }

            // MARK：主标签页标记第 k 个可见元素为已完成（纯视觉进度提示）
            await mainWc.executeJavaScript(`
                (function() {
                    function isVisible(node) {
                        try {
                            const rect = node.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        } catch (e) {
                            return false;
                        }
                    }
                    const els = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
                    let n = 0;
                    for (const el of els) {
                        if (!isVisible(el)) continue;
                        if (n === ${k}) {
                            el.dataset.iterateDone = '1';
                            el.style.outline = '2px solid #4caf50';
                            el.style.outlineOffset = '2px';
                            el.style.opacity = '0.55';
                            return true;
                        }
                        n++;
                    }
                    return false;
                })()
            `).catch(() => {});

            // REST：元素间隔 / 组间休息（语义与原地模式一致）
            if (k < descriptors.length - 1 && intervalSec > 0) {
                logger.info(`[Execute Task] 裂变: 等待 ${intervalSec} 秒后处理下一个元素...`);
                await taskControl.wait(intervalSec * 1000, runId);
            }
            if (batchEnabled && k < descriptors.length - 1 && (k + 1) % batchSize === 0) {
                logger.info(`[Execute Task] 裂变: 已连续处理 ${batchSize} 个，组间休息 ${batchIntervalSec} 秒后继续...`);
                await taskControl.wait(batchIntervalSec * 1000, runId);
            }

            // 该元素（含其后的间隔）已处理完，计入进度
            taskControl.tickProgress(1, `裂变 ${k + 1}/${descriptors.length}`);
        }
    } finally {
        // CLOSE：关闭临时标签页并激活主标签页
        tabManager.closeTab(tempTabId);
        const mainTab = tabManager.getMainTab();
        if (mainTab) tabManager.activate(mainTab.id);
        if (taskControl.isStopped(runId)) {
            logger.info(`[Execute Task] 裂变: 任务已停止，关闭临时标签页`);
        } else {
            logger.info(`[Execute Task] 裂变: 全部 ${descriptors.length} 个元素处理完毕`);
        }
    }
}

// ===== 任务耗时记录（用于「上次耗时 / 平均耗时」预估） =====

/** 毫秒 → 可读时长（1:02:33 / 02:33） */
function formatDuration(ms) {
    const totalSec = Math.max(0, Math.round(Number(ms) / 1000) || 0);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const TASK_DURATION_PREFIX = 'task_duration_';

/** 记录一次成功执行的耗时（存 config 表，无需改表结构） */
async function recordTaskDuration(taskId, durationMs) {
    try {
        if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
        const db = await getDatabase();
        const key = `${TASK_DURATION_PREFIX}${taskId}`;
        const raw = await db.getConfig(key);

        let stat = { last: 0, avg: 0, count: 0, updatedAt: null };
        if (raw) {
            try { stat = { ...stat, ...JSON.parse(raw) }; } catch (e) { /* 旧数据格式异常则重置 */ }
        }

        const count = Number(stat.count) || 0;
        const prevAvg = Number(stat.avg) || 0;
        stat.last = Math.round(durationMs);
        stat.avg = count > 0 ? Math.round((prevAvg * count + durationMs) / (count + 1)) : stat.last;
        stat.count = count + 1;
        stat.updatedAt = new Date().toISOString();

        await db.setConfig(key, JSON.stringify(stat));
        return stat;
    } catch (error) {
        logger.warn(`[Execute Task] 记录任务耗时失败: ${error.message}`);
        return null;
    }
}

/** 读取所有任务的耗时统计：{ [taskId]: { last, avg, count } } */
async function getTaskDurations() {
    try {
        const db = await getDatabase();
        const rows = await db.all(`SELECT key, value FROM config WHERE key LIKE '${TASK_DURATION_PREFIX}%'`);
        const map = {};
        for (const row of rows) {
            const id = String(row.key).slice(TASK_DURATION_PREFIX.length);
            try { map[id] = JSON.parse(row.value); } catch (e) { /* 忽略脏数据 */ }
        }
        return map;
    } catch (error) {
        logger.warn(`[Execute Task] 读取任务耗时失败: ${error.message}`);
        return {};
    }
}

/** 删除任务时一并清理耗时记录 */
async function removeTaskDuration(taskId) {
    try {
        const db = await getDatabase();
        await db.run(`DELETE FROM config WHERE key = ?`, [`${TASK_DURATION_PREFIX}${taskId}`]);
    } catch (error) {
        logger.warn(`[Execute Task] 清理任务耗时失败: ${error.message}`);
    }
}

// IPC 处理
function setupIpc() {
    // 日志实时推送到 UI 日志面板（logger.js 的 RendererTransport 发出事件）
    loggerEvents.on('log', (entry) => {
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('log-message', entry);
        }
    });

    // 任务控制状态（idle/running/paused/stopping）实时推送到渲染层
    taskControl.on('status', (state) => {
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('task-status', state);
        }
    });

    // 模态框显示时隐藏/恢复所有标签页视图
    ipcMain.on('modal-show', () => {
        tabManager.setTabsHidden(true);
    });
    
    ipcMain.on('modal-hide', () => {
        tabManager.setTabsHidden(false);
        updateBrowserViewBounds();
        // 确保主窗口获得焦点
        if (mainWindow) {
            mainWindow.focus();
        }
    });
    
    // 窗口控制
    ipcMain.on('window-minimize', () => mainWindow.minimize());
    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    });
    ipcMain.on('window-close', () => mainWindow.close());

    // 浏览器控制（作用于当前激活标签页）
    ipcMain.handle('browser-navigate', async (event, url) => {
        const wc = tabManager.getActiveWebContents();
        if (!wc) return { success: false, error: 'No active tab' };
        wc.loadURL(url).catch(() => {});
        return { success: true };
    });

    ipcMain.handle('browser-back', () => {
        const wc = tabManager.getActiveWebContents();
        if (wc && wc.canGoBack()) {
            wc.goBack();
        }
    });

    ipcMain.handle('browser-forward', () => {
        const wc = tabManager.getActiveWebContents();
        if (wc && wc.canGoForward()) {
            wc.goForward();
        }
    });

    ipcMain.handle('browser-refresh', () => {
        const wc = tabManager.getActiveWebContents();
        if (wc) wc.reload();
    });

    ipcMain.handle('browser-get-url', () => {
        const wc = tabManager.getActiveWebContents();
        return wc ? wc.getURL() : '';
    });

    ipcMain.handle('browser-get-title', () => {
        const wc = tabManager.getActiveWebContents();
        return wc ? wc.getTitle() : '';
    });

    ipcMain.handle('browser-execute-script', async (event, script) => {
        const wc = tabManager.getActiveWebContents();
        if (!wc) return { success: false, error: 'No active tab' };
        try {
            const result = await wc.executeJavaScript(script);
            return { success: true, result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('browser-click-element', async (event, selector) => {
        const wc = tabManager.getActiveWebContents();
        if (!wc) return { success: false, error: 'No active tab' };
        try {
            await wc.executeJavaScript(`
                (function() {
                    const el = document.querySelector('${selector}');
                    if (el) {
                        el.click();
                        return true;
                    }
                    return false;
                })()
            `);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('browser-screenshot', async () => {
        const wc = tabManager.getActiveWebContents();
        if (!wc) return { success: false, error: 'No active tab' };
        try {
            const image = await wc.capturePage();
            const screenshotPath = path.join(getScreenshotsDir(), `screenshot-${Date.now()}.png`);
            fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
            fs.writeFileSync(screenshotPath, image.toPNG());
            return { success: true, path: screenshotPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 导出日志：把 winston 日志文件整理为可读文本，弹出保存对话框
    ipcMain.handle('logs-export', async (event, uiLogText) => {
        try {
            const logsDir = getLogsDir();

            // 把 winston 的 JSON 行日志转成 "时间 [级别] 内容" 可读格式
            const formatLogFile = (filePath) => {
                if (!fs.existsSync(filePath)) return '';
                const raw = fs.readFileSync(filePath, 'utf8');
                return raw.split(/\r?\n/).filter(Boolean).map((line) => {
                    try {
                        const o = JSON.parse(line);
                        const ts = o.timestamp || '';
                        const lvl = String(o.level || 'info').toUpperCase().padEnd(5, ' ');
                        const msg = typeof o.message === 'string' ? o.message : JSON.stringify(o.message);
                        return `${ts} [${lvl}] ${msg}`;
                    } catch (e) {
                        return line;
                    }
                }).join('\n');
            };

            const parts = [
                '# 58helper 日志导出',
                `# 导出时间: ${new Date().toLocaleString()}`,
                `# 应用版本: ${app.getVersion()}`,
                `# 日志目录: ${logsDir}`,
                ''
            ];

            // 界面上正在显示的日志（实时、无文件缓冲延迟），放在最前面便于快速定位
            const uiText = typeof uiLogText === 'string' ? uiLogText.trim() : '';
            parts.push('===== 界面日志（当前会话） =====');
            parts.push(uiText || '(空)');
            parts.push('');
            parts.push('===== combined.log（全部日志） =====');
            parts.push(formatLogFile(path.join(logsDir, 'combined.log')) || '(空)');
            parts.push('');
            parts.push('===== error.log（错误日志） =====');
            parts.push(formatLogFile(path.join(logsDir, 'error.log')) || '(空)');
            parts.push('');

            const logs = parts.join('\n');

            const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const defaultName = `58helper-logs-${stamp}.txt`;

            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                title: '导出日志',
                defaultPath: path.join(app.getPath('downloads'), defaultName),
                filters: [
                    { name: '文本文件', extensions: ['txt'] },
                    { name: '所有文件', extensions: ['*'] }
                ]
            });
            if (canceled || !filePath) {
                return { success: false, canceled: true };
            }

            fs.writeFileSync(filePath, logs, 'utf8');
            logger.info(`[Logs] 日志已导出: ${filePath}`);
            return { success: true, path: filePath, size: Buffer.byteLength(logs, 'utf8') };
        } catch (error) {
            logger.error(`[Logs] 导出日志失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    // 打开日志所在目录
    ipcMain.handle('logs-open-dir', async () => {
        try {
            const logsDir = getLogsDir();
            await shell.openPath(logsDir);
            return { success: true, path: logsDir };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 缩放控制（作用于当前激活标签页）
    ipcMain.handle('browser-set-zoom', async (event, zoomLevel) => {
        const wc = tabManager.getActiveWebContents();
        if (!wc) return { success: false, error: 'No active tab' };
        try {
            await wc.setZoomFactor(zoomLevel);
            return { success: true, zoomLevel };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('browser-get-zoom', async () => {
        const wc = tabManager.getActiveWebContents();
        if (!wc) return { success: false, error: 'No active tab' };
        try {
            const zoomLevel = await wc.getZoomFactor();
            return { success: true, zoomLevel };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 标签页控制
    ipcMain.handle('tab-activate', (event, id) => {
        return { success: tabManager.activate(id) };
    });

    ipcMain.handle('tab-close', (event, id) => {
        const result = tabManager.closeTab(id);
        if (!result.success) {
            logger.warn(`[TabManager] 关闭标签页失败: ${result.error}`);
        }
        return result;
    });

    ipcMain.handle('tab-get-all', () => {
        return { success: true, ...tabManager.getState() };
    });

    // URL管理
    ipcMain.handle('url-get-all', async () => {
        try {
            const urls = await UrlModel.getAll();
            return { success: true, data: urls };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('url-create', async (event, data) => {
        try {
            const url = await UrlModel.create(data);
            return { success: true, data: url };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('url-update', async (event, id, data) => {
        try {
            const url = await UrlModel.update(id, data);
            return { success: true, data: url };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('url-delete', async (event, id) => {
        try {
            await UrlModel.delete(id);
            await removeTaskDuration(id);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('url-toggle', async (event, id) => {
        try {
            const url = await UrlModel.getById(id);
            if (!url) return { success: false, error: 'Not found' };
            const updated = await UrlModel.update(id, { enabled: !url.enabled });
            return { success: true, data: updated };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 检查任务名称是否已存在
    ipcMain.handle('check-task-name', async (event, name, excludeId = null) => {
        try {
            const existing = await UrlModel.getByName(name);
            if (existing) {
                // 如果是编辑模式且找到的是当前任务，则不视为重复
                if (excludeId && existing.id === excludeId) {
                    return { success: true, exists: false };
                }
                return { success: true, exists: true, task: existing };
            }
            return { success: true, exists: false };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 访问历史
    ipcMain.handle('history-get-today', async () => {
        try {
            const history = await AccessHistoryModel.getToday();
            return { success: true, data: history };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('history-create', async (event, data) => {
        try {
            const history = await AccessHistoryModel.create(data);
            return { success: true, data: history };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 统计信息
    ipcMain.handle('get-stats', async () => {
        try {
            const urls = await UrlModel.getAll();
            const history = await AccessHistoryModel.getToday();
            return {
                success: true,
                data: {
                    totalUrls: urls.length,
                    enabledUrls: urls.filter(u => u.enabled).length,
                    todayExecutions: history.length,
                    todaySuccess: history.filter(h => h.success).length
                }
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 任务执行控制：暂停
    ipcMain.handle('task-pause', () => {
        const ok = taskControl.pause();
        if (ok) logger.info('[Execute Task] 任务已暂停，等待继续...');
        return { success: ok, state: taskControl.getState() };
    });

    // 任务执行控制：继续
    ipcMain.handle('task-resume', () => {
        const ok = taskControl.resume();
        if (ok) logger.info('[Execute Task] 任务已继续执行');
        return { success: ok, state: taskControl.getState() };
    });

    // 任务执行控制：停止
    ipcMain.handle('task-stop', () => {
        const result = taskControl.stop();
        if (result) {
            logger.warn('[Execute Task] 收到停止请求，正在中断任务...');
        }
        return { success: !!result, state: taskControl.getState() };
    });

    // 查询当前任务控制状态（渲染层刷新时同步按钮状态）
    ipcMain.handle('task-control-state', () => {
        return { success: true, state: taskControl.getState() };
    });

    // 各任务的历史耗时（上次 / 平均），用于执行前预估
    ipcMain.handle('task-durations-get', async () => {
        const data = await getTaskDurations();
        return { success: true, data };
    });

    // 执行任务
    ipcMain.handle('execute-task', async (event, taskId) => {
        let runId = null;
        try {
            const task = await UrlModel.getById(taskId);
            if (!task) return { success: false, error: 'Task not found' };

            const steps = task.steps || [];
            if (steps.length === 0) {
                return { success: false, error: 'No steps configured' };
            }

            // 同一时刻只允许一个任务在执行（暂停中同样视为占用）
            if (taskControl.status !== 'idle') {
                logger.warn('[Execute Task] 已有任务在执行中，忽略本次请求');
                return { success: false, error: '已有任务在执行中' };
            }

            // 开始本轮任务（返回 runId，用于隔离新旧任务）
            runId = taskControl.begin();
            logger.info(`[Execute Task] 开始执行任务: ${task.name || taskId}, 共 ${steps.length} 个步骤`);

            // 进度基数：每个「非轮询」步骤都要独立执行一次；
            // 轮询/裂变步骤的元素数量在扫描完成后由执行函数补入
            const baseUnits = steps.filter(s => !s.iterate_all).length;
            taskControl.addProgressTotal(baseUnits, '准备中');

            initBrowserTabs();
            const mainTab = tabManager.getMainTab();
            if (mainTab) tabManager.activate(mainTab.id);
            const mainWc = tabManager.getMainWebContents();
            if (!mainWc) throw new Error('No main tab');

            // 遍历执行每个步骤
            for (let i = 0; i < steps.length; i++) {
                await taskControl.checkpoint(runId);
                const step = steps[i];
                logger.info(`[Execute Task] 执行步骤 ${i + 1}/${steps.length}: ${step.url}`);

                // 裂变模式：轮询 + iterate_open_tabs + 非最后一步 → 临时标签页逐元素执行后续步骤
                const fanout = step.iterate_all
                    && step.iterate_open_tabs === true
                    && i < steps.length - 1;

                if (fanout) {
                    await runFanoutStep(mainWc, steps, i, runId);
                } else {
                    try {
                        await runStepInWebContents(mainWc, step, runId);
                    } finally {
                        // 轮询步骤的元素在 iterateInPlace 内逐个计数，这里只处理普通步骤
                        if (!step.iterate_all && !taskControl.isStopped(runId)) {
                            taskControl.tickProgress(1, `步骤 ${i + 1}/${steps.length}`);
                        }
                    }
                }

                // 步骤间隔2秒（最后一个步骤不需要）
                if (i < steps.length - 1) {
                    logger.info(`[Execute Task] 等待 2 秒后执行下一步...`);
                    await taskControl.wait(2000, runId);
                }
            }

            // 收尾：补满进度（例如最后几个元素被跳过的情况），确保 UI 不卡在 79/80
            taskControl.finishProgress();
            const durationMs = taskControl.getElapsedMs();
            logger.info(`[Execute Task] 任务耗时 ${formatDuration(durationMs)}`);

            // 记录历史
            await AccessHistoryModel.create({
                url_id: task.id,
                success: true,
                error_message: null,
                screenshot_path: null
            });

            // 记录耗时，供下次执行前估算
            await recordTaskDuration(task.id, durationMs);

            logger.info(`[Execute Task] 任务执行完成`);
            mainWindow.webContents.send('task-completed', { taskId, success: true });

            return { success: true };
        } catch (error) {
            // 用户停止：不计为失败，也不写入历史
            if (error && error.aborted) {
                logger.warn('[Execute Task] 任务已停止');
                mainWindow.webContents.send('task-completed', { taskId, success: false, aborted: true, error: '任务已停止' });
                return { success: false, aborted: true, error: '任务已停止' };
            }
            logger.error(`[Execute Task] 执行失败: ${error.message}`);
            mainWindow.webContents.send('task-completed', { taskId, success: false, error: error.message });
            return { success: false, error: error.message };
        } finally {
            // 结束本轮任务（runId 不匹配时不会影响新一轮任务）
            taskControl.end(runId);
        }
    });
}

// 监听窗口大小变化
function setupResizeHandler() {
    mainWindow.on('resize', updateBrowserViewBounds);
}

// 应用启动
app.whenReady().then(async () => {
    // 初始化数据库
    const db = await getDatabase();

    createWindow();
    initBrowserTabs();
    setupIpc();
    setupResizeHandler();

    // 轮询检查滚轮缩放请求（所有标签页；缩放监听注入由 TabManager 在各标签页 did-finish-load 时完成）
    setInterval(async () => {
        for (const wc of tabManager.getAllWebContents()) {
            try {
                const pending = await wc.executeJavaScript('window.__pendingZoom || 0');
                if (pending !== 0) {
                    await wc.executeJavaScript('window.__pendingZoom = 0');
                    const currentZoom = await wc.getZoomFactor();
                    const newZoom = Math.max(0.25, Math.min(5, currentZoom + pending * 0.1));
                    await wc.setZoomFactor(newZoom);
                    if (wc === tabManager.getActiveWebContents()) {
                        mainWindow.webContents.send('zoom-changed', newZoom);
                    }
                }
            } catch (e) {}
        }
    }, 50);

    // 监听键盘快捷键
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.type === 'keyDown') {
            if (input.key === '=' || input.key === '+') {
                handleZoom(0.1);
            } else if (input.key === '-') {
                handleZoom(-0.1);
            } else if (input.key === '0') {
                resetZoom();
            }
        }
    });

    // 缩放处理函数（作用于当前激活标签页）
    async function handleZoom(delta) {
        const wc = tabManager.getActiveWebContents();
        if (!wc) return;
        try {
            const currentZoom = await wc.getZoomFactor();
            const newZoom = Math.max(0.25, Math.min(5, currentZoom + delta));
            await wc.setZoomFactor(newZoom);
            mainWindow.webContents.send('zoom-changed', newZoom);
        } catch (e) {}
    }

    async function resetZoom() {
        const wc = tabManager.getActiveWebContents();
        if (!wc) return;
        try {
            await wc.setZoomFactor(1);
            mainWindow.webContents.send('zoom-changed', 1);
        } catch (e) {}
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
