const { chromium } = require('playwright');
const logger = require('../utils/logger');

/**
 * 浏览器管理器 - 支持复用浏览器实例
 */
class BrowserManager {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isInitialized = false;
    }

    // 启动浏览器（只启动一次，复用）
    async launch(headless = false) {
        if (this.isInitialized && this.browser) {
            logger.info('浏览器已在运行，复用现有实例');
            return { success: true, reused: true };
        }

        logger.info('启动浏览器...');
        
        try {
            this.browser = await chromium.launch({
                headless: headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--start-maximized',
                    '--window-size=1920,1080',
                    '--window-position=0,0',
                    '--force-device-scale-factor=1',
                    '--disable-gpu',
                    '--disable-software-rasterizer'
                ]
            });

            // 创建持久化上下文（保留cookie和存储）
            this.context = await this.browser.newContext({
                // 不设置viewport，让页面自适应窗口大小
                viewport: null,
                // 强制桌面模式
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                // 设置屏幕信息
                screen: {
                    width: 1920,
                    height: 1080,
                    deviceScaleFactor: 1
                },
                // 强制桌面特征
                isMobile: false,
                hasTouch: false,
                javaScriptEnabled: true,
                ignoreHTTPSErrors: true,
                // 设置语言和时区
                locale: 'zh-CN',
                timezoneId: 'Asia/Shanghai',
                // 设置额外HTTP头
                extraHTTPHeaders: {
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                }
            });

            this.page = await this.context.newPage();

            // 监听页面事件
            this.page.on('console', msg => {
                logger.debug(`[页面日志] ${msg.type()}: ${msg.text()}`);
            });

            this.page.on('pageerror', error => {
                logger.error(`[页面错误] ${error.message}`);
            });

            this.isInitialized = true;
            logger.info('浏览器启动成功');
            
            return { success: true, reused: false };
        } catch (error) {
            logger.error('浏览器启动失败:', error);
            throw error;
        }
    }

    // 预打开页面（用于登录）
    async preOpen(url) {
        if (!this.isInitialized) {
            await this.launch(false);
        }

        logger.info(`预打开页面: ${url}`);
        
        try {
            await this.page.goto(url, { 
                waitUntil: 'networkidle', 
                timeout: 60000 
            });
            
            logger.info('页面已打开，请手动完成登录');
            return { success: true, message: '页面已打开，请完成登录' };
        } catch (error) {
            logger.error('预打开失败:', error);
            throw error;
        }
    }

    // 访问URL并点击按钮
    async visitAndClick(urlRecord) {
        if (!this.isInitialized) {
            await this.launch(false);
        }

        const { url, button_selectors } = urlRecord;
        logger.info(`访问页面: ${url}`);

        try {
            // 导航到页面
            await this.page.goto(url, { 
                waitUntil: 'networkidle', 
                timeout: 60000 
            });
            
            logger.info('页面加载完成');
            
            // 等待页面稳定
            await this.page.waitForTimeout(2000);

            // 查找并点击按钮
            let clickResult = { success: true, message: '无按钮配置' };
            
            if (button_selectors && button_selectors.length > 0) {
                logger.info(`查找按钮: ${button_selectors.join(', ')}`);
                
                let clicked = false;
                for (const selector of button_selectors) {
                    try {
                        const element = await this.page.$(selector);
                        if (element) {
                            const isVisible = await element.isVisible();
                            const isEnabled = await element.isEnabled();
                            
                            if (isVisible && isEnabled) {
                                logger.info(`找到按钮: ${selector}`);
                                
                                // 滚动到按钮位置
                                await element.scrollIntoViewIfNeeded();
                                await this.page.waitForTimeout(500);
                                
                                // 点击按钮
                                await element.click();
                                logger.info('按钮点击成功');
                                
                                // 等待页面响应
                                await this.page.waitForTimeout(2000);
                                
                                clicked = true;
                                clickResult = { success: true, selector };
                                break;
                            }
                        }
                    } catch (e) {
                        logger.debug(`选择器 ${selector} 失败: ${e.message}`);
                    }
                }
                
                if (!clicked) {
                    logger.warn('未找到可点击的按钮');
                    clickResult = { success: false, error: '未找到按钮' };
                }
            }

            // 截图
            const timestamp = Date.now();
            const screenshotPath = `./logs/screenshots/task-${urlRecord.id}-${timestamp}.png`;
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            logger.info('截图已保存');

            return { 
                success: true, 
                clickResult, 
                screenshotPath,
                message: '任务执行成功'
            };

        } catch (error) {
            logger.error('访问失败:', error);
            throw error;
        }
    }

    // 获取当前页面信息
    async getPageInfo() {
        if (!this.page) return null;
        
        return {
            url: this.page.url(),
            title: await this.page.title()
        };
    }

    // 关闭浏览器
    async close() {
        if (this.browser) {
            logger.info('关闭浏览器');
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            this.isInitialized = false;
        }
    }

    // 获取状态
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            url: this.page ? this.page.url() : null
        };
    }
}

module.exports = new BrowserManager();
