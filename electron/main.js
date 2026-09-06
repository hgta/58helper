const { app, BrowserWindow, ipcMain, session, nativeImage } = require('electron');
const path = require('path');
const { getDatabase } = require('../src/db/database');
const UrlModel = require('../src/models/UrlModel');
const AccessHistoryModel = require('../src/models/AccessHistoryModel');
const logger = require('../src/utils/logger');
const { loggerEvents } = require('../src/utils/logger');
const { getScreenshotsDir } = require('../src/utils/paths');
const fs = require('fs');

let mainWindow;
const TabManager = require('./tab-manager');
const tabManager = new TabManager();

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
async function handleConfirmBox(webContents, confirmSelectors) {
    if (!confirmSelectors || confirmSelectors.length === 0) return false;

    await new Promise(resolve => setTimeout(resolve, 1500));
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
                await new Promise(resolve => setTimeout(resolve, 500));
                return true;
            }
        } catch (e) {
            logger.debug(`[Execute Task] 确认框选择器 ${selector} 失败: ${e.message}`);
        }
    }
    return false;
}

// ===== 步骤执行辅助（主标签页与裂变临时标签页共用） =====

// 原地轮询：在同一页面内逐个点击所有匹配的可见元素（现有行为，保持不变）
async function iterateInPlace(webContents, step) {
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

        let clickedCount = 0;
        while (true) {
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

            // 构造元素描述
            let desc = '未知元素';
            if (result.info) {
                const i = result.info;
                desc = i.text || i.aria || i.title || (i.id ? '#' + i.id : '') || (i.cls ? '.' + i.cls.split(' ')[0] : '') || i.tag;
            }
            logger.info(`[Execute Task] 轮询 [${clickedCount}/${initResult.visibleCount}] 点击: ${selector} -> ${desc}（剩余 ${result.remaining} 个未点击）`);

            // 每个元素点击后立即处理确认框
            await handleConfirmBox(webContents, step.confirm_selectors || []);
            // 还有剩余元素才等待间隔，最后一次点击后不额外等待
            if (result.remaining > 0 && intervalSec > 0) {
                logger.info(`[Execute Task] 轮询: 等待 ${intervalSec} 秒后点击下一个...`);
                await new Promise(resolve => setTimeout(resolve, intervalSec * 1000));
            }
            // 满一组且仍有剩余：先完成元素间隔等待，再额外组间休息
            if (batchEnabled && result.remaining > 0 && clickedCount % batchSize === 0) {
                logger.info(`[Execute Task] 轮询: 已连续点击 ${batchSize} 个，组间休息 ${batchIntervalSec} 秒后继续...`);
                await new Promise(resolve => setTimeout(resolve, batchIntervalSec * 1000));
            }
        }
    }
}

