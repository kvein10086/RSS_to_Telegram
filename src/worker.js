/**
 * RSS Telegram 推送平台
 * 基于 Cloudflare Workers 的 RSS 订阅和 Telegram 推送服务
 * 
 * 安全和性能优化版本
 */

// 配置常量
const CONFIG = {
    MAX_RSS_SOURCES: 50,
    MAX_RSS_CONTENT_SIZE: 5 * 1024 * 1024, // 5MB
    MAX_DESCRIPTION_LENGTH: 200,
    TELEGRAM_RATE_LIMIT_DELAY: 1000,
    RSS_FETCH_TIMEOUT: 30000,
    MAX_CONCURRENT_RSS_CHECKS: 5,
    BOT_TOKEN_PATTERN: /^\d+:[A-Za-z0-9_-]{35}$/,
    CHAT_ID_PATTERN: /^-?\d+$/,
    ALLOWED_PROTOCOLS: ['http:', 'https:']
};

// 工具函数
const Utils = {
    // 安全的 HTML 转义
    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    // 验证 Bot Token 格式
    validateBotToken(token) {
        return typeof token === 'string' && CONFIG.BOT_TOKEN_PATTERN.test(token);
    },

    // 验证 Chat ID 格式
    validateChatId(chatId) {
        return typeof chatId === 'string' && CONFIG.CHAT_ID_PATTERN.test(chatId);
    },

    // 验证 URL 安全性
    validateUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return CONFIG.ALLOWED_PROTOCOLS.includes(parsedUrl.protocol) &&
                   !parsedUrl.hostname.match(/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|localhost$)/);
        } catch {
            return false;
        }
    },

    // 创建标准 JSON 响应
    createJsonResponse(data, status = 200, headers = {}) {
        return new Response(JSON.stringify(data), {
            status,
            headers: {
                'Content-Type': 'application/json',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                ...headers
            }
        });
    },

    // 脱敏 Bot Token
    maskBotToken(token) {
        if (!token || token.length < 10) return '***';
        return token.substring(0, 8) + '***' + token.substring(token.length - 4);
    },

    // 限制并发执行
    async limitConcurrency(tasks, limit) {
        const results = [];
        for (let i = 0; i < tasks.length; i += limit) {
            const batch = tasks.slice(i, i + limit);
            const batchResults = await Promise.allSettled(batch);
            results.push(...batchResults);
        }
        return results;
    }
};

