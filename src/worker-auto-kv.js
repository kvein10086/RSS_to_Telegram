/**
 * RSS Telegram 推送平台 - 自动 KV 检测版本
 * 基于 Cloudflare Workers 的 RSS 订阅和 Telegram 推送服务
 * 
 * 特性：自动检测 KV 存储可用性，无 KV 时显示配置指导
 */

// 配置常量
const CONFIG = {
    MAX_RSS_SOURCES: 50,
    MAX_RSS_CONTENT_SIZE: 5 * 1024 * 1024, // 5MB
    MAX_DESCRIPTION_LENGTH: 200,
    MAX_INPUT_LENGTH: 1000,
    MAX_URL_LENGTH: 2048,
    MAX_NAME_LENGTH: 100,
    TELEGRAM_RATE_LIMIT_DELAY: 1000,
    RSS_FETCH_TIMEOUT: 30000,
    MAX_CONCURRENT_RSS_CHECKS: 5,
    BOT_TOKEN_PATTERN: /^\d+:[A-Za-z0-9_-]{35}$/,
    CHAT_ID_PATTERN: /^-?\d+$/,
    ALLOWED_PROTOCOLS: ['http:', 'https:'],
    CACHE_TTL: 300, // 5分钟缓存
    MAX_REQUESTS_PER_MINUTE: 60,
    MAX_MESSAGE_LENGTH: 4096,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,
    // Telegraph 相关配置
    TELEGRAPH_API_URL: 'https://api.telegra.ph',
    TELEGRAPH_TIMEOUT: 15000,
    TELEGRAPH_MAX_CONTENT_SIZE: 64 * 1024, // 64KB
    TELEGRAPH_AUTHOR_NAME: 'RSS Bot',
    TELEGRAPH_AUTHOR_URL: 'https://github.com/your-repo'
};

/**
 * 检查 KV 存储是否可用
 */
async function checkKVAvailability(env) {
    try {
        if (!env.RSS_CONFIG) {
            return { 
                available: false, 
                reason: 'KV 绑定未找到 - 需要在 Cloudflare 面板中绑定 KV 命名空间',
                code: 'NO_BINDING'
            };
        }
        
        // 尝试读取一个测试键来验证 KV 是否正常工作
        await env.RSS_CONFIG.get('__kv_health_check__');
        return { available: true };
    } catch (error) {
        return { 
            available: false, 
            reason: `KV 访问失败: ${error.message}`,
            code: 'ACCESS_FAILED',
            error: error.toString()
        };
    }
}

/**
 * 生成 KV 设置指导页面
 */
