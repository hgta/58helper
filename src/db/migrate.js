#!/usr/bin/env node

const { getDatabase } = require('./database');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
    console.log('Running database migrations...');
    
    try {
        const db = await getDatabase();
        
        // 创建 migrations 表（如果不存在）
        await db.run(`
            CREATE TABLE IF NOT EXISTS migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 获取已应用的迁移
        const appliedMigrations = await db.all('SELECT name FROM migrations ORDER BY name');
        const appliedNames = appliedMigrations.map(m => m.name);
        
        console.log(`Applied migrations: ${appliedMigrations.length}`);
        
        // 查找待应用的迁移文件
        const migrationsDir = path.join(__dirname, 'migrations');
        
        if (!fs.existsSync(migrationsDir)) {
            console.log('No migrations directory found. Creating it...');
            fs.mkdirSync(migrationsDir, { recursive: true });
            
            // 创建示例迁移文件
            const exampleMigration = path.join(migrationsDir, '001_create_initial_tables.sql');
            if (!fs.existsSync(exampleMigration)) {
                fs.writeFileSync(exampleMigration, `-- Migration 001: Create initial tables
-- This is an example migration file

PRAGMA foreign_keys = OFF;

-- Your migration SQL goes here
-- Example: ALTER TABLE urls ADD COLUMN new_column TEXT;

PRAGMA foreign_keys = ON;

-- Add a comment about what this migration does
`);
                console.log('Created example migration file:', exampleMigration);
            }
        }
        
        // 获取所有迁移文件
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();
        
        let appliedCount = 0;
        
        for (const migrationFile of migrationFiles) {
            const migrationName = migrationFile.replace('.sql', '');
            
            if (!appliedNames.includes(migrationName)) {
                console.log(`Applying migration: ${migrationName}`);
                
                const migrationPath = path.join(migrationsDir, migrationFile);
                const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
                
                // 在事务中执行迁移
                await db.run('BEGIN TRANSACTION');
                
                try {
                    // 执行迁移 SQL
                    const statements = migrationSQL
                        .split(';')
                        .map(stmt => stmt.trim())
                        .filter(stmt => stmt.length > 0);
                    
                    for (const statement of statements) {
                        await db.run(statement);
                    }
                    
                    // 记录迁移
                    await db.run(
                        'INSERT INTO migrations (name) VALUES (?)',
                        [migrationName]
                    );
                    
                    await db.run('COMMIT');
                    console.log(`✓ Migration applied: ${migrationName}`);
                    appliedCount++;
                } catch (error) {
                    await db.run('ROLLBACK');
                    console.error(`✗ Failed to apply migration ${migrationName}:`, error);
                    throw error;
                }
            } else {
                console.log(`✓ Migration already applied: ${migrationName}`);
            }
        }
        
        if (appliedCount === 0) {
            console.log('No new migrations to apply.');
        } else {
            console.log(`Applied ${appliedCount} migration(s) successfully.`);
        }
        
        // 显示当前数据库状态
        const tables = await db.all(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
        `);
        
        console.log('\nCurrent database tables:');
        tables.forEach(table => {
            console.log(`  - ${table.name}`);
        });
        
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

// 如果是直接运行此脚本
if (require.main === module) {
    runMigrations();
} else {
    module.exports = { runMigrations };
}