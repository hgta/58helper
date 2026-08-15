const BrowserController = require('../src/services/BrowserController');
const path = require('path');
const fs = require('fs');

async function testBrowser() {
    console.log('Testing browser automation...');
    
    const browser = new BrowserController({ 
        headless: false,
        screenshotsDir: './tests/screenshots'
    });
    
    try {
        await browser.initialize();
        
        // 1. 访问 Google (或者一个已知的公开页面)
        const res = await browser.navigateTo('https://www.google.com');
        if (!res.success) {
            console.error('Failed to navigate:', res.error);
            return;
        }
        
        // 2. 截图
        await browser.takeScreenshot('google-test.png');
        
        // 3. 获取页面信息
        const info = await browser.getPageInfo();
        console.log('Page title:', info.title);
        
        console.log('Test successful!');
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await browser.close();
    }
}

testBrowser();