function generateKVSetupPage(kvStatus) {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RSS Telegram 推送平台 - KV 配置</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container { 
            max-width: 900px; 
            margin: 0 auto; 
            padding: 40px; 
            background: rgba(255,255,255,0.95); 
            border-radius: 15px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }
        h1 { color: #333; margin-bottom: 20px; font-size: 2.5em; text-align: center; }
        .status { 
            padding: 20px; 
            border-radius: 10px; 
            margin: 20px 0;
            background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%);
            color: #2d3436;
            border: 2px solid #fdcb6e;
            text-align: center;
        }
        .steps {
            margin: 20px 0;
        }
        .step {
            margin: 15px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        .step h3 {
            color: #2d3436;
            margin-bottom: 10px;
        }
        .step-number {
            display: inline-block;
            width: 30px;
            height: 30px;
            background: #667eea;
            color: white;
            border-radius: 50%;
            text-align: center;
            line-height: 30px;
            margin-right: 10px;
            font-weight: bold;
        }
        code {
            background: #2d3436;
            color: #00b894;
            padding: 4px 8px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }
        .code-block {
            background: #2d3436;
            color: #ddd;
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
        }
        .warning {
            background: linear-gradient(135deg, #ff7675 0%, #fd79a8 100%);
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .success {
            background: linear-gradient(135deg, #00b894 0%, #00cec9 100%);
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .info {
            background: linear-gradient(135deg, #74b9ff 0%, #0984e3 100%);
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .refresh-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            margin: 10px 5px;
            transition: transform 0.2s;
        }
        .refresh-btn:hover {
            transform: translateY(-2px);
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 0.9em;
        }
        .screenshot {
            max-width: 100%;
            border: 2px solid #ddd;
            border-radius: 8px;
            margin: 10px 0;
        }
        ol { margin-left: 20px; }
        ol li { margin: 8px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 RSS Telegram 推送平台</h1>
        
        <div class="status">
            <h2>⚙️ 需要配置 KV 存储</h2>
            <p>Worker 已成功部署，但需要绑定 KV 命名空间才能保存配置和状态。</p>
            <p><strong>检测状态：</strong>${kvStatus.reason}</p>
        </div>

        <div class="info">
            <strong>💡 智能部署优势</strong><br>
            • ✅ 无需预先创建 KV 命名空间即可部署<br>
            • ✅ 通过 Cloudflare 面板轻松配置<br>
            • ✅ 配置完成后自动启用完整功能<br>
            • ✅ 无需重新部署代码
        </div>

        <div class="steps">
            <h2>📋 通过 Cloudflare 面板配置 KV 存储：</h2>
            
            <div class="step">
                <h3><span class="step-number">1</span>创建 KV 命名空间</h3>
                <ol>
                    <li>登录 <strong>Cloudflare Dashboard</strong> (dash.cloudflare.com)</li>
                    <li>在左侧菜单中选择 <strong>"Workers & Pages"</strong></li>
                    <li>点击 <strong>"KV"</strong> 标签</li>
                    <li>点击 <strong>"Create a namespace"</strong> 按钮</li>
                    <li>在 "Namespace Name" 中输入：<code>RSS_CONFIG</code></li>
                    <li>点击 <strong>"Add"</strong> 按钮创建命名空间</li>
                </ol>
            </div>

            <div class="step">
                <h3><span class="step-number">2</span>绑定 KV 到 Worker</h3>
                <ol>
                    <li>在 Cloudflare Dashboard 中，进入 <strong>"Workers & Pages"</strong></li>
                    <li>找到并点击您的 Worker：<code>rsstotelegram</code></li>
                    <li>在 Worker 详情页面，点击 <strong>"Settings"</strong> 标签</li>
                    <li>向下滚动找到 <strong>"Variables"</strong> 部分</li>
                    <li>在 <strong>"KV Namespace Bindings"</strong> 区域，点击 <strong>"Add binding"</strong></li>
                    <li>填写绑定信息：</li>
                </ol>
                <div class="code-block">
Variable name: RSS_CONFIG
KV namespace: RSS_CONFIG (选择刚创建的命名空间)
                </div>
                <ol start="7">
                    <li>点击 <strong>"Save and deploy"</strong> 按钮</li>
                </ol>
            </div>

            <div class="step">
                <h3><span class="step-number">3</span>验证配置</h3>
                <p>配置完成后，等待 1-2 分钟让绑定生效，然后刷新此页面。</p>
                <button class="refresh-btn" onclick="window.location.reload()">🔄 刷新页面检查状态</button>
                <button class="refresh-btn" onclick="checkStatus()">📊 检查 API 状态</button>
            </div>
        </div>

        <div class="warning">
            <strong>⚠️ 重要提示</strong><br>
            • KV 绑定后需要等待 1-3 分钟才能生效<br>
            • 确保变量名称完全匹配：<code>RSS_CONFIG</code><br>
            • 如果仍有问题，请检查 KV 命名空间是否创建成功<br>
            • 绑定变量名区分大小写，必须完全匹配
        </div>

        <div class="success" style="display: none;" id="success-message">
            <strong>🎉 配置成功！</strong><br>
            KV 存储已正确配置，页面将自动跳转到管理界面...
        </div>

        <div class="footer">
            <p>RSS to Telegram v2.1.0 - 智能 KV 检测版本</p>
            <p>部署时间：${new Date().toLocaleString('zh-CN')}</p>
            <p>KV 状态检查时间：${new Date().toLocaleString('zh-CN')}</p>
            <p>错误代码：${kvStatus.code || 'UNKNOWN'}</p>
        </div>
    </div>

    <script>
        let checkCount = 0;
        const maxChecks = 20; // 最多检查20次（10分钟）
        
        function checkStatus() {
            fetch('/api/status')
                .then(response => response.json())
                .then(data => {
                    if (data.kv_available) {
                        document.getElementById('success-message').style.display = 'block';
                        setTimeout(() => {
                            window.location.href = '/';
                        }, 2000);
                    } else {
                        alert('KV 存储仍未可用，请检查配置是否正确');
                    }
                })
                .catch(error => {
                    alert('状态检查失败: ' + error.message);
                });
        }
        
        function autoCheck() {
            if (checkCount < maxChecks) {
                setTimeout(() => {
                    checkCount++;
                    fetch('/api/status')
                        .then(response => response.json())
                        .then(data => {
                            if (data.kv_available) {
                                document.getElementById('success-message').style.display = 'block';
                                setTimeout(() => {
                                    window.location.href = '/';
                                }, 3000);
                            } else {
                                autoCheck();
                            }
                        })
                        .catch(() => autoCheck());
                }, 30000); // 每30秒检查一次
            }
        }
        
        // 启动自动检查
        autoCheck();
    </script>
</body>
</html>
    `;
}

// 简化的 Web 界面（从原文件复制核心部分）
const WEB_INTERFACE = \`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RSS Telegram 推送平台</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; color: white; margin-bottom: 30px; }
        .card { 
            background: rgba(255,255,255,0.95); 
            border-radius: 15px; 
            padding: 30px; 
            margin: 20px 0;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }
        .success { color: #00b894; }
        .error { color: #e74c3c; }
        .btn { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; 
            padding: 12px 24px; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer;
            margin: 5px;
        }
        .btn:hover { transform: translateY(-2px); }
        input, textarea { 
            width: 100%; 
            padding: 12px; 
            border: 2px solid #ddd; 
            border-radius: 8px; 
            margin: 10px 0;
        }
        .status-indicator { 
            display: inline-block; 
            width: 12px; 
            height: 12px; 
            border-radius: 50%; 
            margin-right: 8px;
        }
        .status-ok { background: #00b894; }
        .status-error { background: #e74c3c; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 RSS Telegram 推送平台</h1>
            <p>基于 Cloudflare Workers 的智能 RSS 订阅服务</p>
        </div>

        <div class="card">
            <h2>📊 系统状态</h2>
            <div id="system-status">
                <p><span class="status-indicator status-ok"></span>Worker 运行正常</p>
                <p><span class="status-indicator status-ok"></span>KV 存储已连接</p>
                <p><span class="status-indicator" id="telegram-status"></span>Telegram 配置: <span id="telegram-text">未配置</span></p>
                <p><span class="status-indicator" id="rss-status"></span>RSS 源: <span id="rss-count">0</span> 个</p>
            </div>
        </div>

        <div class="card">
            <h2>🤖 Telegram 配置</h2>
            <div>
                <label>Bot Token:</label>
                <input type="text" id="bot-token" placeholder="输入您的 Telegram Bot Token">
                
                <label>Chat ID:</label>
                <input type="text" id="chat-id" placeholder="输入接收消息的 Chat ID">
                
                <button class="btn" onclick="saveTelegramConfig()">💾 保存配置</button>
                <button class="btn" onclick="testTelegram()">🧪 测试推送</button>
            </div>
            <div id="telegram-result"></div>
        </div>

        <div class="card">
            <h2>📡 RSS 源管理</h2>
            <div>
                <label>RSS 源名称:</label>
                <input type="text" id="rss-name" placeholder="为 RSS 源起个名字">
                
                <label>RSS URL:</label>
                <input type="url" id="rss-url" placeholder="输入 RSS 源的 URL">
                
                <button class="btn" onclick="addRSSSource()">➕ 添加 RSS 源</button>
                <button class="btn" onclick="checkAllRSS()">🔄 检查更新</button>
            </div>
            <div id="rss-result"></div>
            <div id="rss-list"></div>
        </div>

        <div class="card">
            <h2>📰 Telegraph 配置 (可选)</h2>
            <div>
                <label>
                    <input type="checkbox" id="telegraph-enabled"> 启用 Telegraph 文章转换
                </label>
                <br><br>
                <label>作者名称:</label>
                <input type="text" id="telegraph-author" placeholder="Telegraph 文章作者名称" value="RSS Bot">
                
                <label>作者链接:</label>
                <input type="url" id="telegraph-author-url" placeholder="作者链接 (可选)">
                
                <button class="btn" onclick="saveTelegraphConfig()">💾 保存 Telegraph 配置</button>
            </div>
            <div id="telegraph-result"></div>
        </div>
    </div>

    <script>
        // 页面加载时获取当前配置
        window.onload = function() {
            loadCurrentConfig();
            loadRSSList();
        };

        async function loadCurrentConfig() {
            try {
                const response = await fetch('/api/config');
                const data = await response.json();
                
                if (data.telegram) {
                    document.getElementById('bot-token').value = data.telegram.bot_token || '';
                    document.getElementById('chat-id').value = data.telegram.chat_id || '';
                    updateTelegramStatus(true);
                } else {
                    updateTelegramStatus(false);
                }

                if (data.telegraph) {
                    document.getElementById('telegraph-enabled').checked = data.telegraph.enabled || false;
                    document.getElementById('telegraph-author').value = data.telegraph.author_name || 'RSS Bot';
                    document.getElementById('telegraph-author-url').value = data.telegraph.author_url || '';
                }
            } catch (error) {
                console.error('加载配置失败:', error);
            }
        }

        async function loadRSSList() {
            try {
                const response = await fetch('/api/rss/list');
                const data = await response.json();
                
                const listDiv = document.getElementById('rss-list');
                if (data.sources && data.sources.length > 0) {
                    listDiv.innerHTML = '<h3>📋 当前 RSS 源:</h3>' + 
                        data.sources.map(source => 
                            \`<div style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px;">
                                <strong>\${source.name}</strong><br>
                                <small>\${source.url}</small>
                                <button class="btn" style="float: right; padding: 5px 10px;" onclick="removeRSSSource('\${source.url}')">🗑️ 删除</button>
                            </div>\`
                        ).join('');
                    
                    document.getElementById('rss-count').textContent = data.sources.length;
                    document.getElementById('rss-status').className = 'status-indicator status-ok';
                } else {
                    listDiv.innerHTML = '<p>暂无 RSS 源</p>';
                    document.getElementById('rss-count').textContent = '0';
                    document.getElementById('rss-status').className = 'status-indicator status-error';
                }
            } catch (error) {
                console.error('加载 RSS 列表失败:', error);
            }
        }

        function updateTelegramStatus(configured) {
            const statusEl = document.getElementById('telegram-status');
            const textEl = document.getElementById('telegram-text');
            
            if (configured) {
                statusEl.className = 'status-indicator status-ok';
                textEl.textContent = '已配置';
            } else {
                statusEl.className = 'status-indicator status-error';
                textEl.textContent = '未配置';
            }
        }

        async function saveTelegramConfig() {
            const botToken = document.getElementById('bot-token').value;
            const chatId = document.getElementById('chat-id').value;
            
            if (!botToken || !chatId) {
                alert('请填写完整的 Telegram 配置');
                return;
            }

            try {
                const response = await fetch('/api/config/telegram', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bot_token: botToken, chat_id: chatId })
                });

                const result = await response.json();
                const resultDiv = document.getElementById('telegram-result');
                
                if (response.ok) {
                    resultDiv.innerHTML = '<p class="success">✅ Telegram 配置保存成功</p>';
                    updateTelegramStatus(true);
                } else {
                    resultDiv.innerHTML = \`<p class="error">❌ 保存失败: \${result.error}</p>\`;
                }
            } catch (error) {
                document.getElementById('telegram-result').innerHTML = \`<p class="error">❌ 保存失败: \${error.message}</p>\`;
            }
        }

        async function testTelegram() {
            try {
                const response = await fetch('/api/telegram/test', { method: 'POST' });
                const result = await response.json();
                const resultDiv = document.getElementById('telegram-result');
                
                if (response.ok) {
                    resultDiv.innerHTML = '<p class="success">✅ Telegram 测试消息发送成功</p>';
                } else {
                    resultDiv.innerHTML = \`<p class="error">❌ 测试失败: \${result.error}</p>\`;
                }
            } catch (error) {
                document.getElementById('telegram-result').innerHTML = \`<p class="error">❌ 测试失败: \${error.message}</p>\`;
            }
        }

        async function addRSSSource() {
            const name = document.getElementById('rss-name').value;
            const url = document.getElementById('rss-url').value;
            
            if (!name || !url) {
                alert('请填写 RSS 源名称和 URL');
                return;
            }

            try {
                const response = await fetch('/api/rss/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, url })
                });

                const result = await response.json();
                const resultDiv = document.getElementById('rss-result');
                
                if (response.ok) {
                    resultDiv.innerHTML = '<p class="success">✅ RSS 源添加成功</p>';
                    document.getElementById('rss-name').value = '';
                    document.getElementById('rss-url').value = '';
                    loadRSSList();
                } else {
                    resultDiv.innerHTML = \`<p class="error">❌ 添加失败: \${result.error}</p>\`;
                }
            } catch (error) {
                document.getElementById('rss-result').innerHTML = \`<p class="error">❌ 添加失败: \${error.message}</p>\`;
            }
        }

        async function removeRSSSource(url) {
            if (!confirm('确定要删除这个 RSS 源吗？')) return;

            try {
                const response = await fetch('/api/rss/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });

                const result = await response.json();
                
                if (response.ok) {
                    loadRSSList();
                } else {
                    alert(\`删除失败: \${result.error}\`);
                }
            } catch (error) {
                alert(\`删除失败: \${error.message}\`);
            }
        }

        async function checkAllRSS() {
            try {
                const response = await fetch('/api/rss/check', { method: 'POST' });
                const result = await response.json();
                const resultDiv = document.getElementById('rss-result');
                
                if (response.ok) {
                    resultDiv.innerHTML = \`<p class="success">✅ RSS 检查完成，处理了 \${result.processed || 0} 个源</p>\`;
                } else {
                    resultDiv.innerHTML = \`<p class="error">❌ 检查失败: \${result.error}</p>\`;
                }
            } catch (error) {
                document.getElementById('rss-result').innerHTML = \`<p class="error">❌ 检查失败: \${error.message}</p>\`;
            }
        }

        async function saveTelegraphConfig() {
            const enabled = document.getElementById('telegraph-enabled').checked;
            const authorName = document.getElementById('telegraph-author').value;
            const authorUrl = document.getElementById('telegraph-author-url').value;

            try {
                const response = await fetch('/api/config/telegraph', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        enabled, 
                        author_name: authorName, 
                        author_url: authorUrl 
                    })
                });

                const result = await response.json();
                const resultDiv = document.getElementById('telegraph-result');
                
                if (response.ok) {
                    resultDiv.innerHTML = '<p class="success">✅ Telegraph 配置保存成功</p>';
                } else {
                    resultDiv.innerHTML = \`<p class="error">❌ 保存失败: \${result.error}</p>\`;
                }
            } catch (error) {
                document.getElementById('telegraph-result').innerHTML = \`<p class="error">❌ 保存失败: \${error.message}</p>\`;
            }
        }
    </script>
</body>
</html>
\`;

// 简化的安全工具类
class SecurityUtils {
    static escapeHtml(text) {
        if (!text) return '';
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
        };
        return text.replace(/[&<>"'/]/g, (char) => escapeMap[char]);
    }

    static validateInput(input, maxLength = CONFIG.MAX_INPUT_LENGTH) {
        if (!input || typeof input !== 'string') return false;
        return input.length <= maxLength;
    }

    static validateUrl(url) {
        try {
            const urlObj = new URL(url);
            return CONFIG.ALLOWED_PROTOCOLS.includes(urlObj.protocol) && 
                   url.length <= CONFIG.MAX_URL_LENGTH;
        } catch {
            return false;
        }
    }

    static validateBotToken(token) {
        return CONFIG.BOT_TOKEN_PATTERN.test(token);
    }

    static validateChatId(chatId) {
        return CONFIG.CHAT_ID_PATTERN.test(chatId);
    }
}

// 简化的响应工具类
class ResponseUtils {
    static createJsonResponse(data, status = 200, headers = {}) {
        return new Response(JSON.stringify(data), {
            status,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                ...headers
            }
        });
    }

    static createErrorResponse(message, status = 400, headers = {}) {
        return this.createJsonResponse({
            error: message,
            timestamp: new Date().toISOString()
        }, status, headers);
    }
}

// 简化的配置管理器
class ConfigManager {
    constructor(env) {
        this.env = env;
    }

    async getTelegramConfig() {
        try {
            const config = await this.env.RSS_CONFIG.get('telegram_config');
            return config ? JSON.parse(config) : null;
        } catch (error) {
            console.error('获取 Telegram 配置失败:', error);
            return null;
        }
    }

    async saveTelegramConfig(config) {
        try {
            await this.env.RSS_CONFIG.put('telegram_config', JSON.stringify(config));
            return true;
        } catch (error) {
            console.error('保存 Telegram 配置失败:', error);
            return false;
        }
    }

    async getRSSConfig() {
        try {
            const config = await this.env.RSS_CONFIG.get('rss_sources');
            return config ? JSON.parse(config) : [];
        } catch (error) {
            console.error('获取 RSS 配置失败:', error);
            return [];
        }
    }

    async saveRSSConfig(sources) {
        try {
            await this.env.RSS_CONFIG.put('rss_sources', JSON.stringify(sources));
            return true;
        } catch (error) {
            console.error('保存 RSS 配置失败:', error);
            return false;
        }
    }

    async getTelegraphConfig() {
        try {
            const config = await this.env.RSS_CONFIG.get('telegraph_config');
            return config ? JSON.parse(config) : { enabled: false };
        } catch (error) {
            console.error('获取 Telegraph 配置失败:', error);
            return { enabled: false };
        }
    }

    async saveTelegraphConfig(config) {
        try {
            await this.env.RSS_CONFIG.put('telegraph_config', JSON.stringify(config));
            return true;
        } catch (error) {
            console.error('保存 Telegraph 配置失败:', error);
            return false;
        }
    }
}

// 简化的 Telegram 服务
class TelegramService {
    constructor(config) {
        this.config = config;
    }

    async sendMessage(text) {
        if (!this.config || !this.config.bot_token || !this.config.chat_id) {
            throw new Error('Telegram 配置不完整');
        }

        const url = `https://api.telegram.org/bot${this.config.bot_token}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: this.config.chat_id,
                text: text.substring(0, CONFIG.MAX_MESSAGE_LENGTH),
                parse_mode: 'HTML',
                disable_web_page_preview: false
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Telegram API 错误: ${error}`);
        }

        return await response.json();
    }
}

// 简化的 RSS 服务
class RSSService {
    static async fetchRSS(url) {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'RSS-to-Telegram-Bot/2.1.0',
                'Accept': 'application/rss+xml, application/xml, text/xml'
            }
        });

        if (!response.ok) {
            throw new Error(`RSS 获取失败: ${response.status}`);
        }

        return await response.text();
    }

    static parseRSS(xmlText) {
        // 简化的 RSS 解析
        const items = [];
        const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
        let match;

        while ((match = itemRegex.exec(xmlText)) !== null) {
            const itemXml = match[1];
            
            const title = this.extractTag(itemXml, 'title');
            const link = this.extractTag(itemXml, 'link');
            const description = this.extractTag(itemXml, 'description');
            const pubDate = this.extractTag(itemXml, 'pubDate');

            if (title && link) {
                items.push({
                    title: this.cleanText(title),
                    link: link.trim(),
                    description: this.cleanText(description),
                    pubDate: pubDate ? new Date(pubDate) : new Date(),
                    guid: this.extractTag(itemXml, 'guid') || link
                });
            }
        }

        return items;
    }

    static extractTag(xml, tagName) {
        const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
        const match = xml.match(regex);
        return match ? match[1].trim() : '';
    }

    static cleanText(text) {
        if (!text) return '';
        return text
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
    }
}

/**
 * 主要的事件处理器 - 自动 KV 检测版本
 */
export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            
            // 检查 KV 可用性
            const kvStatus = await checkKVAvailability(env);
            
            // 安全头
            const securityHeaders = {
                'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Referrer-Policy': 'strict-origin-when-cross-origin'
            };
            
            // 如果 KV 不可用，显示配置指导页面
            if (!kvStatus.available) {
                if (url.pathname === '/api/status') {
                    return ResponseUtils.createJsonResponse({
                        kv_available: false,
                        reason: kvStatus.reason,
                        code: kvStatus.code,
                        timestamp: new Date().toISOString()
                    }, 200, securityHeaders);
                }
                
                return new Response(generateKVSetupPage(kvStatus), {
                    headers: { 
                        'Content-Type': 'text/html; charset=utf-8',
                        ...securityHeaders
                    }
                });
            }
            
            // KV 可用，处理正常请求
            const configManager = new ConfigManager(env);
            
            // 根路径返回 Web 界面
            if (url.pathname === '/') {
                return new Response(WEB_INTERFACE, {
                    headers: { 
                        'Content-Type': 'text/html; charset=utf-8',
                        ...securityHeaders
                    }
                });
            }
            
            // API 状态检查
            if (url.pathname === '/api/status') {
                return ResponseUtils.createJsonResponse({
                    kv_available: true,
                    timestamp: new Date().toISOString(),
                    version: '2.1.0'
                }, 200, securityHeaders);
            }
            
            // 获取配置
            if (url.pathname === '/api/config') {
                const telegramConfig = await configManager.getTelegramConfig();
                const telegraphConfig = await configManager.getTelegraphConfig();
                
                return ResponseUtils.createJsonResponse({
                    telegram: telegramConfig,
                    telegraph: telegraphConfig
                }, 200, securityHeaders);
            }
            
            // Telegram 配置
            if (url.pathname === '/api/config/telegram' && request.method === 'POST') {
                const data = await request.json();
                
                if (!SecurityUtils.validateBotToken(data.bot_token)) {
                    return ResponseUtils.createErrorResponse('无效的 Bot Token 格式', 400, securityHeaders);
                }
                
                if (!SecurityUtils.validateChatId(data.chat_id)) {
                    return ResponseUtils.createErrorResponse('无效的 Chat ID 格式', 400, securityHeaders);
                }
                
                const success = await configManager.saveTelegramConfig({
                    bot_token: data.bot_token,
                    chat_id: data.chat_id
                });
                
                if (success) {
                    return ResponseUtils.createJsonResponse({ message: '配置保存成功' }, 200, securityHeaders);
                } else {
                    return ResponseUtils.createErrorResponse('配置保存失败', 500, securityHeaders);
                }
            }
            
            // Telegram 测试
            if (url.pathname === '/api/telegram/test' && request.method === 'POST') {
                const telegramConfig = await configManager.getTelegramConfig();
                if (!telegramConfig) {
                    return ResponseUtils.createErrorResponse('请先配置 Telegram', 400, securityHeaders);
                }
                
                const telegram = new TelegramService(telegramConfig);
                try {
                    await telegram.sendMessage('🧪 RSS to Telegram 测试消息\\n\\n✅ 配置正常，服务运行中！');
                    return ResponseUtils.createJsonResponse({ message: '测试消息发送成功' }, 200, securityHeaders);
                } catch (error) {
                    return ResponseUtils.createErrorResponse(`测试失败: ${error.message}`, 400, securityHeaders);
                }
            }
            
            // RSS 源列表
            if (url.pathname === '/api/rss/list') {
                const sources = await configManager.getRSSConfig();
                return ResponseUtils.createJsonResponse({ sources }, 200, securityHeaders);
            }
            
            // 添加 RSS 源
            if (url.pathname === '/api/rss/add' && request.method === 'POST') {
                const data = await request.json();
                
                if (!SecurityUtils.validateInput(data.name, CONFIG.MAX_NAME_LENGTH)) {
                    return ResponseUtils.createErrorResponse('RSS 源名称无效', 400, securityHeaders);
                }
                
                if (!SecurityUtils.validateUrl(data.url)) {
                    return ResponseUtils.createErrorResponse('RSS URL 无效', 400, securityHeaders);
                }
                
                const sources = await configManager.getRSSConfig();
                
                if (sources.length >= CONFIG.MAX_RSS_SOURCES) {
                    return ResponseUtils.createErrorResponse(`最多只能添加 ${CONFIG.MAX_RSS_SOURCES} 个 RSS 源`, 400, securityHeaders);
                }
                
                if (sources.some(s => s.url === data.url)) {
                    return ResponseUtils.createErrorResponse('该 RSS 源已存在', 400, securityHeaders);
                }
                
                sources.push({
                    name: data.name,
                    url: data.url,
                    added_at: new Date().toISOString()
                });
                
                const success = await configManager.saveRSSConfig(sources);
                if (success) {
                    return ResponseUtils.createJsonResponse({ message: 'RSS 源添加成功' }, 200, securityHeaders);
                } else {
                    return ResponseUtils.createErrorResponse('RSS 源保存失败', 500, securityHeaders);
                }
            }
            
            // 删除 RSS 源
            if (url.pathname === '/api/rss/remove' && request.method === 'POST') {
                const data = await request.json();
                const sources = await configManager.getRSSConfig();
                const filteredSources = sources.filter(s => s.url !== data.url);
                
                const success = await configManager.saveRSSConfig(filteredSources);
                if (success) {
                    return ResponseUtils.createJsonResponse({ message: 'RSS 源删除成功' }, 200, securityHeaders);
                } else {
                    return ResponseUtils.createErrorResponse('RSS 源删除失败', 500, securityHeaders);
                }
            }
            
            // 检查 RSS 更新
            if (url.pathname === '/api/rss/check' && request.method === 'POST') {
                const telegramConfig = await configManager.getTelegramConfig();
                if (!telegramConfig) {
                    return ResponseUtils.createErrorResponse('请先配置 Telegram', 400, securityHeaders);
                }
                
                const sources = await configManager.getRSSConfig();
                if (sources.length === 0) {
                    return ResponseUtils.createErrorResponse('请先添加 RSS 源', 400, securityHeaders);
                }
                
                const telegram = new TelegramService(telegramConfig);
                let processed = 0;
                
                for (const source of sources) {
                    try {
                        const xmlText = await RSSService.fetchRSS(source.url);
                        const items = RSSService.parseRSS(xmlText);
                        
                        if (items.length > 0) {
                            const latestItem = items[0];
                            const message = `📰 ${source.name}\\n\\n<b>${latestItem.title}</b>\\n\\n${latestItem.description.substring(0, 200)}...\\n\\n🔗 <a href="${latestItem.link}">阅读全文</a>`;
                            
                            await telegram.sendMessage(message);
                            processed++;
                            
                            // 避免频率限制
                            await new Promise(resolve => setTimeout(resolve, CONFIG.TELEGRAM_RATE_LIMIT_DELAY));
                        }
                    } catch (error) {
                        console.error(`处理 RSS 源 ${source.name} 失败:`, error);
                    }
                }
                
                return ResponseUtils.createJsonResponse({ 
                    message: 'RSS 检查完成', 
                    processed 
                }, 200, securityHeaders);
            }
            
            // Telegraph 配置
            if (url.pathname === '/api/config/telegraph' && request.method === 'POST') {
                const data = await request.json();
                
                const success = await configManager.saveTelegraphConfig({
                    enabled: !!data.enabled,
                    author_name: data.author_name || CONFIG.TELEGRAPH_AUTHOR_NAME,
                    author_url: data.author_url || ''
                });
                
                if (success) {
                    return ResponseUtils.createJsonResponse({ message: 'Telegraph 配置保存成功' }, 200, securityHeaders);
                } else {
                    return ResponseUtils.createErrorResponse('Telegraph 配置保存失败', 500, securityHeaders);
                }
            }
            
            // 404 处理
            return ResponseUtils.createErrorResponse('页面不存在', 404, securityHeaders);
            
        } catch (error) {
            console.error('请求处理失败:', error);
            return ResponseUtils.createErrorResponse('服务器内部错误', 500);
        }
    },

    /**
     * 定时任务处理器
     */
    async scheduled(event, env, ctx) {
        try {
            // 检查 KV 可用性
            const kvStatus = await checkKVAvailability(env);
            if (!kvStatus.available) {
                console.log('定时任务跳过：KV 存储不可用');
                return;
            }
            
            const configManager = new ConfigManager(env);
            const telegramConfig = await configManager.getTelegramConfig();
            const sources = await configManager.getRSSConfig();
            
            if (!telegramConfig || sources.length === 0) {
                console.log('定时任务跳过：配置不完整');
                return;
            }
            
            const telegram = new TelegramService(telegramConfig);
            let processed = 0;
            
            for (const source of sources) {
                try {
                    const xmlText = await RSSService.fetchRSS(source.url);
                    const items = RSSService.parseRSS(xmlText);
                    
                    if (items.length > 0) {
                        const latestItem = items[0];
                        
                        // 检查是否已经推送过
                        const lastSentKey = `last_sent_${source.url}`;
                        const lastSent = await env.RSS_CONFIG.get(lastSentKey);
                        
                        if (lastSent !== latestItem.guid) {
                            const message = `📰 ${source.name}\\n\\n<b>${latestItem.title}</b>\\n\\n${latestItem.description.substring(0, 200)}...\\n\\n🔗 <a href="${latestItem.link}">阅读全文</a>`;
                            
                            await telegram.sendMessage(message);
                            await env.RSS_CONFIG.put(lastSentKey, latestItem.guid);
                            processed++;
                            
                            // 避免频率限制
                            await new Promise(resolve => setTimeout(resolve, CONFIG.TELEGRAM_RATE_LIMIT_DELAY));
                        }
                    }
                } catch (error) {
                    console.error(`定时任务处理 RSS 源 ${source.name} 失败:`, error);
                }
            }
            
            console.log(`定时任务完成，处理了 ${processed} 个新文章`);
            
        } catch (error) {
            console.error('定时任务执行失败:', error);
        }
    }
};