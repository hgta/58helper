const { getDatabase } = require('../db/database');

class AccessHistoryModel {
    constructor() {
        this.db = null;
    }

    async init() {
        if (!this.db) {
            this.db = await getDatabase();
        }
    }

    // 创建访问记录
    async create(historyData) {
        await this.init();
        
        const {
            url_id,
            success = true,
            error_message = null,
            screenshot_path = null
        } = historyData;

        if (!url_id) {
            throw new Error('url_id is required');
        }

        const access_date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        try {
            // 先删除今天可能存在的旧记录（确保唯一约束）
            await this.db.run(`
                DELETE FROM access_history 
                WHERE url_id = ? AND access_date = ?
            `, [url_id, access_date]);

            // 插入新记录
            const result = await this.db.run(`
                INSERT INTO access_history 
                (url_id, access_date, success, error_message, screenshot_path)
                VALUES (?, ?, ?, ?, ?)
            `, [url_id, access_date, success ? 1 : 0, error_message, screenshot_path]);

            return this.getById(result.lastID);
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                // 理论上不会发生，因为我们已经删除了旧记录
                throw new Error(`Access record already exists for URL ${url_id} on ${access_date}`);
            }
            throw error;
        }
    }

    // 根据ID获取访问记录
    async getById(id) {
        await this.init();
        
        const history = await this.db.get(`
            SELECT 
                ah.id, ah.url_id, ah.access_date, ah.access_time,
                ah.success, ah.error_message, ah.screenshot_path,
                u.name as task_name
            FROM access_history ah
            LEFT JOIN urls u ON ah.url_id = u.id
            WHERE ah.id = ?
        `, [id]);

        return history;
    }

    // 获取网址的所有访问记录
    async getByUrlId(urlId, options = {}) {
        await this.init();
        
        const { limit = 100, offset = 0, dateFrom = null, dateTo = null } = options;
        
        let whereClause = 'WHERE ah.url_id = ?';
        const params = [urlId];
        
        if (dateFrom) {
            whereClause += ' AND ah.access_date >= ?';
            params.push(dateFrom);
        }
        
        if (dateTo) {
            whereClause += ' AND ah.access_date <= ?';
            params.push(dateTo);
        }
        
        const history = await this.db.all(`
            SELECT 
                ah.id, ah.url_id, ah.access_date, ah.access_time,
                ah.success, ah.error_message, ah.screenshot_path,
                u.name as task_name
            FROM access_history ah
            LEFT JOIN urls u ON ah.url_id = u.id
            ${whereClause}
            ORDER BY ah.access_time DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        return history;
    }

    // 获取今天的访问记录
    async getToday(options = {}) {
        await this.init();
        
        const { successOnly = false, limit = 100, offset = 0 } = options;
        
        const today = new Date().toISOString().split('T')[0];
        
        let whereClause = 'WHERE ah.access_date = ?';
        const params = [today];
        
        if (successOnly) {
            whereClause += ' AND ah.success = 1';
        }
        
        const history = await this.db.all(`
            SELECT 
                ah.id, ah.url_id, ah.access_date, ah.access_time,
                ah.success, ah.error_message, ah.screenshot_path,
                u.name as task_name
            FROM access_history ah
            LEFT JOIN urls u ON ah.url_id = u.id
            ${whereClause}
            ORDER BY ah.access_time DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        return history;
    }

    // 获取指定日期的访问记录
    async getByDate(date, options = {}) {
        await this.init();
        
        const { successOnly = false, limit = 100, offset = 0 } = options;
        
        let whereClause = 'WHERE ah.access_date = ?';
        const params = [date];
        
        if (successOnly) {
            whereClause += ' AND ah.success = 1';
        }
        
        const history = await this.db.all(`
            SELECT 
                ah.id, ah.url_id, ah.access_date, ah.access_time,
                ah.success, ah.error_message, ah.screenshot_path,
                u.url as url
            FROM access_history ah
            LEFT JOIN urls u ON ah.url_id = u.id
            ${whereClause}
            ORDER BY ah.access_time DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        return history;
    }

    // 检查网址今天是否已访问
    async hasAccessedToday(urlId) {
        await this.init();
        return this.db.hasAccessedToday(urlId);
    }

    // 获取访问统计
    async getStats(options = {}) {
        await this.init();
        
        const { dateFrom = null, dateTo = null, groupBy = 'day' } = options;
        
        let whereClause = '';
        const params = [];
        
        if (dateFrom) {
            whereClause += ' WHERE access_date >= ?';
            params.push(dateFrom);
        }
        
        if (dateTo) {
            whereClause += (whereClause ? ' AND' : ' WHERE') + ' access_date <= ?';
            params.push(dateTo);
        }
        
        let groupByClause = '';
        if (groupBy === 'day') {
            groupByClause = 'GROUP BY access_date';
        } else if (groupBy === 'url') {
            groupByClause = 'GROUP BY url_id';
        }
        
        const stats = await this.db.all(`
            SELECT 
                ${groupBy === 'day' ? 'access_date as date' : 'url_id'},
                COUNT(*) as total_visits,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_visits,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_visits,
                MIN(access_time) as first_visit,
                MAX(access_time) as last_visit
            FROM access_history
            ${whereClause}
            ${groupByClause}
            ORDER BY ${groupBy === 'day' ? 'access_date DESC' : 'total_visits DESC'}
        `, params);

        return stats;
    }

    // 删除访问记录
    async delete(id) {
        await this.init();
        
        // 先检查是否存在
        const history = await this.getById(id);
        if (!history) {
            throw new Error(`Access history with ID ${id} not found`);
        }

        await this.db.run('DELETE FROM access_history WHERE id = ?', [id]);
        
        return { deleted: true, id };
    }

    // 清理旧记录
    async cleanup(daysToKeep = 30) {
        await this.init();
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
        
        const result = await this.db.run(`
            DELETE FROM access_history 
            WHERE access_date < ?
        `, [cutoffDateStr]);
        
        return {
            deleted: result.changes,
            cutoff_date: cutoffDateStr
        };
    }

    // 获取最近失败的访问
    async getRecentFailures(limit = 10) {
        await this.init();
        
        const failures = await this.db.all(`
            SELECT 
                ah.id, ah.url_id, ah.access_date, ah.access_time,
                ah.error_message, ah.screenshot_path,
                u.name as task_name
            FROM access_history ah
            LEFT JOIN urls u ON ah.url_id = u.id
            WHERE ah.success = 0
            ORDER BY ah.access_time DESC
            LIMIT ?
        `, [limit]);

        return failures;
    }
}

module.exports = new AccessHistoryModel();