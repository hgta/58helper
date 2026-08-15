const { getDatabase } = require('../db/database');

class UrlModel {
    constructor() {
        this.db = null;
    }

    async init() {
        if (!this.db) {
            this.db = await getDatabase();
        }
    }

    // 创建新的任务
    async create(urlData) {
        await this.init();
        
        const {
            name = '',
            steps = [],
            enabled = 1,
            priority = 0,
            daily_limit = 1
        } = urlData;

        if (!steps || steps.length === 0) {
            throw new Error('At least one step is required');
        }

        // 确保 steps 是 JSON 字符串
        const stepsJson = typeof steps === 'string' ? steps : JSON.stringify(steps);

        try {
            const result = await this.db.run(`
                INSERT INTO urls (name, steps, enabled, priority, daily_limit)
                VALUES (?, ?, ?, ?, ?)
            `, [name, stepsJson, enabled ? 1 : 0, priority, daily_limit]);

            return this.getById(result.lastID);
        } catch (error) {
            throw error;
        }
    }

    // 根据ID获取任务
    async getById(id) {
        await this.init();
        
        const url = await this.db.get(`
            SELECT 
                id, name, steps,
                enabled, priority, daily_limit,
                created_at, updated_at
            FROM urls 
            WHERE id = ?
        `, [id]);

        if (url && url.steps) {
            try {
                url.steps = JSON.parse(url.steps);
            } catch {
                url.steps = [];
            }
        }

        return url;
    }

    // 根据名称获取任务（用于检查重复）
    async getByName(name) {
        await this.init();
        
        const url = await this.db.get(`
            SELECT 
                id, name, steps,
                enabled, priority, daily_limit,
                created_at, updated_at
            FROM urls 
            WHERE name = ?
        `, [name]);

        if (url && url.steps) {
            try {
                url.steps = JSON.parse(url.steps);
            } catch {
                url.steps = [];
            }
        }

        return url;
    }

    // 获取所有任务
    async getAll(options = {}) {
        await this.init();
        
        const { enabledOnly = false, limit = null, offset = 0 } = options;
        
        let whereClause = '';
        let params = [];
        
        if (enabledOnly) {
            whereClause = 'WHERE enabled = 1';
        }
        
        // 仅当显式传入 limit 时才加 LIMIT 子句，否则返回全部记录
        let limitClause = '';
        if (limit != null) {
            limitClause = 'LIMIT ? OFFSET ?';
            params.push(limit, offset);
        }
        
        const urls = await this.db.all(`
            SELECT 
                id, name, steps,
                enabled, priority, daily_limit,
                created_at, updated_at
            FROM urls 
            ${whereClause}
            ORDER BY priority ASC, id ASC
            ${limitClause}
        `, params);

        // 解析JSON字符串
        return urls.map(url => {
            if (url.steps) {
                try {
                    url.steps = JSON.parse(url.steps);
                } catch {
                    url.steps = [];
                }
            }
            return url;
        });
    }

    // 获取启用的任务
    async getEnabled() {
        return this.getAll({ enabledOnly: true });
    }

    // 更新任务
    async update(id, updateData) {
        await this.init();
        
        const allowedFields = ['name', 'steps', 'enabled', 'priority', 'daily_limit'];
        const updates = [];
        const params = [];

        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                updates.push(`${field} = ?`);
                
                if (field === 'steps') {
                    const steps = updateData[field];
                    params.push(typeof steps === 'string' ? steps : JSON.stringify(steps));
                } else {
                    params.push(updateData[field]);
                }
            }
        }

        if (updates.length === 0) {
            return this.getById(id);
        }

        params.push(id);

        await this.db.run(`
            UPDATE urls 
            SET ${updates.join(', ')}
            WHERE id = ?
        `, params);

        return this.getById(id);
    }

    // 删除任务
    async delete(id) {
        await this.init();
        
        // 先检查是否存在
        const url = await this.getById(id);
        if (!url) {
            throw new Error(`Task with ID ${id} not found`);
        }

        await this.db.run('DELETE FROM urls WHERE id = ?', [id]);
        
        return { deleted: true, id };
    }

    // 启用/禁用任务
    async setEnabled(id, enabled) {
        return this.update(id, { enabled: enabled ? 1 : 0 });
    }

    // 获取任务数量
    async count(options = {}) {
        await this.init();
        
        const { enabledOnly = false } = options;
        
        let whereClause = '';
        
        if (enabledOnly) {
            whereClause = 'WHERE enabled = 1';
        }
        
        const result = await this.db.get(`
            SELECT COUNT(*) as count 
            FROM urls 
            ${whereClause}
        `);
        
        return result ? result.count : 0;
    }

    // 批量导入任务
    async bulkCreate(tasksData) {
        const results = [];
        const errors = [];

        for (const taskData of tasksData) {
            try {
                const created = await this.create(taskData);
                results.push(created);
            } catch (error) {
                errors.push({
                    name: taskData.name,
                    error: error.message
                });
            }
        }

        return {
            success: results.length,
            failed: errors.length,
            results,
            errors
        };
    }
}

module.exports = new UrlModel();
