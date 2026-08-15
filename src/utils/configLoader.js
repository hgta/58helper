const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
require('dotenv').config();

class ConfigLoader {
    constructor() {
        this.config = {};
        this.load();
    }

    load() {
        const configPath = path.resolve(process.cwd(), 'config.yaml');
        const examplePath = path.resolve(process.cwd(), 'config.yaml.example');
        
        let fileConfig = {};

        // 如果 config.yaml 存在，加载它
        if (fs.existsSync(configPath)) {
            try {
                const fileContents = fs.readFileSync(configPath, 'utf8');
                fileConfig = yaml.load(fileContents) || {};
            } catch (error) {
                console.error('Failed to load config.yaml:', error.message);
            }
        } else if (fs.existsSync(examplePath)) {
            // 如果只有 example 文件，作为回退（或者提醒用户）
            console.warn('config.yaml not found. Using config.yaml.example as template.');
        }

        // 优先级: 环境变量 > 配置文件 > 默认值
        this.config = {
            browser: {
                headless: process.env.BROWSER_HEADLESS === 'false' ? false : (fileConfig.browser?.headless ?? true),
                slowMo: parseInt(process.env.BROWSER_SLOWMO || fileConfig.browser?.slowMo || 0),
                timeout: parseInt(process.env.BROWSER_TIMEOUT || fileConfig.browser?.timeout || 30000),
                screenshotsDir: process.env.SCREENSHOTS_DIR || fileConfig.browser?.screenshotsDir || './logs/screenshots'
            },
            schedule: {
                interval: parseInt(process.env.SCHEDULE_INTERVAL || fileConfig.schedule?.interval || 60000),
                maxRetries: parseInt(process.env.MAX_RETRIES || fileConfig.schedule?.maxRetries || 2),
                resetHour: parseInt(process.env.RESET_HOUR || fileConfig.schedule?.resetHour || 0)
            },
            database: {
                path: process.env.DATABASE_PATH || fileConfig.database?.path || './data/browser_automation.db'
            },
            logLevel: process.env.LOG_LEVEL || fileConfig.logLevel || 'info'
        };
    }

    get(key, defaultValue = null) {
        const parts = key.split('.');
        let current = this.config;
        for (const part of parts) {
            if (current[part] === undefined) return defaultValue;
            current = current[part];
        }
        return current;
    }

    getAll() {
        return this.config;
    }
}

module.exports = new ConfigLoader();