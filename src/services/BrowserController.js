const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class BrowserController {
    constructor(options = {}) {
        this.options = {
            headless: true,
            slowMo: 0,
            timeout: 30000,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            screenshotsDir: './logs/screenshots',
            ...options
        };

        this.browser = null;
        this.context = null;
        this.page = null;
        this.isInitialized = false;
    }

    // 初始化浏览器
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        logger.info('Initializing browser (headless: %s)...', this.options.headless);
        
        try {
            // 确保截图目录存在
            if (this.options.screenshotsDir) {
                const screenshotsPath = path.resolve(this.options.screenshotsDir);
                if (!fs.existsSync(screenshotsPath)) {
                    fs.mkdirSync(screenshotsPath, { recursive: true });
                    logger.debug(`Created screenshots directory: ${screenshotsPath}`);
                }
            }

            // 启动浏览器
            this.browser = await chromium.launch({
                headless: this.options.headless,
                slowMo: this.options.slowMo,
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--start-maximized',
                    '--window-size=1920,1080',
                    '--window-position=0,0',
                    '--force-device-scale-factor=1',
                    '--disable-gpu'
                ]
            });

            // 创建上下文 - 不限制viewport，让页面自适应
            this.context = await this.browser.newContext({
                viewport: null,
                screen: {
                    width: 1920,
                    height: 1080,
                    deviceScaleFactor: 1
                },
                deviceScaleFactor: 1,
                isMobile: false,
                hasTouch: false,
                userAgent: this.options.userAgent,
                ignoreHTTPSErrors: true,
                locale: 'zh-CN',
                timezoneId: 'Asia/Shanghai'
            });

            // 创建页面
            this.page = await this.context.newPage();
            
            // 设置超时
            this.page.setDefaultTimeout(this.options.timeout);
            
            // 监听控制台日志
            this.page.on('console', msg => {
                const type = msg.type();
                const text = msg.text();
                logger.debug(`[Browser Console ${type}] ${text}`);
            });

            // 监听页面错误
            this.page.on('pageerror', error => {
                logger.error(`[Page Error] ${error.message}`);
            });

            this.isInitialized = true;
            logger.info('Browser initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize browser: %O', error);
            throw error;
        }
    }

    // 导航到URL
    async navigateTo(url, waitFor = 'load') {
        if (!this.isInitialized) {
            await this.initialize();
        }

        logger.info(`Navigating to: ${url}`);
        
        try {
            const response = await this.page.goto(url, {
                waitUntil: waitFor,
                timeout: this.options.timeout
            });

            if (!response) {
                throw new Error(`No response from ${url}`);
            }

            const status = response.status();
            if (status >= 400) {
                throw new Error(`HTTP ${status} error for ${url}`);
            }

            logger.info(`Successfully loaded ${url} (status: ${status})`);
            return { success: true, status, url };
        } catch (error) {
            logger.error(`Failed to navigate to ${url}: %s`, error.message);
            return { 
                success: false, 
                error: error.message,
                url
            };
        }
    }

    // 等待页面完全加载
    async waitForPageLoad(options = {}) {
        const { timeout = this.options.timeout, extraWait = 0 } = options;
        
        try {
            // 等待网络空闲
            await this.page.waitForLoadState('networkidle', { timeout });
            
            // 等待额外的指定时间（用于动态内容加载）
            if (extraWait > 0) {
                await this.page.waitForTimeout(extraWait);
            }

            return { success: true };
        } catch (error) {
            logger.warn('Failed to wait for page load (networkidle): %s', error.message);
            return { success: false, error: error.message };
        }
    }

    // 查找按钮元素
    async findButton(selectors) {
        if (!Array.isArray(selectors)) {
            selectors = [selectors];
        }

        for (const selector of selectors) {
            try {
                const element = await this.page.$(selector);
                if (element) {
                    const isVisible = await element.isVisible();
                    if (isVisible) {
                        const isEnabled = await element.isEnabled();
                        return {
                            found: true,
                            selector,
                            element,
                            visible: isVisible,
                            enabled: isEnabled
                        };
                    }
                }
            } catch (error) {
                // 选择器无效，继续尝试下一个
                logger.debug(`Selector ${selector} not found or invalid: ${error.message}`);
            }
        }

        return { found: false, selectors };
    }

    // 点击按钮
    async clickButton(selector, options = {}) {
        const { waitForNavigation = false, timeout = this.options.timeout } = options;
        
        try {
            const buttonInfo = await this.findButton(selector);
            
            if (!buttonInfo.found) {
                throw new Error(`Button not found with selectors: ${Array.isArray(selector) ? selector.join(', ') : selector}`);
            }

            if (!buttonInfo.enabled) {
                throw new Error('Button found but not enabled');
            }

            logger.info(`Clicking button with selector: ${buttonInfo.selector}`);
            
            if (waitForNavigation) {
                // 等待导航完成
                await Promise.all([
                    buttonInfo.element.click(),
                    this.page.waitForNavigation({ waitUntil: 'networkidle', timeout })
                ]);
            } else {
                await buttonInfo.element.click();
                // 短暂等待以处理可能的客户端变化
                await this.page.waitForTimeout(500);
            }

            return { 
                success: true, 
                selector: buttonInfo.selector,
                message: 'Button clicked successfully'
            };
        } catch (error) {
            logger.error('Failed to click button: %s', error.message);
            return { 
                success: false, 
                selector: Array.isArray(selector) ? selector.join(', ') : selector,
                error: error.message
            };
        }
    }

    // 截图
    async takeScreenshot(filename = null) {
        if (!this.options.screenshotsDir) {
            return { success: false, error: 'Screenshots directory not configured' };
        }

        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const screenshotName = filename || `screenshot-${timestamp}.png`;
            const screenshotPath = path.join(this.options.screenshotsDir, screenshotName);
            
            await this.page.screenshot({ 
                path: screenshotPath,
                fullPage: true 
            });

            logger.info(`Screenshot saved: ${screenshotPath}`);
            return { success: true, path: screenshotPath };
        } catch (error) {
            logger.error('Failed to take screenshot: %O', error);
            return { success: false, error: error.message };
        }
    }

    // 获取页面信息
    async getPageInfo() {
        try {
            const title = await this.page.title();
            const url = this.page.url();
            
            // 获取页面内容长度
            const content = await this.page.content();
            const contentLength = content.length;

            return {
                title,
                url,
                contentLength,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Failed to get page info: %O', error);
            return { error: error.message };
        }
    }

    // 执行JavaScript代码
    async evaluate(script, ...args) {
        try {
            const result = await this.page.evaluate(script, ...args);
            return result;
        } catch (error) {
            logger.error('Failed to evaluate script: %O', error);
            throw error;
        }
    }

    // 关闭浏览器
    async close() {
        if (this.browser) {
            logger.info('Closing browser...');
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            this.isInitialized = false;
            logger.info('Browser closed successfully');
        }
    }

    // 重启浏览器
    async restart() {
        await this.close();
        await this.initialize();
    }

    // 检查浏览器状态
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            isConnected: this.browser ? this.browser.isConnected() : false,
            options: this.options
        };
    }
}

module.exports = BrowserController;