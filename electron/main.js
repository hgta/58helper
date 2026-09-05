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
let browserView;

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

// 创建浏览器视图（用于显示网页）
function createBrowserView() {
    const { BrowserView } = require('electron');
    
    browserView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false
        }
    });

    mainWindow.setBrowserView(browserView);
    updateBrowserViewBounds();
}

// 更新浏览器视图位置
function updateBrowserViewBounds() {
    if (!browserView || !mainWindow) return;
    
    const { width, height } = mainWindow.getContentBounds();
    // 左侧控制面板宽度280px，顶部工具栏高度42px
    browserView.setBounds({ x: 280, y: 42, width: width - 280, height: height - 42 });
    browserView.setAutoResize({ width: true, height: true });
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

// IPC 处理
function setupIpc() {
    // 日志实时推送到 UI 日志面板（logger.js 的 RendererTransport 发出事件）
    loggerEvents.on('log', (entry) => {
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('log-message', entry);
        }
    });

    // 模态框显示时隐藏/恢复 BrowserView
    ipcMain.on('modal-show', () => {
        if (browserView) {
            browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        }
    });
    
    ipcMain.on('modal-hide', () => {
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

    // 浏览器控制
    ipcMain.handle('browser-navigate', async (event, url) => {
        if (!browserView) createBrowserView();
        browserView.webContents.loadURL(url);
        return { success: true };
    });

    ipcMain.handle('browser-back', () => {
        if (browserView && browserView.webContents.canGoBack()) {
            browserView.webContents.goBack();
        }
    });

    ipcMain.handle('browser-forward', () => {
        if (browserView && browserView.webContents.canGoForward()) {
            browserView.webContents.goForward();
        }
    });

    ipcMain.handle('browser-refresh', () => {
        if (browserView) browserView.webContents.reload();
    });

    ipcMain.handle('browser-get-url', () => {
        return browserView ? browserView.webContents.getURL() : '';
    });

    ipcMain.handle('browser-get-title', () => {
        return browserView ? browserView.webContents.getTitle() : '';
    });

    ipcMain.handle('browser-execute-script', async (event, script) => {
        if (!browserView) return { success: false, error: 'No browser view' };
        try {
            const result = await browserView.webContents.executeJavaScript(script);
            return { success: true, result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('browser-click-element', async (event, selector) => {
        if (!browserView) return { success: false, error: 'No browser view' };
        try {
            await browserView.webContents.executeJavaScript(`
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
        if (!browserView) return { success: false, error: 'No browser view' };
        try {
            const image = await browserView.webContents.capturePage();
            const fs = require('fs');
            const screenshotPath = path.join(getScreenshotsDir(), `screenshot-${Date.now()}.png`);
            fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
            fs.writeFileSync(screenshotPath, image.toPNG());
            return { success: true, path: screenshotPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 缩放控制
    ipcMain.handle('browser-set-zoom', async (event, zoomLevel) => {
        if (!browserView) return { success: false, error: 'No browser view' };
        try {
            await browserView.webContents.setZoomFactor(zoomLevel);
            return { success: true, zoomLevel };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('browser-get-zoom', async () => {
        if (!browserView) return { success: false, error: 'No browser view' };
        try {
            const zoomLevel = await browserView.webContents.getZoomFactor();
            return { success: true, zoomLevel };
        } catch (error) {
            return { success: false, error: error.message };
        }
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

            if (!browserView) createBrowserView();

            let lastResult = { success: true };

            // 遍历执行每个步骤
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                logger.info(`[Execute Task] 执行步骤 ${i + 1}/${steps.length}: ${step.url}`);

                // 加载页面
                const loadPromise = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('页面加载超时'));
                    }, 60000);

                    browserView.webContents.once('did-finish-load', () => {
                        clearTimeout(timeout);
                        resolve();
                    });

                    browserView.webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
                        clearTimeout(timeout);
                        reject(new Error(`页面加载失败: ${errorDescription}`));
                    });

                    browserView.webContents.loadURL(step.url);
                });

                try {
                    await loadPromise;
                } catch (loadError) {
                    logger.warn(`[Execute Task] 页面加载警告: ${loadError.message}`);
                }

                // 等待页面稳定
                await new Promise(resolve => setTimeout(resolve, 3000));
                logger.info(`[Execute Task] 步骤 ${i + 1} 页面加载完成`);

                // 点击按钮
                const buttonSelectors = step.button_selectors || [];
                if (buttonSelectors.length > 0) {
                    if (step.iterate_all) {
                        // 轮询模式：依次点击所有匹配的可见元素，每个元素后处理确认框，间隔可配置（默认10秒）
                        const intervalSec = Number(step.iterate_interval) > 0 ? Number(step.iterate_interval) : 10;
                        // 分批节奏：每组连续点击 N 个后额外休息 M 秒（仅字段有效时启用）
                        const batchSize = Number(step.iterate_batch_size);
                        const batchIntervalSec = Number(step.iterate_batch_interval);
                        const batchEnabled = Number.isInteger(batchSize) && batchSize > 0
                            && Number.isFinite(batchIntervalSec) && batchIntervalSec > 0;
                        logger.info(`[Execute Task] 轮询点击按钮: ${buttonSelectors.join(', ')}`);
                        for (const selector of buttonSelectors) {
                            // 先统计该选择器的可见元素总数
                            const initResult = await browserView.webContents.executeJavaScript(`
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
                                const result = await browserView.webContents.executeJavaScript(`
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
                                await handleConfirmBox(browserView.webContents, step.confirm_selectors || []);
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
                    } else {
                        // 原逻辑：只点击第一个匹配元素
                        logger.info(`[Execute Task] 尝试点击按钮: ${buttonSelectors.join(', ')}`);
                        for (const selector of buttonSelectors) {
                            try {
                                const clicked = await browserView.webContents.executeJavaScript(`
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
                }

                // 处理确认框
                await handleConfirmBox(browserView.webContents, step.confirm_selectors || []);

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
    createBrowserView();
    setupIpc();
    setupResizeHandler();

    // 监听浏览器视图URL变化
    browserView.webContents.on('did-navigate', (event, url) => {
        mainWindow.webContents.send('browser-url-changed', url);
    });
    browserView.webContents.on('did-navigate-in-page', (event, url) => {
        mainWindow.webContents.send('browser-url-changed', url);
    });
    browserView.webContents.on('page-title-updated', (event, title) => {
        mainWindow.webContents.send('browser-title-changed', title);
    });

    // 在页面加载完成后发送当前缩放并注入滚轮监听
    browserView.webContents.on('did-finish-load', async () => {
        try {
            const zoom = await browserView.webContents.getZoomFactor();
            mainWindow.webContents.send('zoom-changed', zoom);

            // 注入 Ctrl+滚轮 缩放监听
            await browserView.webContents.executeJavaScript(`
                if (!window.__zoomWheelListener) {
                    window.__zoomWheelListener = true;
                    window.__pendingZoom = 0;
                    window.addEventListener('wheel', (e) => {
                        if (e.ctrlKey) {
                            e.preventDefault();
                            window.__pendingZoom += e.deltaY > 0 ? -1 : 1;
                        }
                    }, { passive: false });
                }
            `);
        } catch (e) {}
    });

    // 轮询检查滚轮缩放请求
    setInterval(async () => {
        if (!browserView || !browserView.webContents) return;
        try {
            const pending = await browserView.webContents.executeJavaScript('window.__pendingZoom || 0');
            if (pending !== 0) {
                await browserView.webContents.executeJavaScript('window.__pendingZoom = 0');
                await handleZoom(pending * 0.1);
            }
        } catch (e) {}
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

    // 缩放处理函数
    async function handleZoom(delta) {
        if (!browserView) return;
        try {
            const currentZoom = await browserView.webContents.getZoomFactor();
            const newZoom = Math.max(0.25, Math.min(5, currentZoom + delta));
            await browserView.webContents.setZoomFactor(newZoom);
            mainWindow.webContents.send('zoom-changed', newZoom);
        } catch (e) {}
    }

    async function resetZoom() {
        if (!browserView) return;
        try {
            await browserView.webContents.setZoomFactor(1);
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
