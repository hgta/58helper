// 全局状态
let urls = [];
let serviceRunning = false;
let isExecuting = false;
let executionLogs = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadStatus();
    loadUrls();
    loadHistory();
    
    // 自动刷新状态
    setInterval(loadStatus, 3000);
    setInterval(loadHistory, 5000);
});

// 加载状态
async function loadStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('stat-total').textContent = data.data.urls.total;
            document.getElementById('stat-enabled').textContent = data.data.urls.enabled;
            document.getElementById('stat-success').textContent = data.data.today.success;
            document.getElementById('stat-failed').textContent = data.data.today.failed;
            
            serviceRunning = data.data.service.isRunning;
            updateServiceStatus();
        }
    } catch (err) {
        console.error('Failed to load status:', err);
    }
}

// 更新服务状态显示
function updateServiceStatus() {
    const indicator = document.getElementById('status-indicator');
    const text = document.getElementById('status-text');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    
    if (serviceRunning) {
        indicator.className = 'status-indicator running';
        text.textContent = '服务状态: 运行中 (自动模式)';
        btnStart.disabled = true;
        btnStop.disabled = false;
    } else {
        indicator.className = 'status-indicator stopped';
        text.textContent = '服务状态: 已停止 (手动模式)';
        btnStart.disabled = false;
        btnStop.disabled = true;
    }
}

// 加载URL列表
async function loadUrls() {
    try {
        const res = await fetch('/api/urls');
        const data = await res.json();
        
        if (data.success) {
            urls = data.data;
            renderUrls();
        }
    } catch (err) {
        console.error('Failed to load URLs:', err);
        showToast('加载失败', 'error');
    }
}

