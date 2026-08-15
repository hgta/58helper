#!/usr/bin/env node

const { Database } = require('./database');
const path = require('path');

async function initializeDatabase() {
    console.log('Initializing database...');
    
    // 从环境变量或命令行参数获取数据库路径
    const dbPath = process.env.DATABASE_PATH || 
                   process.argv[2] || 
                   './data/browser_automation.db';
    
    console.log(`Database path: ${dbPath}`);
    
    try {
        const db = new Database(dbPath);
        await db.initialize();
        
        // 可选：插入示例数据
        if (process.argv.includes('--seed')) {
            console.log('Seeding sample data...');
            await db.seedSampleData();
        }
        
        // 验证数据库结构
        console.log('Verifying database structure...');
        const tables = await db.all(`
            SELECT name FROM sqlite_master 
            WHERE type='table' 
            ORDER BY name
        `);
        
        console.log('Tables created:');
        tables.forEach(table => {
            console.log(`  - ${table.name}`);
        });
        
        // 获取启用的网址数量
        const urls = await db.getEnabledUrls();
        console.log(`Enabled URLs: ${urls.length}`);
        
        // 获取配置
        const config = await db.all('SELECT key, value FROM config ORDER BY key');
        console.log('Configuration:');
        config.forEach(item => {
            console.log(`  - ${item.key}: ${item.value}`);
        });
        
        console.log('\nDatabase initialization completed successfully!');
        console.log('\nNext steps:');
        console.log('1. Add your URLs to the database');
        console.log('2. Run the application with: npm start');
        console.log('3. Check logs in ./logs/ directory');
        
        await db.close();
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

// 如果是直接运行此脚本
if (require.main === module) {
    initializeDatabase();
} else {
    module.exports = { initializeDatabase };
}