// Web 管理界面 HTML
const WEB_INTERFACE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RSS Telegram 推送平台</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .card { background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 10px; }
        h2 { color: #555; margin-bottom: 15px; border-bottom: 2px solid #007bff; padding-bottom: 5px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: 500; color: #333; }
        input, textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; margin-right: 10px; }
        button:hover { background: #0056b3; }
        button.danger { background: #dc3545; }
        button.danger:hover { background: #c82333; }
        .rss-item { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 10px; border-left: 4px solid #007bff; }
        .status { padding: 10px; border-radius: 5px; margin-bottom: 15px; }
        .status.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .status.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .hidden { display: none; }
        .test-section { background: #e7f3ff; border-left: 4px solid #007bff; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 RSS Telegram 推送平台</h1>
            <p>轻松管理您的 RSS 订阅，自动推送到 Telegram</p>
        </div>

        <div id="status" class="status hidden"></div>

        <!-- Telegram 配置 -->
        <div class="card">
            <h2>📱 Telegram 配置</h2>
            <div class="form-group">
                <label for="botToken">Bot Token *</label>
                <input type="text" id="botToken" placeholder="请输入您的 Telegram Bot Token">
                <small>获取方式：联系 @BotFather 创建机器人</small>
            </div>
            <div class="form-group">
                <label for="chatId">Chat ID *</label>
                <input type="text" id="chatId" placeholder="请输入频道或群组的 Chat ID">
                <small>获取方式：将机器人添加到频道，发送消息后访问 https://api.telegram.org/bot{token}/getUpdates</small>
            </div>
            <button onclick="saveTelegramConfig()">💾 保存 Telegram 配置</button>
            <button onclick="testTelegram()" class="test-section">🧪 测试推送</button>
        </div>

        <!-- RSS 源管理 -->
        <div class="card">
            <h2>📡 RSS 源管理</h2>
            <div class="form-group">
                <label for="rssUrl">RSS 源 URL</label>
                <input type="url" id="rssUrl" placeholder="https://example.com/rss.xml">
            </div>
            <div class="form-group">
                <label for="rssName">RSS 源名称</label>
                <input type="text" id="rssName" placeholder="给这个RSS源起个名字">
            </div>
            <button onclick="addRssSource()">➕ 添加 RSS 源</button>
            <button onclick="checkAllRss()">🔄 立即检查更新</button>
        </div>

        <!-- RSS 源列表 -->
        <div class="card">
            <h2>📋 已添加的 RSS 源</h2>
            <div id="rssList">
                <p>暂无 RSS 源，请先添加</p>
            </div>
        </div>

        <!-- 系统状态 -->
        <div class="card">
            <h2>📊 系统状态</h2>
            <div id="systemStatus">
                <p>正在加载状态信息...</p>
            </div>
            <button onclick="loadStatus()">🔄 刷新状态</button>
        </div>
    </div>

    <script>
        // 显示状态消息
        function showStatus(message, type = 'success') {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = \`status \${type}\`;
            status.classList.remove('hidden');
            setTimeout(() => status.classList.add('hidden'), 5000);
        }

        // 保存 Telegram 配置
        async function saveTelegramConfig() {
            const botToken = document.getElementById('botToken').value;
            const chatId = document.getElementById('chatId').value;

            if (!botToken || !chatId) {
                showStatus('请填写完整的 Telegram 配置信息', 'error');
                return;
            }

            try {
                const response = await fetch('/api/config/telegram', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ botToken, chatId })
                });

                if (response.ok) {
                    showStatus('Telegram 配置保存成功！');
                } else {
                    throw new Error('保存失败');
                }
            } catch (error) {
                showStatus('保存 Telegram 配置失败：' + error.message, 'error');
            }
        }

        // 测试 Telegram 推送
        async function testTelegram() {
            try {
                const response = await fetch('/api/test/telegram', { method: 'POST' });
                const result = await response.json();
                
                if (response.ok) {
                    showStatus('测试消息发送成功！请检查您的 Telegram');
                } else {
                    showStatus('测试失败：' + result.error, 'error');
                }
            } catch (error) {
                showStatus('测试失败：' + error.message, 'error');
            }
        }

        // 添加 RSS 源
        async function addRssSource() {
            const url = document.getElementById('rssUrl').value;
            const name = document.getElementById('rssName').value;

            if (!url) {
                showStatus('请输入 RSS 源 URL', 'error');
                return;
            }

            try {
                const response = await fetch('/api/rss/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, name: name || url })
                });

                if (response.ok) {
                    showStatus('RSS 源添加成功！');
                    document.getElementById('rssUrl').value = '';
                    document.getElementById('rssName').value = '';
                    loadRssList();
                } else {
                    const result = await response.json();
                    throw new Error(result.error || '添加失败');
                }
            } catch (error) {
                showStatus('添加 RSS 源失败：' + error.message, 'error');
            }
        }

        // 删除 RSS 源
        async function removeRssSource(url) {
            if (!confirm('确定要删除这个 RSS 源吗？')) return;

            try {
                const response = await fetch('/api/rss/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });

                if (response.ok) {
                    showStatus('RSS 源删除成功！');
                    loadRssList();
                } else {
                    throw new Error('删除失败');
                }
            } catch (error) {
                showStatus('删除 RSS 源失败：' + error.message, 'error');
            }
        }

        // 检查所有 RSS 更新
        async function checkAllRss() {
            try {
                showStatus('正在检查 RSS 更新...', 'success');
                const response = await fetch('/api/rss/check', { method: 'POST' });
                const result = await response.json();
                
                if (response.ok) {
                    showStatus(\`检查完成！发现 \${result.newItems || 0} 条新内容\`);
                } else {
                    showStatus('检查失败：' + result.error, 'error');
                }
            } catch (error) {
                showStatus('检查失败：' + error.message, 'error');
            }
        }

        // 加载 RSS 源列表
        async function loadRssList() {
            try {
                const response = await fetch('/api/rss/list');
                const data = await response.json();
                
                const rssList = document.getElementById('rssList');
                if (data.sources && data.sources.length > 0) {
                    rssList.innerHTML = data.sources.map(source => \`
                        <div class="rss-item">
                            <strong>\${escapeHtml(source.name)}</strong><br>
                            <small>\${escapeHtml(source.url)}</small><br>
                            <small>最后检查：\${source.lastCheck || '从未'}</small>
                            <button onclick="removeRssSource('\${escapeHtml(source.url)}')" class="danger" style="float: right;">删除</button>
                        </div>
                    \`).join('');
                } else {
                    rssList.innerHTML = '<p>暂无 RSS 源，请先添加</p>';
                }
            } catch (error) {
                console.error('加载 RSS 列表失败：', error);
            }
        }

        // 加载系统状态
        async function loadStatus() {
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                
                const statusDiv = document.getElementById('systemStatus');
                statusDiv.innerHTML = \`
                    <p><strong>总 RSS 源数量：</strong>\${data.rssCount || 0}</p>
                    <p><strong>Telegram 配置：</strong>\${data.telegramConfigured ? '✅ 已配置' : '❌ 未配置'}</p>
                    <p><strong>最后运行时间：</strong>\${data.lastRun || '从未运行'}</p>
                    <p><strong>总推送消息数：</strong>\${data.totalMessages || 0}</p>
                \`;
            } catch (error) {
                document.getElementById('systemStatus').innerHTML = '<p>加载状态失败</p>';
            }
        }

        // 加载 Telegram 配置
        async function loadTelegramConfig() {
            try {
                const response = await fetch('/api/config/telegram');
                if (response.ok) {
                    const data = await response.json();
                    if (data.botToken) {
                        document.getElementById('botToken').value = data.botToken;
                    }
                    if (data.chatId) {
                        document.getElementById('chatId').value = data.chatId;
                    }
                }
            } catch (error) {
                console.error('加载 Telegram 配置失败：', error);
            }
        }

        // HTML 转义函数
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // 页面加载时初始化
        window.onload = function() {
            loadTelegramConfig();
            loadRssList();
            loadStatus();
        };
    </script>
</body>
</html>
`;

/**
 * 主要的事件处理器
 */
export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            
            // 添加安全头
            const securityHeaders = {
                'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block'
            };
            
            // 根路径返回 Web 界面
            if (url.pathname === '/') {
                return new Response(WEB_INTERFACE, {
                    headers: { 
                        'Content-Type': 'text/html; charset=utf-8',
                        ...securityHeaders
                    }
                });
            }
            
            // API 路由处理
            if (url.pathname.startsWith('/api/')) {
                return handleApiRequest(request, env);
            }
            
            return Utils.createJsonResponse({ error: 'Not Found' }, 404);
        } catch (error) {
            console.error('请求处理失败：', error);
            return Utils.createJsonResponse({ error: '服务器内部错误' }, 500);
        }
    },

    /**
     * 定时任务处理器 - 每30分钟执行一次
     */
    async scheduled(event, env, ctx) {
        console.log('开始执行定时 RSS 检查任务');
        
        try {
            const result = await checkRssUpdates(env);
            console.log('定时 RSS 检查任务完成', result);
        } catch (error) {
            console.error('定时任务执行失败：', error);
            // 可以在这里添加错误通知逻辑
        }
    }
};

/**
 * 处理 API 请求
 */
async function handleApiRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    try {
        // 路由映射
        const routes = {
            'POST /api/config/telegram': () => saveTelegramConfig(request, env),
            'GET /api/config/telegram': () => getTelegramConfig(env),
            'POST /api/rss/add': () => addRssSource(request, env),
            'POST /api/rss/remove': () => removeRssSource(request, env),
            'GET /api/rss/list': () => getRssList(env),
            'POST /api/rss/check': () => manualCheckRss(env),
            'POST /api/test/telegram': () => testTelegramPush(env),
            'GET /api/status': () => getSystemStatus(env)
        };

        const routeKey = `${request.method} ${path}`;
        const handler = routes[routeKey];
        
        if (handler) {
            return await handler();
        }
        
        return Utils.createJsonResponse({ error: 'API 路径不存在' }, 404);
        
    } catch (error) {
        console.error('API 请求处理失败：', error);
        return Utils.createJsonResponse({ 
            error: process.env.NODE_ENV === 'development' ? error.message : '服务器内部错误' 
        }, 500);
    }
}

/**
 * 保存 Telegram 配置
 */
async function saveTelegramConfig(request, env) {
    try {
        const { botToken, chatId } = await request.json();
        
        // 输入验证
        if (!botToken || !chatId) {
            return Utils.createJsonResponse({ error: '请提供完整的 Telegram 配置' }, 400);
        }

        if (!Utils.validateBotToken(botToken)) {
            return Utils.createJsonResponse({ error: 'Bot Token 格式不正确' }, 400);
        }

        if (!Utils.validateChatId(chatId)) {
            return Utils.createJsonResponse({ error: 'Chat ID 格式不正确' }, 400);
        }
        
        // 保存到 KV 存储
        await env.RSS_CONFIG.put('telegram_config', JSON.stringify({
            botToken,
            chatId,
            updatedAt: new Date().toISOString()
        }));
        
        return Utils.createJsonResponse({ success: true });
    } catch (error) {
        console.error('保存 Telegram 配置失败：', error);
        return Utils.createJsonResponse({ error: '保存配置失败' }, 500);
    }
}

/**
 * 获取 Telegram 配置
 */
async function getTelegramConfig(env) {
    try {
        const config = await env.RSS_CONFIG.get('telegram_config');
        
        if (!config) {
            return Utils.createJsonResponse({ configured: false });
        }
        
        const parsedConfig = JSON.parse(config);
        
        // 返回配置但脱敏敏感信息
        return Utils.createJsonResponse({
            configured: true,
            botToken: Utils.maskBotToken(parsedConfig.botToken),
            chatId: parsedConfig.chatId
        });
    } catch (error) {
        console.error('获取 Telegram 配置失败：', error);
        return Utils.createJsonResponse({ error: '获取配置失败' }, 500);
    }
}

/**
 * 添加 RSS 源
 */
async function addRssSource(request, env) {
    try {
        const { url, name } = await request.json();
        
        if (!url) {
            return Utils.createJsonResponse({ error: '请提供 RSS URL' }, 400);
        }

        // URL 安全验证
        if (!Utils.validateUrl(url)) {
            return Utils.createJsonResponse({ error: 'URL 格式不正确或不安全' }, 400);
        }
        
        // 获取现有的 RSS 源列表
        const existingSources = await getRssSourcesFromKV(env);
        
        // 检查数量限制
        if (existingSources.length >= CONFIG.MAX_RSS_SOURCES) {
            return Utils.createJsonResponse({ 
                error: `RSS 源数量已达上限 (${CONFIG.MAX_RSS_SOURCES})` 
            }, 400);
        }
        
        // 检查是否已存在
        if (existingSources.some(source => source.url === url)) {
            return Utils.createJsonResponse({ error: '该 RSS 源已存在' }, 400);
        }
        
        // 验证 RSS URL 是否有效
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.RSS_FETCH_TIMEOUT);
            
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'RSS-Telegram-Pusher/1.0'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 无法访问 RSS 源`);
            }
            
            // 检查内容大小
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength) > CONFIG.MAX_RSS_CONTENT_SIZE) {
                throw new Error('RSS 内容过大');
            }
            
            const content = await response.text();
            
            // 限制内容大小
            if (content.length > CONFIG.MAX_RSS_CONTENT_SIZE) {
                throw new Error('RSS 内容过大');
            }
            
            if (!content.includes('<rss') && !content.includes('<feed')) {
                throw new Error('URL 不是有效的 RSS 或 Atom 源');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                return Utils.createJsonResponse({ error: 'RSS 源访问超时' }, 400);
            }
            return Utils.createJsonResponse({ 
                error: 'RSS 源验证失败：' + error.message 
            }, 400);
        }
        
        // 添加新的 RSS 源
        const newSource = {
            url,
            name: name || url,
            addedAt: new Date().toISOString(),
            lastCheck: null,
            lastItems: []
        };
        
        existingSources.push(newSource);
        
        await env.RSS_CONFIG.put('rss_sources', JSON.stringify(existingSources));
        
        return Utils.createJsonResponse({ success: true });
    } catch (error) {
        console.error('添加 RSS 源失败：', error);
        return Utils.createJsonResponse({ error: '添加 RSS 源失败' }, 500);
    }
}

/**
 * 删除 RSS 源
 */
async function removeRssSource(request, env) {
    try {
        const { url } = await request.json();
        
        if (!url) {
            return Utils.createJsonResponse({ error: '请提供要删除的 RSS URL' }, 400);
        }
        
        const existingSources = await getRssSourcesFromKV(env);
        const filteredSources = existingSources.filter(source => source.url !== url);
        
        if (filteredSources.length === existingSources.length) {
            return Utils.createJsonResponse({ error: '未找到指定的 RSS 源' }, 404);
        }
        
        await env.RSS_CONFIG.put('rss_sources', JSON.stringify(filteredSources));
        
        return Utils.createJsonResponse({ success: true });
    } catch (error) {
        console.error('删除 RSS 源失败：', error);
        return Utils.createJsonResponse({ error: '删除 RSS 源失败' }, 500);
    }
}

/**
 * 获取 RSS 源列表
 */
async function getRssList(env) {
    try {
        const sources = await getRssSourcesFromKV(env);
        
        // 添加状态信息
        const sourcesWithStatus = sources.map(source => ({
            ...source,
            status: source.errorCount > 5 ? 'error' : 'active',
            lastError: source.lastError || null
        }));
        
        return Utils.createJsonResponse({ 
            sources: sourcesWithStatus,
            total: sources.length,
            maxAllowed: CONFIG.MAX_RSS_SOURCES
        });
    } catch (error) {
        console.error('获取 RSS 源列表失败：', error);
        return Utils.createJsonResponse({ error: '获取 RSS 源列表失败' }, 500);
    }
}

/**
 * 手动检查 RSS 更新
 */
async function manualCheckRss(env) {
    try {
        const result = await checkRssUpdates(env);
        return Utils.createJsonResponse(result);
    } catch (error) {
        console.error('手动检查 RSS 更新失败：', error);
        return Utils.createJsonResponse({ error: '检查 RSS 更新失败' }, 500);
    }
}

/**
 * 测试 Telegram 推送
 */
async function testTelegramPush(env) {
    try {
        const telegramConfig = await getTelegramConfigFromKV(env);
        
        if (!telegramConfig) {
            return Utils.createJsonResponse({ error: '请先配置 Telegram 设置' }, 400);
        }
        
        const testMessage = `🧪 RSS 推送平台测试消息\n\n⏰ 发送时间：${new Date().toLocaleString('zh-CN')}\n✅ 如果您收到此消息，说明配置正确！`;
        
        await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, testMessage);
        
        return Utils.createJsonResponse({ success: true });
    } catch (error) {
        console.error('测试 Telegram 推送失败：', error);
        return Utils.createJsonResponse({ error: error.message }, 500);
    }
}

/**
 * 获取系统状态
 */
async function getSystemStatus(env) {
    try {
        const [sources, telegramConfig, stats] = await Promise.all([
            getRssSourcesFromKV(env),
            getTelegramConfigFromKV(env),
            getStatsFromKV(env)
        ]);
        
        const errorSources = sources.filter(source => source.errorCount > 0).length;
        
        return Utils.createJsonResponse({
            rssCount: sources.length,
            maxRssAllowed: CONFIG.MAX_RSS_SOURCES,
            errorSources,
            telegramConfigured: !!telegramConfig,
            lastRun: stats.lastRun || '从未运行',
            totalMessages: stats.totalMessages || 0,
            totalRuns: stats.totalRuns || 0,
            uptime: stats.lastRun ? new Date().getTime() - new Date(stats.lastRun).getTime() : 0
        });
    } catch (error) {
        console.error('获取系统状态失败：', error);
        return Utils.createJsonResponse({ error: '获取系统状态失败' }, 500);
    }
}

/**
 * 检查 RSS 更新的核心函数 - 优化版本
 */
async function checkRssUpdates(env) {
    try {
        const [sources, telegramConfig] = await Promise.all([
            getRssSourcesFromKV(env),
            getTelegramConfigFromKV(env)
        ]);
        
        if (!telegramConfig) {
            console.log('Telegram 未配置，跳过推送');
            return { error: 'Telegram 未配置' };
        }
        
        if (sources.length === 0) {
            console.log('没有配置 RSS 源');
            return { success: true, newItems: 0 };
        }
        
        let totalNewItems = 0;
        const updatedSources = [];
        
        // 创建检查任务
        const checkTasks = sources.map(source => checkSingleRssSource(source, telegramConfig));
        
        // 限制并发数量
        const results = await Utils.limitConcurrency(checkTasks, CONFIG.MAX_CONCURRENT_RSS_CHECKS);
        
        // 处理结果
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const source = sources[i];
            
            if (result.status === 'fulfilled') {
                const { updatedSource, newItemsCount } = result.value;
                updatedSources.push(updatedSource);
                totalNewItems += newItemsCount;
            } else {
                console.error(`处理 RSS 源 ${source.url} 时出错：`, result.reason);
                updatedSources.push(source);
            }
        }
        
        // 批量保存更新
        const savePromises = [
            env.RSS_CONFIG.put('rss_sources', JSON.stringify(updatedSources)),
            updateStats(env, totalNewItems)
        ];
        
        await Promise.all(savePromises);
        
        console.log(`RSS 检查完成，共处理 ${sources.length} 个源，发现 ${totalNewItems} 条新内容`);
        return { success: true, newItems: totalNewItems };
        
    } catch (error) {
        console.error('RSS 更新检查失败：', error);
        return { error: error.message };
    }
}

/**
 * 检查单个 RSS 源
 */
async function checkSingleRssSource(source, telegramConfig) {
    try {
        console.log(`检查 RSS 源：${source.name}`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.RSS_FETCH_TIMEOUT);
        
        const response = await fetch(source.url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'RSS-Telegram-Pusher/1.0',
                'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
            }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: 无法获取 RSS 源`);
        }
        
        const rssContent = await response.text();
        
        // 限制内容大小
        if (rssContent.length > CONFIG.MAX_RSS_CONTENT_SIZE) {
            throw new Error('RSS 内容过大');
        }
        
        const newItems = await parseRssAndFindNew(rssContent, source.lastItems || []);
        
        let newItemsCount = 0;
        
        if (newItems.length > 0) {
            console.log(`发现 ${newItems.length} 条新内容`);
            
            // 批量发送消息，但保持间隔
            for (const item of newItems) {
                try {
                    const message = formatRssItemForTelegram(item, source.name);
                    await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, message);
                    newItemsCount++;
                    
                    // 避免频率限制
                    if (newItemsCount < newItems.length) {
                        await new Promise(resolve => setTimeout(resolve, CONFIG.TELEGRAM_RATE_LIMIT_DELAY));
                    }
                } catch (error) {
                    console.error(`发送 Telegram 消息失败：`, error);
                    // 继续处理其他消息
                }
            }
        }
        
        // 更新源信息
        const updatedSource = {
            ...source,
            lastCheck: new Date().toISOString(),
            lastItems: newItems.length > 0 ? newItems.slice(0, 10) : source.lastItems,
            errorCount: 0 // 重置错误计数
        };
        
        return { updatedSource, newItemsCount };
        
    } catch (error) {
        console.error(`处理 RSS 源 ${source.url} 时出错：`, error);
        
        // 更新错误计数
        const updatedSource = {
            ...source,
            lastCheck: new Date().toISOString(),
            errorCount: (source.errorCount || 0) + 1,
            lastError: error.message
        };
        
        return { updatedSource, newItemsCount: 0 };
    }
}