// 渲染URL列表
function renderUrls() {
    const container = document.getElementById('url-list');
    
    if (urls.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>暂无 URL，点击"添加 URL"按钮开始</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = urls.map((url, index) => `
        <div class="url-item ${url.enabled ? '' : 'disabled'}" id="url-item-${url.id}">
            <div class="url-info">
                <div class="url-title">
                    <span class="url-number">${index + 1}</span>
                    ${url.url}
                    ${url.enabled ? 
                        '<span class="badge badge-success">已启用</span>' : 
                        '<span class="badge badge-warning">已禁用</span>'}
                </div>
                ${url.button_selectors && url.button_selectors.length > 0 ? 
                    `<div class="url-selectors">${url.button_selectors.join(', ')}</div>` : 
                    '<div class="url-selectors" style="color: #999;">无按钮选择器</div>'}
                <div class="url-meta">
                    优先级: ${url.priority} | 
                    更新于: ${new Date(url.updated_at).toLocaleString()}
                </div>
                <div class="url-status" id="url-status-${url.id}"></div>
            </div>
            <div class="url-actions">
                <button class="btn btn-success btn-small" onclick="executeSingleUrl(${url.id})" title="立即执行">
                    ▶ 执行
                </button>
                <button class="btn btn-secondary btn-small" onclick="toggleUrl(${url.id}, ${url.enabled})">
                    ${url.enabled ? '禁用' : '启用'}
                </button>
                <button class="btn btn-primary btn-small" onclick="editUrl(${url.id})">编辑</button>
                <button class="btn btn-danger btn-small" onclick="deleteUrl(${url.id})">删除</button>
            </div>
        </div>
    `).join('');
}

// 加载历史记录
async function loadHistory() {
    try {
        const res = await fetch('/api/history?limit=20');
        const data = await res.json();
        
        if (data.success) {
            renderHistory(data.data);
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

// 渲染历史记录
function renderHistory(history) {
    const container = document.getElementById('history-list');
    
    if (history.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>暂无访问记录</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = history.map(h => `
        <div class="history-item">
            <div class="history-info">
                <div class="history-url">${h.url}</div>
                <div class="history-time">${new Date(h.access_time).toLocaleString()}</div>
                ${!h.success && h.error_message ? 
                    `<div class="history-error">${h.error_message}</div>` : ''}
            </div>
            <span class="badge ${h.success ? 'badge-success' : 'badge-error'}">
                ${h.success ? '成功' : '失败'}
            </span>
        </div>
    `).join('');
}

// 切换标签页
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
    
    if (tab === 'history') {
        loadHistory();
    } else if (tab === 'logs') {
        renderLogs();
    }
}

// 添加日志
function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    executionLogs.push({ timestamp, message, type });
    
    // 保持最近100条日志
    if (executionLogs.length > 100) {
        executionLogs.shift();
    }
    
    renderLogs();
}

// 渲染日志
function renderLogs() {
    const container = document.getElementById('logs-list');
    if (!container) return;
    
    if (executionLogs.length === 0) {
        container.innerHTML = '<div class="log-item log-info">等待执行...</div>';
        return;
    }
    
    container.innerHTML = executionLogs.map(log => `
        <div class="log-item log-${log.type}">
            <span class="log-time">${log.timestamp}</span>
            <span class="log-message">${log.message}</span>
        </div>
    `).join('');
    
    // 自动滚动到底部
    container.scrollTop = container.scrollHeight;
}

// 批量执行所有URL
async function executeAllUrls() {
    if (isExecuting) {
        showToast('正在执行中，请等待...', 'warning');
        return;
    }
    
    const enabledUrls = urls.filter(u => u.enabled);
    if (enabledUrls.length === 0) {
        showToast('没有启用的URL', 'warning');
        return;
    }
    
    isExecuting = true;
    executionLogs = [];
    addLog('🚀 开始批量执行任务...', 'info');
    addLog(`📋 共 ${enabledUrls.length} 个URL待执行`, 'info');
    
    // 切换到日志标签
    switchTab('logs');
    
    for (let i = 0; i < enabledUrls.length; i++) {
        const url = enabledUrls[i];
        addLog(`\n[${i + 1}/${enabledUrls.length}] 🎯 开始处理: ${url.url}`, 'info');
        
        // 高亮当前执行的URL
        document.querySelectorAll('.url-item').forEach(el => el.classList.remove('executing'));
        const urlElement = document.getElementById(`url-item-${url.id}`);
        if (urlElement) {
            urlElement.classList.add('executing');
            urlElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        updateUrlStatus(url.id, 'executing');
        
        try {
            // 使用POST方式执行，更稳定
            const result = await executeUrlWithDetails(url.id, url.url);
            if (result.success) {
                addLog(`✅ 成功: ${url.url}`, 'success');
                updateUrlStatus(url.id, 'completed');
            } else {
                addLog(`❌ 失败: ${url.url} - ${result.error}`, 'error');
                updateUrlStatus(url.id, 'failed');
            }
        } catch (err) {
            addLog(`❌ 异常: ${url.url} - ${err.message}`, 'error');
            updateUrlStatus(url.id, 'failed');
        }
        
        // 延迟3秒再执行下一个（给用户时间观察浏览器）
        if (i < enabledUrls.length - 1) {
            addLog('⏳ 等待3秒后执行下一个...', 'info');
            await sleep(3000);
        }
    }
    
    isExecuting = false;
    document.querySelectorAll('.url-item').forEach(el => el.classList.remove('executing'));
    addLog('\n🎉 批量执行完成！', 'success');
    showToast('批量执行完成！', 'success');
    
    // 刷新历史记录
    loadHistory();
    loadStatus();
}

// 执行单个URL并显示详细过程
async function executeUrlWithDetails(urlId, urlStr) {
    addLog('  📦 初始化浏览器...', 'info');
    
    try {
        const res = await fetch('/api/execute-detail', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urlId: urlId })
        });
        
        const result = await res.json();
        
        if (result.success) {
            addLog('  🌐 浏览器启动成功', 'success');
            addLog(`  🚀 访问页面: ${urlStr}`, 'info');
            addLog(`  ✅ 页面加载成功 (状态: ${result.status || 200})`, 'success');
            
            if (result.clickResult) {
                if (result.clickResult.success) {
                    addLog(`  🔘 按钮点击成功: ${result.clickResult.selector || '完成'}`, 'success');
                } else {
                    addLog(`  ⚠️ 按钮点击失败: ${result.clickResult.error}`, 'warning');
                }
            }
            
            if (result.screenshot) {
                addLog(`  📸 截图已保存`, 'success');
            }
            
            addLog('  💾 访问记录已保存', 'info');
        } else {
            addLog(`  ❌ 执行失败: ${result.error}`, 'error');
        }
        
        return result;
        
    } catch (err) {
        addLog(`  ❌ 连接错误: ${err.message}`, 'error');
        return { success: false, error: err.message };
    }
}

// 执行单个URL（简化版）
async function executeSingleUrl(id) {
    if (isExecuting) {
        showToast('正在执行批量任务，请等待...', 'warning');
        return;
    }
    
    const url = urls.find(u => u.id === id);
    if (!url) return;
    
    addLog(`开始执行: ${url.url}`, 'info');
    
    try {
        const res = await fetch('/api/execute', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urlId: id })
        });
        
        const result = await res.json();
        
        if (result.success) {
            addLog(`✅ 执行成功: ${url.url}`, 'success');
            showToast('✅ 执行成功！', 'success');
        } else {
            addLog(`❌ 执行失败: ${result.error}`, 'error');
            showToast('❌ 执行失败: ' + result.error, 'error');
        }
        
        // 刷新数据
        setTimeout(() => {
            loadHistory();
            loadStatus();
        }, 1000);
        
    } catch (err) {
        addLog(`❌ 执行异常: ${err.message}`, 'error');
        showToast('❌ 执行失败: ' + err.message, 'error');
    }
}

