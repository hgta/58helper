/**
 * 浏览器自动化应用 - 主入口
 * 提供图形界面控制浏览器，支持预登录和连续任务执行
 */
const { chromium } = require('playwright');
const { getDatabase } = require('./db/database');
const UrlModel = require('./models/UrlModel');
const AccessHistoryModel = require('./models/AccessHistoryModel');
const logger = require('./utils/logger');

class BrowserAutomationApp {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.isRunning = false;
        this.taskQueue = [];
        this.currentTaskIndex = 0;
        this.statusCallback = null;
    }

    // 初始化数据库
    async initDatabase() {
        console.log('📦 初始化数据库...');
        await getDatabase();
        console.log('✅ 数据库已连接');
    }

    // 启动浏览器（不关闭，复用）
    async launchBrowser() {
        if (this.browser) {
            console.log('🌐 浏览器已在运行');
            return;
        }

        console.log('🌐 启动浏览器...');
        this.browser = await chromium.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1920,1080',
                '--window-position=100,100'
            ]
        });
        
        // 创建持久化上下文（保留cookie）
        this.context = await this.browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        this.page = await this.context.newPage();
        
        // 监听页面事件
        this.page.on('console', msg => {
            console.log(`[页面日志] ${msg.type()}: ${msg.text()}`);
        });
        
        this.page.on('pageerror', error => {
            console.log(`[页面错误] ${error.message}`);
        });
        
        console.log('✅ 浏览器启动成功');
        if (this.statusCallback) this.statusCallback('browser_ready');
    }

    // 预打开某个URL（用于登录）
    async preOpenUrl(url) {
        if (!this.browser) {
            await this.launchBrowser();
        }

        console.log(`\n🔓 预打开页面: ${url}`);
        console.log('💡 请在此页面完成登录操作，完成后按回车继续...\n');
        
        await this.page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        
        // 等待用户手动操作
        await this.waitForUserInput('登录完成后按回车键继续...');
        
        console.log('✅ 预登录完成，cookie已保存');
    }

    // 执行单个任务
    async executeTask(urlRecord) {
        if (!this.browser) {
            await this.launchBrowser();
        }

        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`🎯 执行任务: ${urlRecord.url}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

        try {
            // 检查今日是否已访问
            const hasAccessed = await AccessHistoryModel.hasAccessedToday(urlRecord.id);
            if (hasAccessed && !this.forceMode) {
                console.log('⏭️ 今日已访问过，跳过（按 F 强制重新执行）');
                return { success: true, skipped: true };
            }

            // 在同一个页面导航（不关闭浏览器）
            console.log('🌐 正在打开页面...');
            await this.page.goto(urlRecord.url, { 
                waitUntil: 'networkidle', 
                timeout: 60000 
            });
            console.log('✅ 页面加载完成');

            // 等待页面稳定
            await this.page.waitForTimeout(2000);

            // 查找并点击按钮
            let clickResult = { success: true, message: '无按钮配置' };
            if (urlRecord.button_selectors && urlRecord.button_selectors.length > 0) {
                console.log(`🔘 查找按钮: ${urlRecord.button_selectors.join(', ')}`);
                
                let clicked = false;
                for (const selector of urlRecord.button_selectors) {
                    try {
                        const element = await this.page.$(selector);
                        if (element) {
                            const isVisible = await element.isVisible();
                            const isEnabled = await element.isEnabled();
                            
                            if (isVisible && isEnabled) {
                                console.log(`   找到按钮: ${selector}`);
                                
                                // 滚动到按钮位置
                                await element.scrollIntoViewIfNeeded();
                                await this.page.waitForTimeout(500);
                                
                                // 点击按钮
                                await element.click();
                                console.log('   ✅ 按钮点击成功');
                                
                                // 等待页面响应
                                await this.page.waitForTimeout(2000);
                                
                                clicked = true;
                                clickResult = { success: true, selector };
                                break;
                            }
                        }
                    } catch (e) {
                        console.log(`   选择器 ${selector} 失败: ${e.message}`);
                    }
                }
                
                if (!clicked) {
                    console.log('   ⚠️ 未找到可点击的按钮');
                    clickResult = { success: false, error: '未找到按钮' };
                }
            }

            // 截图
            console.log('📸 正在截图...');
            const timestamp = Date.now();
            const screenshotPath = `./logs/screenshots/task-${urlRecord.id}-${timestamp}.png`;
            await this.page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`   ✅ 截图已保存`);

            // 记录访问
            await AccessHistoryModel.create({
                url_id: urlRecord.id,
                success: clickResult.success,
                error_message: clickResult.success ? null : clickResult.error,
                screenshot_path: screenshotPath
            });
            console.log('💾 访问记录已保存');

            return { success: true, clickResult, screenshotPath };

        } catch (error) {
            console.error(`❌ 执行失败: ${error.message}`);
            
            await AccessHistoryModel.create({
                url_id: urlRecord.id,
                success: false,
                error_message: error.message
            });
            
            return { success: false, error: error.message };
        }
    }

    // 批量执行所有任务
    async executeAll(options = {}) {
        this.forceMode = options.force || false;
        
        if (this.isRunning) {
            console.log('⚠️ 正在执行中...');
            return;
        }

        this.isRunning = true;
        
        try {
            const urls = await UrlModel.getEnabled();
            console.log(`\n🚀 开始批量执行，共 ${urls.length} 个任务`);
            console.log('💡 浏览器将保持打开状态，连续执行所有任务\n');

            for (let i = 0; i < urls.length; i++) {
                console.log(`\n[${i + 1}/${urls.length}]`);
                const result = await this.executeTask(urls[i]);
                
                if (result.skipped) continue;
                
                // 任务间隔
                if (i < urls.length - 1) {
                    console.log('\n⏳ 等待3秒后执行下一个...');
                    await this.sleep(3000);
                }
            }

            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✅ 所有任务执行完成！');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        } finally {
            this.isRunning = false;
        }
    }

    // 关闭浏览器
    async closeBrowser() {
        if (this.browser) {
            console.log('\n🔒 关闭浏览器...');
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
            console.log('✅ 浏览器已关闭');
        }
    }

    // 等待用户输入
    waitForUserInput(prompt) {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise(resolve => {
            rl.question(prompt, () => {
                rl.close();
                resolve();
            });
        });
    }

    // 睡眠
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 显示交互菜单
    async showMenu() {
        console.log('\n');
        console.log('╔══════════════════════════════════════╗');
        console.log('║     🤖 浏览器自动化工具 v2.0         ║');
        console.log('╠══════════════════════════════════════╣');
        console.log('║  1. 🌐 启动浏览器（预登录）          ║');
        console.log('║  2. 🚀 执行所有任务（连续浏览）      ║');
        console.log('║  3. 🔄 强制重新执行所有任务          ║');
        console.log('║  4. 📋 查看任务列表                  ║');
        console.log('║  5. 📊 查看访问历史                  ║');
        console.log('║  6. ➕ 添加新任务                    ║');
        console.log('║  0. ❌ 退出并关闭浏览器              ║');
        console.log('╚══════════════════════════════════════╝');
        console.log('');
    }

    // 运行应用
    async run() {
        await this.initDatabase();
        
        console.log('\n');
        console.log('╔════════════════════════════════════════════════════╗');
        console.log('║                                                    ║');
        console.log('║        🤖 浏览器自动化工具 v2.0                    ║');
        console.log('║                                                    ║');
        console.log('║   支持预登录、浏览器复用、连续任务执行             ║');
        console.log('║                                                    ║');
        console.log('╚════════════════════════════════════════════════════╝');

        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const askQuestion = () => {
            return new Promise(resolve => {
                rl.question('请选择操作 (0-6): ', (answer) => {
                    resolve(answer.trim());
                });
            });
        };

        while (true) {
            await this.showMenu();
            const choice = await askQuestion();

            switch (choice) {
                case '1':
                    console.log('\n🌐 预登录模式');
                    console.log('请输入要预打开的URL（用于登录）：');
                    const preUrl = await new Promise(resolve => {
                        rl.question('URL: ', resolve);
                    });
                    if (preUrl.trim()) {
                        await this.preOpenUrl(preUrl.trim());
                    }
                    break;

                case '2':
                    await this.executeAll();
                    break;

                case '3':
                    await this.executeAll({ force: true });
                    break;

                case '4':
                    await this.showTaskList();
                    break;

                case '5':
                    await this.showHistory();
                    break;

                case '6':
                    await this.addNewTask(rl);
                    break;

                case '0':
                    console.log('\n👋 感谢使用，再见！');
                    await this.closeBrowser();
                    rl.close();
                    process.exit(0);

                default:
                    console.log('\n⚠️ 无效的选择');
            }
        }
    }

    // 显示任务列表
    async showTaskList() {
        const urls = await UrlModel.getAll();
        console.log('\n📋 任务列表：');
        console.log('');
        urls.forEach((url, i) => {
            const status = url.enabled ? '✅' : '❌';
            console.log(`  ${i + 1}. ${status} ${url.url}`);
            console.log(`     选择器: ${(url.button_selectors || []).join(', ') || '无'}`);
            console.log('');
        });
    }

    // 显示访问历史
    async showHistory() {
        const history = await AccessHistoryModel.getToday({ limit: 20 });
        console.log('\n📊 今日访问历史：');
        console.log('');
        if (history.length === 0) {
            console.log('  暂无记录');
        } else {
            history.forEach((h, i) => {
                const status = h.success ? '✅' : '❌';
                console.log(`  ${i + 1}. ${status} ${h.url} - ${h.access_time}`);
            });
        }
        console.log('');
    }

    // 添加新任务
    async addNewTask(rl) {
        console.log('\n➕ 添加新任务');
        
        const url = await new Promise(resolve => {
            rl.question('URL: ', resolve);
        });
        
        const selectors = await new Promise(resolve => {
            rl.question('按钮选择器（多个用逗号分隔）: ', resolve);
        });
        
        const priority = await new Promise(resolve => {
            rl.question('优先级（1-100，默认1）: ', (answer) => {
                resolve(answer.trim() || '1');
            });
        });

        try {
            await UrlModel.create({
                url: url.trim(),
                button_selectors: selectors.split(',').map(s => s.trim()).filter(s => s),
                priority: parseInt(priority),
                enabled: 1
            });
            console.log('✅ 任务添加成功！');
        } catch (error) {
            console.error('❌ 添加失败:', error.message);
        }
    }
}

// 导出类
module.exports = BrowserAutomationApp;

// 如果直接运行此文件，则启动应用
if (require.main === module) {
    const app = new BrowserAutomationApp();
    app.run().catch(err => {
        console.error('应用错误:', err);
        process.exit(1);
    });
}