/**
 * 更新统计信息
 */
async function updateStats(env, newItemsCount) {
    try {
        const stats = await getStatsFromKV(env);
        const updatedStats = {
            ...stats,
            lastRun: new Date().toISOString(),
            totalMessages: (stats.totalMessages || 0) + newItemsCount,
            totalRuns: (stats.totalRuns || 0) + 1
        };
        
        await env.RSS_CONFIG.put('stats', JSON.stringify(updatedStats));
    } catch (error) {
        console.error('更新统计信息失败：', error);
    }
}

/**
 * 解析 RSS 内容并找出新条目
 */
async function parseRssAndFindNew(rssContent, lastItems) {
    const items = [];
    
    try {
        // 简单的 RSS/Atom 解析
        const itemMatches = rssContent.match(/<item[\s\S]*?<\/item>/gi) || 
                           rssContent.match(/<entry[\s\S]*?<\/entry>/gi) || [];
        
        for (const itemXml of itemMatches.slice(0, 10)) { // 只处理最新10条
            const title = extractXmlContent(itemXml, 'title');
            const link = extractXmlContent(itemXml, 'link');
            const description = extractXmlContent(itemXml, 'description') || 
                              extractXmlContent(itemXml, 'summary');
            const pubDate = extractXmlContent(itemXml, 'pubDate') || 
                           extractXmlContent(itemXml, 'published') ||
                           extractXmlContent(itemXml, 'updated');
            
            if (title && link) {
                const item = {
                    title: cleanHtml(title),
                    link: link.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
                    description: cleanHtml(description),
                    pubDate,
                    guid: link // 使用链接作为唯一标识
                };
                
                // 检查是否为新条目
                const isNew = !lastItems.some(lastItem => 
                    lastItem.guid === item.guid || lastItem.title === item.title
                );
                
                if (isNew) {
                    items.push(item);
                }
            }
        }
    } catch (error) {
        console.error('RSS 解析失败：', error);
    }
    
    return items;
}

