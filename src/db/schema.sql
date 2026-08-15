-- 定时浏览器自动化工具数据库 schema

-- 任务表
CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,  -- 任务名称
    steps TEXT, -- JSON 数组存储多个步骤，每个步骤包含 {url, button_selectors, confirm_selectors}
    enabled BOOLEAN DEFAULT 1,
    priority INTEGER DEFAULT 0,
    daily_limit INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 访问历史记录表
CREATE TABLE IF NOT EXISTS access_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id INTEGER NOT NULL,
    access_date DATE NOT NULL,  -- 访问日期（仅日期部分）
    access_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- 精确时间戳
    success BOOLEAN DEFAULT 1,
    error_message TEXT,
    screenshot_path TEXT,
    FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE,
    UNIQUE(url_id, access_date)  -- 确保每个网址每天只有一条记录
);

-- 配置表（用于存储程序配置）
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_urls_enabled ON urls(enabled);
CREATE INDEX IF NOT EXISTS idx_urls_priority ON urls(priority);
CREATE INDEX IF NOT EXISTS idx_access_history_url_id ON access_history(url_id);
CREATE INDEX IF NOT EXISTS idx_access_history_access_date ON access_history(access_date);

-- 插入默认配置
INSERT OR IGNORE INTO config (key, value, description) VALUES
    ('browser_headless', 'true', '是否使用无头浏览器模式'),
    ('browser_timeout', '30000', '浏览器超时时间（毫秒）'),
    ('schedule_interval', '60000', '调度间隔（毫秒）'),
    ('max_retries', '2', '最大重试次数'),
    ('daily_limit', '1', '每个网址每日访问次数限制'),
    ('reset_hour', '0', '每日重置时间（0-23）');

-- 创建触发器：更新 urls 表的 updated_at 字段
CREATE TRIGGER IF NOT EXISTS update_urls_timestamp 
AFTER UPDATE ON urls 
BEGIN
    UPDATE urls SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;