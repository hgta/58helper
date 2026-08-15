const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor(dbPath = './data/browser_automation.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    // 初始化数据库
    async initialize() {
        try {
            // 确保数据目录存在
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // 创建数据库连接
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error connecting to database:', err.message);
                    throw err;
                }
                console.log('Connected to SQLite database:', this.dbPath);
            });

            // 启用外键约束
            await this.run('PRAGMA foreign_keys = ON');
            
            // 创建表结构
            await this.createTables();
            
            // 运行数据库迁移
            await this.runMigrations();
            
            console.log('Database initialized successfully');
            return this;
        } catch (error) {
            console.error('Failed to initialize database:', error);
            throw error;
        }
    }

    // 创建所有表
    async createTables() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Schema file not found: ${schemaPath}`);
        }

        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // 使用 exec 一次性执行所有语句，支持触发器等复杂结构
        return new Promise((resolve, reject) => {
            this.db.exec(schema, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    // 运行数据库迁移
    async runMigrations() {
        try {
            const tableInfo = await this.all(`PRAGMA table_info(urls)`);
            
            // 检查是否存在 steps 列（新结构）
            const hasSteps = tableInfo.some(col => col.name === 'steps');
            
            if (!hasSteps) {
                console.log('Running migration: Converting to multi-step task structure');
                
                // 获取现有数据
                const existingData = await this.all(`SELECT * FROM urls`);
                
                // 创建新表结构
                await this.run(`
                    CREATE TABLE IF NOT EXISTS urls_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT,
                        steps TEXT,
                        enabled BOOLEAN DEFAULT 1,
                        priority INTEGER DEFAULT 0,
                        daily_limit INTEGER DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                
                // 转换旧数据到新结构
                for (const row of existingData) {
                    const step = {
                        url: row.url || '',
                        button_selectors: row.button_selectors ? JSON.parse(row.button_selectors) : [],
                        confirm_selectors: row.confirm_selectors ? JSON.parse(row.confirm_selectors) : []
                    };
                    
                    await this.run(`
                        INSERT INTO urls_new (id, name, steps, enabled, priority, daily_limit, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [row.id, row.name, JSON.stringify([step]), row.enabled, row.priority, row.daily_limit, row.created_at, row.updated_at]);
                }
                
                await this.run(`DROP TABLE urls`);
                await this.run(`ALTER TABLE urls_new RENAME TO urls`);
                console.log('Migration completed: Multi-step task structure ready');
            }
        } catch (error) {
            console.log('Migration check skipped:', error.message);
        }
    }

    // 执行 SQL 语句（返回 Promise）
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        });
    }

    // 查询单条记录
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // 查询多条记录
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // 关闭数据库连接
    close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        console.log('Database connection closed');
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }

    // 插入示例数据
    async seedSampleData() {
        try {
            // 插入示例网址
            const sampleUrls = [
                {
                    url: 'https://example.com/page1',
                    button_selectors: JSON.stringify(['.btn-primary', '#submit-button']),
                    enabled: 1,
                    priority: 1
                },
                {
                    url: 'https://example.com/page2',
                    button_selectors: JSON.stringify(["button[type='submit']"]),
                    enabled: 1,
                    priority: 2
                }
            ];

            for (const urlData of sampleUrls) {
                await this.run(`
                    INSERT OR IGNORE INTO urls (url, button_selectors, enabled, priority)
                    VALUES (?, ?, ?, ?)
                `, [urlData.url, urlData.button_selectors, urlData.enabled, urlData.priority]);
            }

            console.log('Sample data seeded successfully');
        } catch (error) {
            console.error('Failed to seed sample data:', error);
        }
    }

    // 获取所有启用的网址
    async getEnabledUrls() {
        return this.all(`
            SELECT id, url, button_selectors, priority, daily_limit
            FROM urls 
            WHERE enabled = 1 
            ORDER BY priority ASC, id ASC
        `);
    }

    // 检查网址今天是否已访问
    async hasAccessedToday(urlId) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const result = await this.get(`
            SELECT COUNT(*) as count 
            FROM access_history 
            WHERE url_id = ? AND access_date = ?
        `, [urlId, today]);
        
        return result.count > 0;
    }

    // 记录访问历史
    async recordAccess(urlId, success = true, errorMessage = null, screenshotPath = null) {
        const today = new Date().toISOString().split('T')[0];
        
        try {
            // 先删除今天可能存在的旧记录（确保唯一约束）
            await this.run(`
                DELETE FROM access_history 
                WHERE url_id = ? AND access_date = ?
            `, [urlId, today]);

            // 插入新记录
            await this.run(`
                INSERT INTO access_history 
                (url_id, access_date, success, error_message, screenshot_path)
                VALUES (?, ?, ?, ?, ?)
            `, [urlId, today, success ? 1 : 0, errorMessage, screenshotPath]);

            console.log(`Access recorded for URL ID ${urlId} on ${today}`);
        } catch (error) {
            console.error('Failed to record access:', error);
            throw error;
        }
    }

    // 获取配置值
    async getConfig(key) {
        const result = await this.get(
            'SELECT value FROM config WHERE key = ?',
            [key]
        );
        return result ? result.value : null;
    }

    // 更新配置值
    async setConfig(key, value) {
        await this.run(`
            INSERT OR REPLACE INTO config (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `, [key, value]);
    }
}

// 创建单例实例
let databaseInstance = null;

async function getDatabase() {
    if (!databaseInstance) {
        databaseInstance = new Database();
        await databaseInstance.initialize();
    }
    return databaseInstance;
}

module.exports = {
    Database,
    getDatabase
};