/**
 * 从 XML 中提取指定标签的内容
 */
function extractXmlContent(xml, tagName) {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
}

/**
 * 清理 HTML 标签
 */
function cleanHtml(text) {
    if (!text) return '';
    return text
        .replace(/<[^>]*>/g, '') // 移除 HTML 标签
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 格式化 RSS 条目为 Telegram 消息
 */
function formatRssItemForTelegram(item, sourceName) {
    // 安全地转义特殊字符
    const escapeMarkdown = (text) => {
        if (!text) return '';
        return text
            .replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&')
            .replace(/\n/g, ' ')
            .trim();
    };
    
    let message = `📰 *${escapeMarkdown(sourceName)}*\n\n`;
    message += `*${escapeMarkdown(item.title)}*\n\n`;
    
    if (item.description) {
        const shortDesc = item.description.length > CONFIG.MAX_DESCRIPTION_LENGTH 
            ? item.description.substring(0, CONFIG.MAX_DESCRIPTION_LENGTH) + '...' 
            : item.description;
        message += `${escapeMarkdown(shortDesc)}\n\n`;
    }
    
    message += `🔗 [阅读全文](${item.link})`;
    
    if (item.pubDate) {
        try {
            const date = new Date(item.pubDate);
            const formattedDate = date.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            message += `\n⏰ ${formattedDate}`;
        } catch {
            message += `\n⏰ ${escapeMarkdown(item.pubDate)}`;
        }
    }
    
    return message;
}

/**
 * 发送 Telegram 消息 - 带重试机制
 */
async function sendTelegramMessage(botToken, chatId, message, retries = 3) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
            
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'RSS-Telegram-Pusher/1.0'
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message.substring(0, 4096), // Telegram 消息长度限制
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                })
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                return await response.json();
            }
            
            const errorText = await response.text();
            let errorData;
            
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { description: errorText };
            }
            
            // 检查是否是可重试的错误
            if (response.status === 429) { // Too Many Requests
                const retryAfter = errorData.parameters?.retry_after || 1;
                if (attempt < retries) {
                    console.log(`Telegram API 频率限制，${retryAfter}秒后重试 (尝试 ${attempt}/${retries})`);
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    continue;
                }
            }
            
            // 对于其他错误，如果是最后一次尝试或不可重试的错误，直接抛出
            if (attempt === retries || response.status < 500) {
                throw new Error(`Telegram API 错误 (${response.status}): ${errorData.description || errorText}`);
            }
            
            // 对于 5xx 错误，等待后重试
            if (attempt < retries) {
                console.log(`Telegram API 服务器错误，2秒后重试 (尝试 ${attempt}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Telegram API 请求超时');
            }
            
            if (attempt === retries) {
                throw error;
            }
            
            console.log(`发送消息失败，1秒后重试 (尝试 ${attempt}/${retries}): ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}

/**
 * 从 KV 存储获取 RSS 源列表
 */
async function getRssSourcesFromKV(env) {
    try {
        const sources = await env.RSS_CONFIG.get('rss_sources');
        return sources ? JSON.parse(sources) : [];
    } catch (error) {
        console.error('获取 RSS 源列表失败：', error);
        return [];
    }
}

/**
 * 从 KV 存储获取 Telegram 配置
 */
async function getTelegramConfigFromKV(env) {
    try {
        const config = await env.RSS_CONFIG.get('telegram_config');
        return config ? JSON.parse(config) : null;
    } catch (error) {
        console.error('获取 Telegram 配置失败：', error);
        return null;
    }
}

/**
 * 从 KV 存储获取统计信息
 */
async function getStatsFromKV(env) {
    try {
        const stats = await env.RSS_CONFIG.get('stats');
        return stats ? JSON.parse(stats) : {};
    } catch (error) {
        console.error('获取统计信息失败：', error);
        return {};
    }
}