const express = require('express');
const path = require('path');
const UrlModel = require('../models/UrlModel');
const AccessHistoryModel = require('../models/AccessHistoryModel');
const UrlBrowserService = require('../services/UrlBrowserService');
const BrowserController = require('../services/BrowserController');
const logger = require('../utils/logger');

// 用于手动执行的浏览器控制器
let manualBrowserController = null;

const app = express();
const PORT = 8080;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 设置视图引擎
app.set('view engine', 'html');
app.engine('html', require('ejs').renderFile);
app.set('views', path.join(__dirname, 'views'));

// ===== API 路由 =====

// 获取所有URL
app.get('/api/urls', async (req, res) => {
    try {
        const urls = await UrlModel.getAll();
        res.json({ success: true, data: urls });
    } catch (error) {
        logger.error('Failed to get URLs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取单个URL
app.get('/api/urls/:id', async (req, res) => {
    try {
        const url = await UrlModel.getById(req.params.id);
        if (!url) {
            return res.status(404).json({ success: false, error: 'URL not found' });
        }
        res.json({ success: true, data: url });
    } catch (error) {
        logger.error('Failed to get URL:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 创建URL
app.post('/api/urls', async (req, res) => {
    try {
        const { url, button_selectors, priority, enabled } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }
        
        // 解析选择器
        let selectors = [];
        if (button_selectors) {
            if (typeof button_selectors === 'string') {
                selectors = button_selectors.split('\n').map(s => s.trim()).filter(s => s);
            } else if (Array.isArray(button_selectors)) {
                selectors = button_selectors;
            }
        }
        
        const newUrl = await UrlModel.create({
            url,
            button_selectors: selectors,
            priority: parseInt(priority) || 1,
            enabled: enabled !== undefined ? enabled : true
        });
        
        res.json({ success: true, data: newUrl });
    } catch (error) {
        logger.error('Failed to create URL:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 更新URL
app.put('/api/urls/:id', async (req, res) => {
    try {
        const { url, button_selectors, priority, enabled } = req.body;
        
        // 解析选择器
        let selectors = undefined;
        if (button_selectors !== undefined) {
            if (typeof button_selectors === 'string') {
                selectors = button_selectors.split('\n').map(s => s.trim()).filter(s => s);
            } else if (Array.isArray(button_selectors)) {
                selectors = button_selectors;
            }
        }
        
        const updateData = {};
        if (url !== undefined) updateData.url = url;
        if (selectors !== undefined) updateData.button_selectors = selectors;
        if (priority !== undefined) updateData.priority = parseInt(priority);
        if (enabled !== undefined) updateData.enabled = enabled;
        
        const updatedUrl = await UrlModel.update(req.params.id, updateData);
        res.json({ success: true, data: updatedUrl });
    } catch (error) {
        logger.error('Failed to update URL:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 删除URL
app.delete('/api/urls/:id', async (req, res) => {
    try {
        await UrlModel.delete(req.params.id);
        res.json({ success: true, message: 'URL deleted successfully' });
    } catch (error) {
        logger.error('Failed to delete URL:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 切换URL启用状态
app.post('/api/urls/:id/toggle', async (req, res) => {
    try {
        const url = await UrlModel.getById(req.params.id);
        if (!url) {
            return res.status(404).json({ success: false, error: 'URL not found' });
        }
        
        const updatedUrl = await UrlModel.update(req.params.id, { enabled: !url.enabled });
        res.json({ success: true, data: updatedUrl });
    } catch (error) {
        logger.error('Failed to toggle URL:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取访问历史
app.get('/api/history', async (req, res) => {
    try {
        const { limit = 50, date } = req.query;
        let history;
        
        if (date) {
            history = await AccessHistoryModel.getByDate(date, { limit: parseInt(limit) });
        } else {
            history = await AccessHistoryModel.getToday({ limit: parseInt(limit) });
        }
        
        res.json({ success: true, data: history });
    } catch (error) {
        logger.error('Failed to get history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取服务状态
app.get('/api/status', async (req, res) => {
    try {
        const status = UrlBrowserService.getStatus();
        const urls = await UrlModel.getAll();
        const todayHistory = await AccessHistoryModel.getToday();
        
        res.json({
            success: true,
            data: {
                service: status,
                urls: {
                    total: urls.length,
                    enabled: urls.filter(u => u.enabled).length
                },
                today: {
                    total: todayHistory.length,
                    success: todayHistory.filter(h => h.success).length,
                    failed: todayHistory.filter(h => !h.success).length
                }
            }
        });
    } catch (error) {
        logger.error('Failed to get status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 启动服务
app.post('/api/service/start', async (req, res) => {
    try {
        await UrlBrowserService.start();
        res.json({ success: true, message: 'Service started successfully' });
    } catch (error) {
        logger.error('Failed to start service:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 停止服务
app.post('/api/service/stop', async (req, res) => {
    try {
        await UrlBrowserService.stop();
        res.json({ success: true, message: 'Service stopped successfully' });
    } catch (error) {
        logger.error('Failed to stop service:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 手动执行一次任务
app.post('/api/execute', async (req, res) => {
    let screenshotPath = null;
    
    try {
        const { urlId } = req.body;
        console.log('[API Execute] Received request for urlId:', urlId);
        
        if (!urlId) {
            console.log('[API Execute] Error: URL ID is required');
            return res.status(400).json({ success: false, error: 'URL ID is required' });
        }
        
        const urlRecord = await UrlModel.getById(urlId);
        console.log('[API Execute] URL record:', urlRecord);
        
        if (!urlRecord) {
            console.log('[API Execute] Error: URL not found');
            return res.status(404).json({ success: false, error: 'URL not found' });
        }
        
        logger.info(`[Manual Execute] Starting task for: ${urlRecord.url}`);
        console.log(`[Manual Execute] Starting task for: ${urlRecord.url}`);
        console.log(`[Manual Execute] Button selectors:`, urlRecord.button_selectors);
        
        // 创建或复用浏览器控制器（带界面）
        if (!manualBrowserController) {
            console.log('[Manual Execute] Creating new browser controller...');
            manualBrowserController = new BrowserController({
                headless: false,
                timeout: 30000
            });
            await manualBrowserController.initialize();
            console.log('[Manual Execute] Browser initialized');
        } else {
            console.log('[Manual Execute] Reusing existing browser controller');
        }
        
        // 1. 导航到页面
        console.log(`[Manual Execute] Navigating to ${urlRecord.url}...`);
        const navResult = await manualBrowserController.navigateTo(urlRecord.url);
        console.log('[Manual Execute] Navigation result:', navResult);
        
        if (!navResult.success) {
            throw new Error(`导航失败: ${navResult.error}`);
        }
        
        // 2. 等待页面加载
        console.log('[Manual Execute] Waiting for page load...');
        await manualBrowserController.waitForPageLoad({ extraWait: 3000 });
        console.log('[Manual Execute] Page loaded');
        
        // 3. 查找并点击按钮
        let clickResult = { success: true, message: 'No click needed' };
        if (urlRecord.button_selectors && urlRecord.button_selectors.length > 0) {
            console.log('[Manual Execute] Clicking button with selectors:', urlRecord.button_selectors);
            clickResult = await manualBrowserController.clickButton(urlRecord.button_selectors);
            console.log('[Manual Execute] Click result:', clickResult);
        } else {
            console.log('[Manual Execute] No button selectors configured');
        }
        
        // 4. 截图
        console.log('[Manual Execute] Taking screenshot...');
        const screenshot = await manualBrowserController.takeScreenshot(`manual-${urlRecord.id}-${Date.now()}.png`);
        console.log('[Manual Execute] Screenshot result:', screenshot);
        if (screenshot.success) {
            screenshotPath = screenshot.path;
        }
        
        // 5. 记录结果
        console.log('[Manual Execute] Recording to database...');
        await AccessHistoryModel.create({
            url_id: urlRecord.id,
            success: clickResult.success,
            error_message: clickResult.success ? null : clickResult.error,
            screenshot_path: screenshotPath
        });
        
        logger.info(`[Manual Execute] Task completed for: ${urlRecord.url}`);
        console.log(`[Manual Execute] Task completed successfully`);
        
        res.json({ 
            success: true, 
            message: `Task executed for ${urlRecord.url}`,
            clickResult,
            screenshot: screenshot.success ? screenshot.path : null
        });
        
    } catch (error) {
        logger.error('[Manual Execute] Failed to execute task:', error);
        console.error('[Manual Execute] Error:', error);
        
        // 记录失败
        if (req.body.urlId) {
            try {
                await AccessHistoryModel.create({
                    url_id: req.body.urlId,
                    success: false,
                    error_message: error.message,
                    screenshot_path: screenshotPath
                });
            } catch (dbError) {
                console.error('[Manual Execute] Failed to record error:', dbError);
            }
        }
        
        res.status(500).json({ success: false, error: error.message });
    }
});

// 详细执行任务（带过程信息）
app.post('/api/execute-detail', async (req, res) => {
    let screenshotPath = null;
    let browserController = null;
    
    try {
        const { urlId } = req.body;
        
        if (!urlId) {
            return res.status(400).json({ success: false, error: 'URL ID is required' });
        }
        
        const urlRecord = await UrlModel.getById(urlId);
        if (!urlRecord) {
            return res.status(404).json({ success: false, error: 'URL not found' });
        }
        
        logger.info(`[Execute Detail] Starting task for: ${urlRecord.url}`);
        
        // 创建浏览器控制器（带界面）
        browserController = new BrowserController({
            headless: false,
            timeout: 30000
        });
        await browserController.initialize();
        
        // 1. 导航到页面
        const navResult = await browserController.navigateTo(urlRecord.url);
        
        if (!navResult.success) {
            throw new Error(`导航失败: ${navResult.error}`);
        }
        
        // 2. 等待页面加载
        await browserController.waitForPageLoad({ extraWait: 3000 });
        
        // 3. 查找并点击按钮
        let clickResult = { success: true, message: 'No click needed' };
        if (urlRecord.button_selectors && urlRecord.button_selectors.length > 0) {
            clickResult = await browserController.clickButton(urlRecord.button_selectors);
        }
        
        // 4. 截图
        const screenshot = await browserController.takeScreenshot(`detail-${urlRecord.id}-${Date.now()}.png`);
        if (screenshot.success) {
            screenshotPath = screenshot.path;
        }
        
        // 5. 记录结果
        await AccessHistoryModel.create({
            url_id: urlRecord.id,
            success: clickResult.success,
            error_message: clickResult.success ? null : clickResult.error,
            screenshot_path: screenshotPath
        });
        
        // 等待2秒让用户看到结果
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 关闭浏览器
        await browserController.close();
        
        logger.info(`[Execute Detail] Task completed for: ${urlRecord.url}`);
        
        res.json({ 
            success: true, 
            status: navResult.status,
            clickResult,
            screenshot: screenshot.success ? screenshot.path : null
        });
        
    } catch (error) {
        logger.error('[Execute Detail] Failed:', error);
        
        if (browserController) {
            await browserController.close();
        }
        
        // 记录失败
        if (req.body.urlId) {
            try {
                await AccessHistoryModel.create({
                    url_id: req.body.urlId,
                    success: false,
                    error_message: error.message,
                    screenshot_path: screenshotPath
                });
            } catch (dbError) {
                console.error('Failed to record error:', dbError);
            }
        }
        
        res.status(500).json({ success: false, error: error.message });
    }
});

// 流式执行任务（支持实时监控）
app.get('/api/execute-stream', async (req, res) => {
    const { urlId } = req.query;
    
    if (!urlId) {
        return res.status(400).json({ error: 'URL ID is required' });
    }
    
    // 设置SSE响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sendLog = (message, type = 'info') => {
        res.write(`data: ${JSON.stringify({ message, type, done: false })}\n\n`);
    };
    
    let screenshotPath = null;
    let browserController = null;
    
    try {
        const urlRecord = await UrlModel.getById(urlId);
        if (!urlRecord) {
            sendLog('错误: URL 不存在', 'error');
            res.write(`data: ${JSON.stringify({ done: true, success: false, error: 'URL not found' })}\n\n`);
            return res.end();
        }
        
        sendLog(`开始执行任务: ${urlRecord.url}`, 'info');
        
        // 创建浏览器控制器
        sendLog('正在启动浏览器...', 'info');
        browserController = new BrowserController({
            headless: false,
            timeout: 30000
        });
        await browserController.initialize();
        sendLog('✅ 浏览器启动成功', 'success');
        
        // 导航到页面
        sendLog(`正在访问: ${urlRecord.url}...`, 'info');
        const navResult = await browserController.navigateTo(urlRecord.url);
        
        if (!navResult.success) {
            throw new Error(`导航失败: ${navResult.error}`);
        }
        sendLog(`✅ 页面加载成功 (状态: ${navResult.status})`, 'success');
        
        // 等待页面加载
        sendLog('等待页面完全加载...', 'info');
        await browserController.waitForPageLoad({ extraWait: 3000 });
        sendLog('✅ 页面加载完成', 'success');
        
        // 查找并点击按钮
        let clickResult = { success: true, message: 'No click needed' };
        if (urlRecord.button_selectors && urlRecord.button_selectors.length > 0) {
            sendLog(`查找按钮: ${urlRecord.button_selectors.join(', ')}`, 'info');
            clickResult = await browserController.clickButton(urlRecord.button_selectors);
            
            if (clickResult.success) {
                sendLog(`✅ 按钮点击成功: ${clickResult.selector}`, 'success');
            } else {
                sendLog(`❌ 按钮点击失败: ${clickResult.error}`, 'error');
            }
        } else {
            sendLog('ℹ️ 未配置按钮选择器，跳过点击', 'warning');
        }
        
        // 截图
        sendLog('正在截图...', 'info');
        const screenshot = await browserController.takeScreenshot(`stream-${urlRecord.id}-${Date.now()}.png`);
        if (screenshot.success) {
            screenshotPath = screenshot.path;
            sendLog(`✅ 截图已保存`, 'success');
        }
        
        // 等待观察
        sendLog('等待3秒以便观察...', 'info');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 记录结果
        await AccessHistoryModel.create({
            url_id: urlRecord.id,
            success: clickResult.success,
            error_message: clickResult.success ? null : clickResult.error,
            screenshot_path: screenshotPath
        });
        
        sendLog('✅ 任务执行完成！', 'success');
        
        // 关闭浏览器
        await browserController.close();
        
        res.write(`data: ${JSON.stringify({ done: true, success: clickResult.success, error: clickResult.error })}\n\n`);
        res.end();
        
    } catch (error) {
        sendLog(`❌ 执行失败: ${error.message}`, 'error');
        
        // 记录失败
        if (urlId) {
            try {
                await AccessHistoryModel.create({
                    url_id: urlId,
                    success: false,
                    error_message: error.message,
                    screenshot_path: screenshotPath
                });
            } catch (dbError) {
                console.error('Failed to record error:', dbError);
            }
        }
        
        if (browserController) {
            await browserController.close();
        }
        
        res.write(`data: ${JSON.stringify({ done: true, success: false, error: error.message })}\n\n`);
        res.end();
    }
});

// ===== 页面路由 =====

// 主页 - 管理界面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// 挂载浏览器控制API
const browserApi = require('./browser-api');
app.use('/api/browser', browserApi);

// 静态文件 - 浏览器控制面板
app.get('/control', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'browser-control.html'));
});

// 启动Web服务器
function startWebServer() {
    return new Promise((resolve, reject) => {
        app.listen(PORT, (err) => {
            if (err) {
                reject(err);
            } else {
                logger.info(`Web management interface running at http://localhost:${PORT}`);
                logger.info(`Browser control panel at http://localhost:${PORT}/control`);
                resolve();
            }
        });
    });
}

module.exports = { startWebServer, app };
