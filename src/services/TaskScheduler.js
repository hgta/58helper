const UrlModel = require('../models/UrlModel');
const AccessHistoryModel = require('../models/AccessHistoryModel');
const logger = require('../utils/logger');

class TaskScheduler {
    constructor(browserController, options = {}) {
        this.browserController = browserController;
        this.options = {
            interval: 60000, // 1 minute
            maxRetries: 2,
            resetHour: 0,
            ...options
        };

        this.isRunning = false;
        this.timer = null;
        this.queue = [];
        this.isProcessing = false;
    }

    // 启动调度器
    async start() {
        if (this.isRunning) return;
        
        logger.info('Starting TaskScheduler...');
        this.isRunning = true;
        
        // 初始加载队列
        await this.loadQueue();
        
        // 立即执行一次任务（如果有队列）
        if (this.queue.length > 0) {
            logger.info(`Queue has ${this.queue.length} tasks, executing immediately...`);
            setImmediate(async () => {
                try {
                    await this.processNextTask();
                } catch (error) {
                    logger.error('Error in immediate task execution: %O', error);
                }
            });
        } else {
            logger.info('Queue is empty, waiting for next interval...');
        }
        
        // 设置定时器
        this.scheduleNext();
        
        logger.info(`TaskScheduler started. Interval: ${this.options.interval}ms`);
    }

    // 停止调度器
    stop() {
        this.isRunning = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('TaskScheduler stopped.');
    }

    // 安排下一次执行
    scheduleNext() {
        if (!this.isRunning) return;
        
        this.timer = setTimeout(async () => {
            try {
                await this.processNextTask();
            } catch (error) {
                logger.error('Error processing task in scheduler: %O', error);
            }
            
            this.scheduleNext();
        }, this.options.interval);
    }

    // 加载待访问队列
    async loadQueue() {
        logger.info('Loading URL queue from database...');
        try {
            const enabledUrls = await UrlModel.getEnabled();
            const today = new Date().toISOString().split('T')[0];
            
            const tasksToQueue = [];
            
            for (const urlRecord of enabledUrls) {
                // 检查今日是否已访问过
                const hasAccessed = await AccessHistoryModel.hasAccessedToday(urlRecord.id);
                
                if (!hasAccessed) {
                    tasksToQueue.push({
                        ...urlRecord,
                        retryCount: 0
                    });
                }
            }
            
            // 按优先级排序
            this.queue = tasksToQueue.sort((a, b) => b.priority - a.priority);
            logger.info(`Queue loaded. ${this.queue.length} tasks pending.`);
        } catch (error) {
            logger.error('Failed to load queue: %O', error);
        }
    }

    // 处理下一个任务
    async processNextTask() {
        if (this.isProcessing) {
            logger.debug('Still processing previous task, skipping this interval.');
            return;
        }

        // 如果队列为空，尝试重新加载
        if (this.queue.length === 0) {
            await this.loadQueue();
        }

        if (this.queue.length === 0) {
            logger.debug('No tasks in queue.');
            return;
        }

        this.isProcessing = true;
        const task = this.queue.shift();
        
        logger.info(`--- Processing task: ${task.url} ---`);
        
        try {
            const result = await this.executeTask(task);
            
            if (result.success) {
                logger.info(`✓ Task completed successfully: ${task.url}`);
            } else {
                logger.warn(`✗ Task failed: ${task.url}. Error: ${result.error}`);
                
                // 检查是否需要重试
                if (task.retryCount < this.options.maxRetries) {
                    task.retryCount++;
                    logger.info(`Scheduling retry (${task.retryCount}/${this.options.maxRetries}) for: ${task.url}`);
                    // 将任务放回队列末尾
                    this.queue.push(task);
                } else {
                    logger.error(`Max retries reached for: ${task.url}`);
                }
            }
        } catch (error) {
            logger.error(`Unexpected error executing task for ${task.url}: %O`, error);
        } finally {
            this.isProcessing = false;
        }
    }

    // 执行单个任务逻辑
    async executeTask(task) {
        try {
            // 1. 导航到页面
            const navResult = await this.browserController.navigateTo(task.url);
            if (!navResult.success) {
                await AccessHistoryModel.create({
                    url_id: task.id,
                    success: false,
                    error_message: `Navigation failed: ${navResult.error}`
                });
                return { success: false, error: navResult.error };
            }

            // 2. 等待加载
            await this.browserController.waitForPageLoad({ extraWait: 2000 });

            // 3. 查找并点击按钮
            let clickResult = { success: false, error: 'No selectors provided' };
            
            if (task.button_selectors && task.button_selectors.length > 0) {
                clickResult = await this.browserController.clickButton(task.button_selectors);
            } else {
                logger.warn(`No button selectors configured for ${task.url}, skipping click.`);
                clickResult = { success: true, message: 'No click needed' };
            }

            // 4. 记录成功结果
            await AccessHistoryModel.create({
                url_id: task.id,
                success: clickResult.success,
                error_message: clickResult.success ? null : clickResult.error,
                screenshot_path: null
            });

            return clickResult;
        } catch (error) {
            // 记录异常
            logger.error(`Exception during execution for ${task.url}: %O`, error);
            await AccessHistoryModel.create({
                url_id: task.id,
                success: false,
                error_message: `Exception: ${error.message}`,
                screenshot_path: null
            });
            return { success: false, error: error.message };
        }
    }

    // 获取当前状态
    getStatus() {
        return {
            isRunning: this.isRunning,
            isProcessing: this.isProcessing,
            queueSize: this.queue.length,
            nextIntervalMs: this.options.interval
        };
    }
}

module.exports = TaskScheduler;