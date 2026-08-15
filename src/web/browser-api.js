const express = require('express');
const router = express.Router();
const BrowserManager = require('../services/BrowserManager');
const UrlModel = require('../models/UrlModel');
const AccessHistoryModel = require('../models/AccessHistoryModel');
const logger = require('../utils/logger');

// 启动浏览器
router.post('/launch', async (req, res) => {
    try {
        const result = await BrowserManager.launch(false);
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error('启动浏览器失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 预打开页面（用于登录）
router.post('/preopen', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }
        
        const result = await BrowserManager.preOpen(url);
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error('预打开失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 执行单个任务
router.post('/execute', async (req, res) => {
    let screenshotPath = null;
    
    try {
        const { taskId } = req.body;
        
        if (!taskId) {
            return res.status(400).json({ success: false, error: 'Task ID is required' });
        }
        
        // 获取任务信息
        const task = await UrlModel.getById(taskId);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found' });
        }
        
        logger.info(`[API] 执行任务: ${task.url}`);
        
        // 使用BrowserManager执行（复用浏览器）
        const result = await BrowserManager.visitAndClick(task);
        screenshotPath = result.screenshotPath;
        
        // 记录访问历史
        await AccessHistoryModel.create({
            url_id: task.id,
            success: result.clickResult.success,
            error_message: result.clickResult.success ? null : result.clickResult.error,
            screenshot_path: screenshotPath
        });
        
        res.json({
            success: true,
            message: '任务执行成功',
            clickResult: result.clickResult,
            screenshot: screenshotPath
        });
        
    } catch (error) {
        logger.error('执行任务失败:', error);
        
        // 记录失败
        if (req.body.taskId) {
            try {
                await AccessHistoryModel.create({
                    url_id: req.body.taskId,
                    success: false,
                    error_message: error.message,
                    screenshot_path: screenshotPath
                });
            } catch (e) {
                logger.error('记录失败历史失败:', e);
            }
        }
        
        res.status(500).json({ success: false, error: error.message });
    }
});

// 批量执行任务
router.post('/execute-all', async (req, res) => {
    try {
        const { force = false } = req.body;
        
        // 获取所有启用的任务
        const tasks = await UrlModel.getEnabled();
        
        if (tasks.length === 0) {
            return res.json({ success: true, message: '没有启用的任务', executed: 0 });
        }
        
        // 启动浏览器（如果不存在）
        await BrowserManager.launch(false);
        
        const results = [];
        
        for (const task of tasks) {
            // 检查今日是否已访问
            if (!force) {
                const hasAccessed = await AccessHistoryModel.hasAccessedToday(task.id);
                if (hasAccessed) {
                    results.push({ taskId: task.id, skipped: true, message: '今日已访问' });
                    continue;
                }
            }
            
            try {
                const result = await BrowserManager.visitAndClick(task);
                
                await AccessHistoryModel.create({
                    url_id: task.id,
                    success: result.clickResult.success,
                    error_message: result.clickResult.success ? null : result.clickResult.error,
                    screenshot_path: result.screenshotPath
                });
                
                results.push({ taskId: task.id, success: true, ...result });
                
                // 任务间隔
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                results.push({ taskId: task.id, success: false, error: error.message });
                
                await AccessHistoryModel.create({
                    url_id: task.id,
                    success: false,
                    error_message: error.message
                });
            }
        }
        
        res.json({
            success: true,
            message: '批量执行完成',
            executed: results.length,
            results
        });
        
    } catch (error) {
        logger.error('批量执行失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 关闭浏览器
router.post('/close', async (req, res) => {
    try {
        await BrowserManager.close();
        res.json({ success: true, message: '浏览器已关闭' });
    } catch (error) {
        logger.error('关闭浏览器失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取浏览器状态
router.get('/status', async (req, res) => {
    try {
        const status = BrowserManager.getStatus();
        res.json({ success: true, data: status });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
