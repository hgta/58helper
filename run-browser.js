/**
 * 直接执行浏览器任务 - 显示界面
 */
const { chromium } = require('playwright');
const { getDatabase } = require('./src/db/database');
const UrlModel = require('./src/models/UrlModel');
const AccessHistoryModel = require('./src/models/AccessHistoryModel');

async function runBrowser() {
    console.log('🚀 启动浏览器自动化工具...\n');
    
    let browser = null;
    
    try {
        // 1. 初始化数据库
        console.log('📦 连接数据库...');
        await getDatabase();
        
        // 2. 获取启用的URL
        console.log('📋 获取任务列表...');
        const urls = await UrlModel.getEnabled();
        console.log(`✅ 找到 ${urls.length} 个任务\n`);
        
        if (urls.length === 0) {
            console.log('⚠️ 没有启用的任务，请先添加URL');
            process.exit(0);
        }
        
        // 3. 启动浏览器（显示界面）
        console.log('🌐 启动浏览器（带界面）...');
        browser = await chromium.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log('✅ 浏览器已启动\n');
        
        // 4. 逐个执行任务
        for (let i = 0; i < urls.length; i++) {
            const urlRecord = urls[i];
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`[${i + 1}/${urls.length}] 🎯 ${urlRecord.url}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            
            try {
                // 检查今日是否已访问（强制模式则跳过检查）
                const forceMode = process.argv.includes('--force');
                if (!forceMode) {
                    const hasAccessed = await AccessHistoryModel.hasAccessedToday(urlRecord.id);
                    if (hasAccessed) {
                        console.log('⏭️ 今日已访问过，跳过（使用 --force 强制重新执行）');
                        continue;
                    }
                } else {
                    console.log('⚡ 强制模式：忽略今日访问记录');
                }
                
                // 创建新页面
                const context = await browser.newContext({
                    viewport: { width: 1920, height: 1080 }
                });
                const page = await context.newPage();
                
                // 访问页面
                console.log('🌐 正在打开页面...');
                await page.goto(urlRecord.url, { waitUntil: 'networkidle', timeout: 30000 });
                console.log('✅ 页面加载完成');
                
                // 等待一下让用户看到页面
                await page.waitForTimeout(2000);
                
                // 点击按钮
                if (urlRecord.button_selectors && urlRecord.button_selectors.length > 0) {
                    console.log(`🔘 查找按钮: ${urlRecord.button_selectors.join(', ')}`);
                    
                    let clicked = false;
                    for (const selector of urlRecord.button_selectors) {
                        try {
                            const element = await page.$(selector);
                            if (element) {
                                const isVisible = await element.isVisible();
                                if (isVisible) {
                                    console.log(`   找到按钮: ${selector}`);
                                    await element.click();
                                    console.log('   ✅ 按钮点击成功');
                                    clicked = true;
                                    break;
                                }
                            }
                        } catch (e) {
                            console.log(`   选择器 ${selector} 未找到`);
                        }
                    }
                    
                    if (!clicked) {
                        console.log('   ⚠️ 未找到可点击的按钮');
                    }
                }
                
                // 截图
                console.log('📸 正在截图...');
                const timestamp = Date.now();
                const screenshotPath = `./logs/screenshots/task-${urlRecord.id}-${timestamp}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`   ✅ 截图已保存: ${screenshotPath}`);
                
                // 记录访问
                await AccessHistoryModel.create({
                    url_id: urlRecord.id,
                    success: true,
                    screenshot_path: screenshotPath
                });
                console.log('💾 访问记录已保存');
                
                // 等待观察
                console.log('⏳ 等待5秒...');
                await page.waitForTimeout(5000);
                
                // 关闭页面
                await context.close();
                
            } catch (error) {
                console.error(`❌ 执行失败: ${error.message}`);
                await AccessHistoryModel.create({
                    url_id: urlRecord.id,
                    success: false,
                    error_message: error.message
                });
            }
            
            // 任务间隔
            if (i < urls.length - 1) {
                console.log('\n⏳ 等待3秒后执行下一个任务...');
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ 所有任务执行完成！');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
    } catch (error) {
        console.error('\n❌ 错误:', error.message);
    } finally {
        if (browser) {
            console.log('🔒 关闭浏览器...');
            await browser.close();
        }
        process.exit(0);
    }
}

runBrowser();
