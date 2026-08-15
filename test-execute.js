/**
 * 测试执行脚本
 */
const BrowserController = require('./src/services/BrowserController');
const UrlModel = require('./src/models/UrlModel');
const AccessHistoryModel = require('./src/models/AccessHistoryModel');
const { getDatabase } = require('./src/db/database');

async function testExecute() {
    console.log('🧪 测试浏览器执行功能...\n');
    
    try {
        // 1. 初始化数据库
        console.log('📦 初始化数据库...');
        await getDatabase();
        console.log('✅ 数据库初始化完成\n');
        
        // 2. 获取第一个启用的URL
        console.log('📋 获取URL列表...');
        const urls = await UrlModel.getEnabled();
        console.log(`找到 ${urls.length} 个启用的URL`);
        
        if (urls.length === 0) {
            console.log('⚠️ 没有启用的URL，请先添加URL');
            process.exit(0);
        }
        
        const urlRecord = urls[0];
        console.log(`\n🎯 测试URL: ${urlRecord.url}`);
        console.log(`   选择器: ${JSON.stringify(urlRecord.button_selectors)}\n`);
        
        // 3. 创建浏览器控制器
        console.log('🌐 启动浏览器（带界面）...');
        const browserController = new BrowserController({
            headless: false,
            timeout: 30000,
            viewport: { width: 1920, height: 1080 }
        });
        
        await browserController.initialize();
        console.log('✅ 浏览器启动成功\n');
        
        // 4. 导航到页面
        console.log(`🚀 访问页面: ${urlRecord.url}`);
        const navResult = await browserController.navigateTo(urlRecord.url);
        console.log('导航结果:', navResult);
        
        if (!navResult.success) {
            throw new Error(`导航失败: ${navResult.error}`);
        }
        
        // 5. 等待页面加载
        console.log('\n⏳ 等待页面加载...');
        await browserController.waitForPageLoad({ extraWait: 3000 });
        console.log('✅ 页面加载完成\n');
        
        // 6. 查找并点击按钮
        if (urlRecord.button_selectors && urlRecord.button_selectors.length > 0) {
            console.log('🔘 查找并点击按钮...');
            console.log(`   选择器: ${urlRecord.button_selectors.join(', ')}`);
            const clickResult = await browserController.clickButton(urlRecord.button_selectors);
            console.log('点击结果:', clickResult);
        } else {
            console.log('ℹ️ 未配置按钮选择器，跳过点击');
        }
        
        // 7. 截图
        console.log('\n📸 截图...');
        const screenshot = await browserController.takeScreenshot(`test-${Date.now()}.png`);
        console.log('截图结果:', screenshot);
        
        // 8. 记录访问历史
        console.log('\n💾 记录访问历史...');
        await AccessHistoryModel.create({
            url_id: urlRecord.id,
            success: true,
            screenshot_path: screenshot.success ? screenshot.path : null
        });
        console.log('✅ 记录已保存');
        
        // 9. 等待观察
        console.log('\n⏳ 等待10秒以便观察...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // 10. 关闭浏览器
        console.log('\n🔒 关闭浏览器...');
        await browserController.close();
        console.log('✅ 浏览器已关闭');
        
        console.log('\n✅ 测试完成！');
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ 测试失败:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

testExecute();
