const BrowserController = require('./BrowserController');
const TaskScheduler = require('./TaskScheduler');
const { getDatabase } = require('../db/database');
const logger = require('../utils/logger');
const config = require('../utils/configLoader');

class UrlBrowserService {
    constructor() {
        this.browserController = null;
        this.taskScheduler = null;
        this.isRunning = false;
    }

    async initialize() {
        logger.info('Initializing UrlBrowserService...');
        
        try {
            // 1. 初始化数据库
            await getDatabase();
            
            // 2. 初始化浏览器控制器
            this.browserController = new BrowserController(config.get('browser'));
            await this.browserController.initialize();
            
            // 3. 初始化任务调度器
            this.taskScheduler = new TaskScheduler(
                this.browserController, 
                config.get('schedule')
            );
            
            logger.info('UrlBrowserService initialized successfully.');
        } catch (error) {
            logger.error('Failed to initialize UrlBrowserService: %O', error);
            throw error;
        }
    }

    async start() {
        if (this.isRunning) return;
        
        logger.info('Starting UrlBrowserService...');
        
        try {
            if (!this.taskScheduler) {
                await this.initialize();
            }
            
            await this.taskScheduler.start();
            this.isRunning = true;
            
            logger.info('UrlBrowserService started and running.');
        } catch (error) {
            logger.error('Failed to start UrlBrowserService: %O', error);
            throw error;
        }
    }

    async stop() {
        if (!this.isRunning) return;
        
        logger.info('Stopping UrlBrowserService...');
        
        try {
            if (this.taskScheduler) {
                this.taskScheduler.stop();
            }
            
            if (this.browserController) {
                await this.browserController.close();
            }
            
            this.isRunning = false;
            logger.info('UrlBrowserService stopped gracefully.');
        } catch (error) {
            logger.error('Error during UrlBrowserService shutdown: %O', error);
        }
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            scheduler: this.taskScheduler ? this.taskScheduler.getStatus() : null,
            browser: this.browserController ? this.browserController.getStatus() : null,
            config: config.getAll()
        };
    }
}

module.exports = new UrlBrowserService();