// 更新URL状态显示
function updateUrlStatus(urlId, status) {
    const statusEl = document.getElementById(`url-status-${urlId}`);
    if (statusEl) {
        const statusText = {
            'pending': '⏳ 等待中...',
            'executing': '🔄 执行中...',
            'completed': '✅ 已完成',
            'failed': '❌ 失败'
        };
        statusEl.textContent = statusText[status] || status;
        statusEl.className = `url-status status-${status}`;
    }
}

// 辅助函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 打开添加模态框
function openAddModal() {
    document.getElementById('modal-title').textContent = '添加 URL';
    document.getElementById('url-id').value = '';
    document.getElementById('url-form').reset();
    document.getElementById('url-modal').classList.add('show');
}

// 编辑URL
function editUrl(id) {
    const url = urls.find(u => u.id === id);
    if (!url) return;
    
    document.getElementById('modal-title').textContent = '编辑 URL';
    document.getElementById('url-id').value = url.id;
    document.getElementById('url-input').value = url.url;
    document.getElementById('selectors-input').value = (url.button_selectors || []).join('\n');
    document.getElementById('priority-input').value = url.priority;
    document.getElementById('url-modal').classList.add('show');
}

// 关闭模态框
function closeModal() {
    document.getElementById('url-modal').classList.remove('show');
}

// 保存URL
async function saveUrl(e) {
    e.preventDefault();
    
    const id = document.getElementById('url-id').value;
    const url = document.getElementById('url-input').value;
    const selectors = document.getElementById('selectors-input').value;
    const priority = document.getElementById('priority-input').value;
    
    const data = {
        url,
        button_selectors: selectors,
        priority: parseInt(priority)
    };
    
    try {
        const res = await fetch(id ? `/api/urls/${id}` : '/api/urls', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await res.json();
        
        if (result.success) {
            showToast(id ? '更新成功' : '添加成功', 'success');
            closeModal();
            loadUrls();
            loadStatus();
        } else {
            showToast(result.error || '操作失败', 'error');
        }
    } catch (err) {
        console.error('Failed to save URL:', err);
        showToast('保存失败', 'error');
    }
}

// 删除URL
async function deleteUrl(id) {
    if (!confirm('确定要删除这个 URL 吗？')) return;
    
    try {
        const res = await fetch(`/api/urls/${id}`, { method: 'DELETE' });
        const result = await res.json();
        
        if (result.success) {
            showToast('删除成功', 'success');
            loadUrls();
            loadStatus();
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (err) {
        console.error('Failed to delete URL:', err);
        showToast('删除失败', 'error');
    }
}

// 切换URL启用状态
async function toggleUrl(id, currentEnabled) {
    try {
        const res = await fetch(`/api/urls/${id}/toggle`, { method: 'POST' });
        const result = await res.json();
        
        if (result.success) {
            showToast(currentEnabled ? '已禁用' : '已启用', 'success');
            loadUrls();
            loadStatus();
        } else {
            showToast(result.error || '操作失败', 'error');
        }
    } catch (err) {
        console.error('Failed to toggle URL:', err);
        showToast('操作失败', 'error');
    }
}

// 启动服务
async function startService() {
    try {
        const res = await fetch('/api/service/start', { method: 'POST' });
        const result = await res.json();
        
        if (result.success) {
            showToast('服务已启动', 'success');
            serviceRunning = true;
            updateServiceStatus();
        } else {
            showToast(result.error || '启动失败', 'error');
        }
    } catch (err) {
        console.error('Failed to start service:', err);
        showToast('启动失败', 'error');
    }
}

// 停止服务
async function stopService() {
    try {
        const res = await fetch('/api/service/stop', { method: 'POST' });
        const result = await res.json();
        
        if (result.success) {
            showToast('服务已停止', 'success');
            serviceRunning = false;
            updateServiceStatus();
        } else {
            showToast(result.error || '停止失败', 'error');
        }
    } catch (err) {
        console.error('Failed to stop service:', err);
        showToast('停止失败', 'error');
    }
}

// 显示Toast
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 点击模态框外部关闭
document.getElementById('url-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'url-modal') {
        closeModal();
    }
});
