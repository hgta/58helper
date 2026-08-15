const path = require('path');
const fs = require('fs');

/**
 * 解析应用数据目录。
 *
 * - 在 Electron 打包环境下，使用系统用户数据目录（app.getPath('userData')），
 *   避免写入 Program Files / .app 等只读目录。
 * - 在普通 Node.js 命令行环境下，回退到 process.cwd()，保持原有行为。
 */
function getAppRoot() {
    try {
        const { app } = require('electron');
        if (app && typeof app.getPath === 'function') {
            return app.getPath('userData');
        }
    } catch (e) {
        // 非 Electron 环境，忽略
    }
    return process.cwd();
}

/** 确保目录存在并返回绝对路径 */
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/** 数据根目录（数据库、日志、截图等） */
function getDataDir() {
    return ensureDir(getAppRoot());
}

/** 数据库文件路径 */
function getDatabasePath() {
    return path.join(getDataDir(), 'browser_automation.db');
}

/** 日志目录 */
function getLogsDir() {
    return ensureDir(path.join(getDataDir(), 'logs'));
}

/** 截图目录 */
function getScreenshotsDir() {
    return ensureDir(path.join(getDataDir(), 'logs', 'screenshots'));
}

module.exports = {
    getAppRoot,
    getDataDir,
    getDatabasePath,
    getLogsDir,
    getScreenshotsDir,
    ensureDir
};
