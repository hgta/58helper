#!/usr/bin/env node

const { Command } = require('commander');
const urlBrowserService = require('./services/UrlBrowserService');
const UrlModel = require('./models/UrlModel');
const AccessHistoryModel = require('./models/AccessHistoryModel');
const logger = require('./utils/logger');
const pkg = require('../package.json');

const program = new Command();

program
  .name('timed-url-browser-clicker')
  .description('Browser automation tool to visit URLs and click buttons on a schedule.')
  .version(pkg.version);

// 主命令: 启动服务
program
  .command('start')
  .description('Start the background service for scheduled browsing')
  .action(async () => {
    logger.info('Starting Timed URL Browser Clicker Application...');
    try {
        await urlBrowserService.initialize();
        await urlBrowserService.start();

        const handleShutdown = async (signal) => {
            logger.info(`Received ${signal} signal. Shutting down gracefully...`);
            try {
                await urlBrowserService.stop();
                logger.info('Shutdown complete. Exiting.');
                process.exit(0);
            } catch (error) {
                logger.error('Error during shutdown: %O', error);
                process.exit(1);
            }
        };

        process.on('SIGINT', () => handleShutdown('SIGINT'));
        process.on('SIGTERM', () => handleShutdown('SIGTERM'));

        setInterval(() => {
            const status = urlBrowserService.getStatus();
            logger.debug('Current Application Status: %O', status);
        }, 300000);

        logger.info('Application is up and running. Press CTRL+C to exit.');
    } catch (error) {
        logger.error('Failed to start application: %O', error);
        process.exit(1);
    }
  });

// 辅助命令: 添加 URL
program
  .command('add-url <url>')
  .description('Add a new URL to the database')
  .option('-s, --selectors <selectors...>', 'Button selectors (comma separated CSS selectors)')
  .option('-p, --priority <priority>', 'Priority (lower is higher)', parseInt, 0)
  .action(async (url, options) => {
    try {
        const urlData = {
            url,
            button_selectors: JSON.stringify(options.selectors || []),
            priority: options.priority
        };
        const created = await UrlModel.create(urlData);
        console.log(`URL added successfully: ID ${created.id}, ${created.url}`);
        process.exit(0);
    } catch (error) {
        console.error('Failed to add URL:', error.message);
        process.exit(1);
    }
  });

// 辅助命令: 列出所有 URL
program
  .command('list-urls')
  .description('List all configured URLs')
  .action(async () => {
    try {
        const urls = await UrlModel.getAll();
        console.table(urls.map(u => ({
            ID: u.id,
            Name: u.name,
            Steps: (u.steps || []).length,
            Priority: u.priority,
            Enabled: u.enabled ? 'Yes' : 'No',
            'Last Updated': u.updated_at
        })));
        process.exit(0);
    } catch (error) {
        console.error('Failed to list URLs:', error.message);
        process.exit(1);
    }
  });

// 辅助命令: 查看历史
program
  .command('history')
  .description('View recent browsing history')
  .option('-l, --limit <limit>', 'Number of records to show', parseInt, 20)
  .action(async (options) => {
    try {
        const history = await AccessHistoryModel.getToday({ limit: options.limit });
        console.table(history.map(h => ({
            Time: h.access_time,
            URL: h.url,
            Success: h.success ? '✓' : '✗',
            Error: h.error_message || '-'
        })));
        process.exit(0);
    } catch (error) {
        console.error('Failed to fetch history:', error.message);
        process.exit(1);
    }
  });

// 辅助命令: 启动 Web 管理界面
program
  .command('web')
  .description('Start the web management interface')
  .option('-p, --port <port>', 'Port to run the web server on', parseInt, 3000)
  .action(async (options) => {
    try {
      const { startWebServer } = require('./web/server');
      process.env.WEB_PORT = options.port;
      await startWebServer();
      console.log(`\n🌐 Web管理界面已启动！`);
      console.log(`📱 请在浏览器中访问: http://localhost:${options.port}`);
      console.log(`🎮 浏览器控制台: http://localhost:${options.port}/control`);
      console.log(`\n按 Ctrl+C 停止服务\n`);
    } catch (error) {
      console.error('Failed to start web server:', error.message);
      process.exit(1);
    }
  });

// 辅助命令: 启动浏览器控制台（直接进入浏览器控制界面）
program
  .command('control')
  .description('Start browser control panel')
  .option('-p, --port <port>', 'Port to run on', parseInt, 8080)
  .action(async (options) => {
    try {
      const { startWebServer } = require('./web/server');
      process.env.WEB_PORT = options.port;
      await startWebServer();
      console.log(`\n🎮 浏览器控制台已启动！`);
      console.log(`📱 请打开: http://localhost:${options.port}/control`);
      console.log(`\n功能说明：`);
      console.log(`  • 预登录：先打开浏览器完成登录，保留Cookie`);
      console.log(`  • 连续执行：浏览器保持打开，依次执行所有任务`);
      console.log(`  • 不复用：每次执行完不关闭浏览器，直接访问下一个URL`);
      console.log(`\n按 Ctrl+C 停止服务\n`);
    } catch (error) {
      console.error('Failed to start control panel:', error.message);
      process.exit(1);
    }
  });

// 辅助命令: 启动交互式浏览器应用
program
  .command('app')
  .description('Start interactive browser application')
  .action(async () => {
    try {
      const BrowserAutomationApp = require('./browser-app');
      const app = new BrowserAutomationApp();
      await app.run();
    } catch (error) {
      console.error('应用错误:', error.message);
      process.exit(1);
    }
  });

// 如果没有参数，默认显示帮助
if (process.argv.length <= 2) {
    program.help();
}

program.parse(process.argv);

// 捕获未处理的异常
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception: %O', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at: %O, reason: %O', promise, reason);
});