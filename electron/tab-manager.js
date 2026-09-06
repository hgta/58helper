const { WebContentsView } = require('electron');
const logger = require('../src/utils/logger');

/**
 * 多标签页管理器 - 基于 WebContentsView（Electron 41 中 BrowserView 已废弃）
 * 所有标签页使用默认 session，自动共享登录态（cookie/localStorage），
 * 与 Chrome/Firefox 同窗口多标签页行为一致。
 */
class TabManager {
    constructor() {
        this.tabs = new Map();
        this.activeId = null;
        this.mainWindow = null;
        this.nextId = 1;
        this.tabsHidden = false; // 模态框显示时隐藏所有标签页视图
    }

    attachTo(window) {
        this.mainWindow = window;
    }

    _renderer() {
        if (this.mainWindow && this.mainWindow.webContents && !this.mainWindow.webContents.isDestroyed()) {
            return this.mainWindow.webContents;
        }
        return null;
    }

    _send(channel, ...args) {
        const renderer = this._renderer();
        if (renderer) renderer.send(channel, ...args);
    }

    // 创建标签页：kind = 'main'（主标签页，不可关闭）| 'temp'（临时标签页）
    createTab(opts = {}) {
        const { kind = 'temp', activate = true } = opts;
        const id = String(this.nextId++);
        const view = new WebContentsView({
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: false
            }
        });
        const wc = view.webContents;
        const tab = {
            id,
            view,
            kind,
            title: kind === 'main' ? '主页' : '新标签页',
            url: '',
            closable: kind !== 'main'
        };
        this.tabs.set(id, tab);

        // 劫持 window.open / target="_blank"：跳转留在本标签页内，不弹独立窗口
        wc.setWindowOpenHandler(({ url }) => {
            wc.loadURL(url).catch((e) => {
                logger.debug(`[TabManager] 标签页内打开链接失败: ${e.message}`);
            });
            return { action: 'deny' };
        });

        // 导航事件：更新标签页元数据，仅激活标签页的 URL 转发给渲染层地址栏
        const handleNavigate = (url) => {
            tab.url = url;
            this._broadcast();
            if (this.activeId === id) this._send('browser-url-changed', url);
        };
        wc.on('did-navigate', (e, url) => handleNavigate(url));
        wc.on('did-navigate-in-page', (e, url) => handleNavigate(url));

        // 标题事件：更新标签栏显示，激活时同步窗口标题
        wc.on('page-title-updated', (e, title) => {
            tab.title = title;
            this._broadcast();
            if (this.activeId === id) this._send('browser-title-changed', title);
        });

        // 页面加载完成后：注入 Ctrl+滚轮 缩放监听；激活时同步缩放给渲染层
        wc.on('did-finish-load', async () => {
            try {
                await wc.executeJavaScript(`
                    if (!window.__zoomWheelListener) {
                        window.__zoomWheelListener = true;
                        window.__pendingZoom = 0;
                        window.addEventListener('wheel', (e) => {
                            if (e.ctrlKey) {
                                e.preventDefault();
                                window.__pendingZoom += e.deltaY > 0 ? -1 : 1;
                            }
                        }, { passive: false });
                    }
                `);
                if (this.activeId === id) {
                    const zoom = await wc.getZoomFactor();
                    this._send('zoom-changed', zoom);
                }
            } catch (e) { /* 页面可能已被销毁 */ }
        });

        if (this.mainWindow) {
            this.mainWindow.contentView.addChildView(view);
        }
        if (activate || !this.activeId) {
            this.activate(id, { silent: true });
        }
        this.updateBounds();
        this._broadcast();
        logger.info(`[TabManager] 创建标签页 ${id} (${kind})`);
        return id;
    }

    getTab(id) {
        return this.tabs.get(id) || null;
    }

    getMainTab() {
        for (const tab of this.tabs.values()) {
            if (tab.kind === 'main') return tab;
        }
        return null;
    }

    getMainWebContents() {
        const tab = this.getMainTab();
        if (!tab || tab.view.webContents.isDestroyed()) return null;
        return tab.view.webContents;
    }

    getActiveWebContents() {
        const tab = this.tabs.get(this.activeId);
        if (!tab || tab.view.webContents.isDestroyed()) return null;
        return tab.view.webContents;
    }

    getAllWebContents() {
        const list = [];
        for (const tab of this.tabs.values()) {
            if (!tab.view.webContents.isDestroyed()) list.push(tab.view.webContents);
        }
        return list;
    }

    // 激活标签页：仅激活的视图可见；同步地址栏/标题/缩放到渲染层
    activate(id, opts = {}) {
        const { silent = false } = opts;
        const tab = this.tabs.get(id);
        if (!tab) return false;
        this.activeId = id;
        for (const t of this.tabs.values()) {
            t.view.setVisible(!this.tabsHidden && t.id === id);
        }
        if (!silent) {
            const wc = tab.view.webContents;
            if (!wc.isDestroyed()) {
                this._send('browser-url-changed', wc.getURL());
                this._send('browser-title-changed', wc.getTitle());
                wc.getZoomFactor().then((zoom) => this._send('zoom-changed', zoom)).catch(() => {});
            }
        }
        this._broadcast();
        return true;
    }

    // 关闭标签页（主标签页不可关闭）；关闭后激活主标签页
    closeTab(id) {
        const tab = this.tabs.get(id);
        if (!tab) return { success: false, error: '标签页不存在' };
        if (!tab.closable) return { success: false, error: '主标签页不可关闭' };

        this._removeTab(tab);

        if (this.activeId === id) {
            const main = this.getMainTab();
            const target = main || [...this.tabs.values()].pop();
            if (target) this.activate(target.id);
        }
        this._broadcast();
        logger.info(`[TabManager] 关闭标签页 ${id}`);
        return { success: true };
    }

    _removeTab(tab) {
        this.tabs.delete(tab.id);
        try {
            if (this.mainWindow) {
                this.mainWindow.contentView.removeChildView(tab.view);
            }
            if (!tab.view.webContents.isDestroyed()) {
                tab.view.webContents.close();
            }
        } catch (e) {
            logger.debug(`[TabManager] 关闭标签页异常: ${e.message}`);
        }
    }

    // 设置标签页标题（裂变执行时显示进度，页面导航事件会覆盖为真实页面标题）
    setTabTitle(id, title) {
        const tab = this.tabs.get(id);
        if (!tab) return;
        tab.title = title;
        this._broadcast();
    }

    // 模态框显示/隐藏时隐藏/恢复所有标签页视图
    setTabsHidden(hidden) {
        this.tabsHidden = hidden;
        for (const t of this.tabs.values()) {
            t.view.setVisible(!hidden && t.id === this.activeId);
        }
    }

    // 更新所有标签页视图位置（左侧控制面板 280px，顶部工具栏 42px + 标签栏 34px）
    updateBounds() {
        if (!this.mainWindow) return;
        const { width, height } = this.mainWindow.getContentBounds();
        const bounds = {
            x: 280,
            y: 76,
            width: Math.max(0, width - 280),
            height: Math.max(0, height - 76)
        };
        for (const t of this.tabs.values()) {
            t.view.setBounds(bounds);
        }
    }

    getState() {
        return {
            tabs: [...this.tabs.values()].map((t) => ({
                id: t.id,
                kind: t.kind,
                title: t.title,
                url: t.url,
                closable: t.closable
            })),
            activeId: this.activeId
        };
    }

    _broadcast() {
        this._send('tabs-changed', this.getState());
    }
}

module.exports = TabManager;