// 非轮询模式：只点击第一个匹配的可见元素
async function clickFirstMatch(webContents, step) {
    logger.info(`[Execute Task] 尝试点击按钮: ${step.button_selectors.join(', ')}`);
    for (const selector of step.button_selectors) {
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
async function runStepInWebContents(webContents, step) {
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
        await loadPromise;
    } catch (loadError) {
        logger.warn(`[Execute Task] 页面加载警告: ${loadError.message}`);
    }

    // 等待页面稳定
    await new Promise(resolve => setTimeout(resolve, 3000));
    logger.info(`[Execute Task] 页面加载完成: ${step.url}`);

    // 点击按钮
    const buttonSelectors = step.button_selectors || [];
    if (buttonSelectors.length > 0) {
        if (step.iterate_all) {
            // 轮询模式（原地，不裂变——临时标签页内的后续步骤一律原地执行）
            logger.info(`[Execute Task] 轮询点击按钮: ${buttonSelectors.join(', ')}`);
            await iterateInPlace(webContents, step);
        } else {
            await clickFirstMatch(webContents, step);
        }
    }

    // 处理确认框
    await handleConfirmBox(webContents, step.confirm_selectors || []);
}

// 裂变模式：主标签页停在列表页做调度台（只扫描+标记），临时标签页逐元素
// 「加载列表页 → 点击第 k 个元素（跳转留在临时标签页内）→ 执行后续步骤」
async function runFanoutStep(mainWc, steps, stepIndex) {
    const step = steps[stepIndex];
    const buttonSelectors = step.button_selectors || [];
    // 已知限制：裂变仅对第一个选择器生效（与原地模式的逐选择器轮询不同）
    const selector = buttonSelectors[0];
    if (!selector) return;

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
        await mainLoadPromise;
    } catch (loadError) {
        logger.warn(`[Execute Task] 裂变: 列表页加载警告: ${loadError.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));

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

    // 创建临时标签页（元素间复用，全部完成后关闭）
    let tempTabId = tabManager.createTab({ kind: 'temp' });
    tabManager.setTabTitle(tempTabId, `裂变 0/${descriptors.length}`);

    try {
        for (let k = 0; k < descriptors.length; k++) {
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
                await loadPromise;
            } catch (loadError) {
                logger.warn(`[Execute Task] 裂变 [${k + 1}/${descriptors.length}] 列表页加载警告: ${loadError.message}，跳过该元素`);
                continue;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));

            // CLICK：描述符（文本+href）优先匹配，可见顺序索引兜底
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
                    const desc = ${JSON.stringify(desc)};
                    const els = document.querySelectorAll('${selector.replace(/'/g, "\\'")}');
                    const visible = [];
                    for (const el of els) {
                        if (isVisible(el)) visible.push(el);
                    }
                    let target = null;
                    let by = '';
                    for (const el of visible) {
                        const a = el.closest('a');
                        const href = a ? (a.href || '') : (el.href || '');
                        const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
                        if (desc.text && text === desc.text && (!desc.href || href === desc.href)) {
                            target = el;
                            by = 'desc';
                            break;
                        }
                    }
                    if (!target && desc.index < visible.length) {
                        target = visible[desc.index];
                        by = 'index';
                    }
                    if (!target) return { clicked: false };
                    target.click();
                    const text = (target.innerText || target.textContent || '').trim().replace(/\\s+/g, ' ');
                    return { clicked: true, by, text: text.slice(0, 30) };
                })()
            `).catch(() => ({ clicked: false }));
            if (!clickResult || !clickResult.clicked) {
                logger.warn(`[Execute Task] 裂变 [${k + 1}/${descriptors.length}] 未匹配到元素（列表可能已变化），跳过`);
                continue;
            }
            logger.info(`[Execute Task] 裂变 [${k + 1}/${descriptors.length}] 点击元素(${clickResult.by}): ${clickResult.text || '未知元素'}`);

            // CONFIRM：本步骤的确认框在临时标签页内处理
            await handleConfirmBox(tempWc, step.confirm_selectors || []);

            // SUBSTEP：后续步骤在临时标签页内顺序执行（不再裂变）
            for (let j = stepIndex + 1; j < steps.length; j++) {
                logger.info(`[Execute Task] 裂变 [${k + 1}] 执行后续步骤 ${j + 1}/${steps.length}: ${steps[j].url}`);
                try {
                    await runStepInWebContents(tempWc, steps[j]);
                } catch (subError) {
                    logger.warn(`[Execute Task] 裂变 [${k + 1}] 后续步骤 ${j + 1} 异常: ${subError.message}，跳过该元素`);
                    break;
                }
                if (j < steps.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
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
                await new Promise(resolve => setTimeout(resolve, intervalSec * 1000));
            }
            if (batchEnabled && k < descriptors.length - 1 && (k + 1) % batchSize === 0) {
                logger.info(`[Execute Task] 裂变: 已连续处理 ${batchSize} 个，组间休息 ${batchIntervalSec} 秒后继续...`);
                await new Promise(resolve => setTimeout(resolve, batchIntervalSec * 1000));
            }
        }
    } finally {
        // CLOSE：关闭临时标签页并激活主标签页
        tabManager.closeTab(tempTabId);
        const mainTab = tabManager.getMainTab();
        if (mainTab) tabManager.activate(mainTab.id);
        logger.info(`[Execute Task] 裂变: 全部 ${descriptors.length} 个元素处理完毕`);
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

    // 执行任务
    ipcMain.handle('execute-task', async (event, taskId) => {
        try {
            const task = await UrlModel.getById(taskId);
            if (!task) return { success: false, error: 'Task not found' };

            const steps = task.steps || [];
            if (steps.length === 0) {
                return { success: false, error: 'No steps configured' };
            }

            logger.info(`[Execute Task] 开始执行任务: ${task.name || taskId}, 共 ${steps.length} 个步骤`);

            initBrowserTabs();
            const mainTab = tabManager.getMainTab();
            if (mainTab) tabManager.activate(mainTab.id);
            const mainWc = tabManager.getMainWebContents();
            if (!mainWc) return { success: false, error: 'No main tab' };

            // 遍历执行每个步骤
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                logger.info(`[Execute Task] 执行步骤 ${i + 1}/${steps.length}: ${step.url}`);

                // 裂变模式：轮询 + iterate_open_tabs + 非最后一步 → 临时标签页逐元素执行后续步骤
                const fanout = step.iterate_all
                    && step.iterate_open_tabs === true
                    && i < steps.length - 1;

                if (fanout) {
                    await runFanoutStep(mainWc, steps, i);
                } else {
                    await runStepInWebContents(mainWc, step);
                }

                // 步骤间隔5秒（最后一个步骤不需要）
                if (i < steps.length - 1) {
                    logger.info(`[Execute Task] 等待 5 秒后执行下一步...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }

            // 记录历史
            await AccessHistoryModel.create({
                url_id: task.id,
                success: true,
                error_message: null,
                screenshot_path: null
            });

            logger.info(`[Execute Task] 任务执行完成`);
            mainWindow.webContents.send('task-completed', { taskId, success: true });

            return { success: true };
        } catch (error) {
            logger.error(`[Execute Task] 执行失败: ${error.message}`);
            mainWindow.webContents.send('task-completed', { taskId, success: false, error: error.message });
            return { success: false, error: error.message };
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
