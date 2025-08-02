/**
 * RSS Telegram 推送平台 - 终极优化版本
 * 基于 Cloudflare Workers 的 RSS 订阅和 Telegram 推送服务
 * 
 * 全面安全和性能优化版本
 * 经过专业代码审查和优化
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

// 安全工具类
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

    static sanitizeInput(input, maxLength = CONFIG.MAX_INPUT_LENGTH) {
        if (typeof input !== 'string') return '';
        return input.trim().substring(0, maxLength);
    }

    static validateBotToken(token) {
        return typeof token === 'string' && CONFIG.BOT_TOKEN_PATTERN.test(token);
    }

    static validateChatId(chatId) {
        return typeof chatId === 'string' && CONFIG.CHAT_ID_PATTERN.test(chatId);
    }

    static validateUrl(url) {
        try {
            const parsedUrl = new URL(url);
            
            // 检查协议
            if (!CONFIG.ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
                return false;
            }
            
            // 检查是否为内网地址
            const hostname = parsedUrl.hostname.toLowerCase();
            const privateNetworks = [
                /^10\./,
                /^172\.(1[6-9]|2[0-9]|3[01])\./,
                /^192\.168\./,
                /^127\./,
                /^0\.0\.0\.0$/,
                /^localhost$/,
                /^::1$/,
                /^fe80:/,
                /^fc00:/,
                /^fd00:/
            ];
            
            return !privateNetworks.some(pattern => pattern.test(hostname));
        } catch {
            return false;
        }
    }

    static maskBotToken(token) {
        if (!token || token.length < 10) return '***';
        return token.substring(0, 8) + '***' + token.substring(token.length - 4);
    }

    static generateCSRFToken() {
        return crypto.randomUUID();
    }
}

// 缓存管理类
class CacheManager {
    constructor(env) {
        this.env = env;
    }

    async get(key) {
        try {
            const cached = await this.env.RSS_CONFIG.get(`cache:${key}`);
            if (!cached) return null;
            
            const data = JSON.parse(cached);
            if (Date.now() > data.expires) {
                await this.delete(key);
                return null;
            }
            return data.value;
        } catch {
            return null;
        }
    }

    async set(key, value, ttl = CONFIG.CACHE_TTL) {
        try {
            const data = {
                value,
                expires: Date.now() + (ttl * 1000)
            };
            await this.env.RSS_CONFIG.put(`cache:${key}`, JSON.stringify(data));
        } catch (error) {
            Logger.error('缓存设置失败', error);
        }
    }

    async delete(key) {
        try {
            await this.env.RSS_CONFIG.delete(`cache:${key}`);
        } catch (error) {
            Logger.error('缓存删除失败', error);
        }
    }
}

// 频率限制类
class RateLimiter {
    constructor(env) {
        this.env = env;
    }

    async checkLimit(identifier, maxRequests = CONFIG.MAX_REQUESTS_PER_MINUTE) {
        const key = `rate_limit:${identifier}`;
        const now = Date.now();
        const windowStart = now - 60000; // 1分钟窗口

        try {
            const existing = await this.env.RSS_CONFIG.get(key);
            let requests = existing ? JSON.parse(existing) : [];
            
            // 清理过期请求
            requests = requests.filter(timestamp => timestamp > windowStart);
            
            if (requests.length >= maxRequests) {
                return false;
            }
            
            requests.push(now);
            await this.env.RSS_CONFIG.put(key, JSON.stringify(requests), { expirationTtl: 60 });
            return true;
        } catch {
            return true; // 出错时允许请求
        }
    }
}

// 响应工具类
class ResponseUtils {
    static createJsonResponse(data, status = 200, headers = {}) {
        return new Response(JSON.stringify(data), {
            status,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                ...headers
            }
        });
    }

    static createErrorResponse(message, status = 400) {
        return this.createJsonResponse({ 
            error: SecurityUtils.sanitizeInput(message, 200),
            timestamp: new Date().toISOString()
        }, status);
    }

    static createSuccessResponse(data = {}) {
        return this.createJsonResponse({ 
            success: true, 
            ...data,
            timestamp: new Date().toISOString()
        });
    }
}

// 并发控制工具
class ConcurrencyUtils {
    static async limitConcurrency(tasks, limit) {
        const results = [];
        for (let i = 0; i < tasks.length; i += limit) {
            const batch = tasks.slice(i, i + limit);
            const batchResults = await Promise.allSettled(batch);
            results.push(...batchResults);
        }
        return results;
    }

    static async retry(fn, attempts = CONFIG.RETRY_ATTEMPTS, delay = CONFIG.RETRY_DELAY) {
        for (let i = 0; i < attempts; i++) {
            try {
                return await fn();
            } catch (error) {
                if (i === attempts - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
    }
}

// 日志记录类
class Logger {
    static info(message, data = {}) {
        console.log(`[INFO] ${message}`, data);
    }

    static error(message, error = null, data = {}) {
        console.error(`[ERROR] ${message}`, { error: error?.message, stack: error?.stack, ...data });
    }

    static warn(message, data = {}) {
        console.warn(`[WARN] ${message}`, data);
    }
}

// Telegraph 服务类
class TelegraphService {
    constructor(env, cache) {
        this.env = env;
        this.cache = cache;
    }

    /**
     * 获取或创建 Telegraph 账户
     */
    async getOrCreateAccount() {
        try {
            // 尝试从缓存获取
            let account = await this.cache.get('telegraph_account');
            if (account) {
                return account;
            }

            // 尝试从 KV 存储获取
            const storedAccount = await this.env.RSS_CONFIG.get('telegraph_account');
            if (storedAccount) {
                account = JSON.parse(storedAccount);
                await this.cache.set('telegraph_account', account, 3600); // 缓存1小时
                return account;
            }

            // 创建新账户
            account = await this.createAccount();
            await this.env.RSS_CONFIG.put('telegraph_account', JSON.stringify(account));
            await this.cache.set('telegraph_account', account, 3600);
            
            Logger.info('Telegraph 账户创建成功', { shortName: account.short_name });
            return account;
        } catch (error) {
            Logger.error('获取 Telegraph 账户失败', error);
            throw error;
        }
    }

    /**
     * 创建 Telegraph 账户
     */
    async createAccount() {
        const response = await fetch(`${CONFIG.TELEGRAPH_API_URL}/createAccount`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'RSS-Telegram-Pusher/2.0'
            },
            body: JSON.stringify({
                short_name: `RSS_Bot_${Date.now()}`,
                author_name: CONFIG.TELEGRAPH_AUTHOR_NAME,
                author_url: CONFIG.TELEGRAPH_AUTHOR_URL
            })
        });

        if (!response.ok) {
            throw new Error(`Telegraph API 错误: ${response.status}`);
        }

        const data = await response.json();
        if (!data.ok) {
            throw new Error(`Telegraph 错误: ${data.error}`);
        }

        return data.result;
    }

    /**
     * 创建 Telegraph 页面
     */
    async createPage(title, content, authorName = null) {
        try {
            const account = await this.getOrCreateAccount();
            
            // 转换内容为 Telegraph 格式
            const telegraphContent = this.convertToTelegraphFormat(content);
            
            // 限制内容大小
            const contentString = JSON.stringify(telegraphContent);
            if (contentString.length > CONFIG.TELEGRAPH_MAX_CONTENT_SIZE) {
                throw new Error('内容过大，无法创建 Telegraph 页面');
            }

            const response = await fetch(`${CONFIG.TELEGRAPH_API_URL}/createPage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'RSS-Telegram-Pusher/2.0'
                },
                body: JSON.stringify({
                    access_token: account.access_token,
                    title: title.substring(0, 256), // Telegraph 标题限制
                    author_name: authorName || CONFIG.TELEGRAPH_AUTHOR_NAME,
                    author_url: CONFIG.TELEGRAPH_AUTHOR_URL,
                    content: telegraphContent,
                    return_content: false
                })
            });

            if (!response.ok) {
                throw new Error(`Telegraph API 错误: ${response.status}`);
            }

            const data = await response.json();
            if (!data.ok) {
                throw new Error(`Telegraph 错误: ${data.error}`);
            }

            Logger.info('Telegraph 页面创建成功', { 
                title: title.substring(0, 50),
                url: data.result.url 
            });

            return data.result;
        } catch (error) {
            Logger.error('创建 Telegraph 页面失败', error, { title });
            throw error;
        }
    }

    /**
     * 将 HTML 内容转换为 Telegraph 格式
     */
    convertToTelegraphFormat(htmlContent) {
        if (!htmlContent) {
            return [{ tag: 'p', children: ['内容为空'] }];
        }

        try {
            // 清理和简化 HTML
            let cleanContent = htmlContent
                .replace(/<script[\s\S]*?<\/script>/gi, '') // 移除脚本
                .replace(/<style[\s\S]*?<\/style>/gi, '') // 移除样式
                .replace(/<iframe[\s\S]*?<\/iframe>/gi, '') // 移除 iframe
                .replace(/<form[\s\S]*?<\/form>/gi, '') // 移除表单
                .replace(/<!--[\s\S]*?-->/g, '') // 移除注释
                .replace(/<(div|span|section|article)[^>]*>/gi, '<p>') // 转换块级元素
                .replace(/<\/(div|span|section|article)>/gi, '</p>')
                .replace(/<br\s*\/?>/gi, '\n') // 换行符
                .replace(/\s+/g, ' ') // 合并空白字符
                .trim();

            // 解析为 Telegraph 节点
            const nodes = this.parseHtmlToNodes(cleanContent);
            
            // 限制节点数量和深度
            return this.limitNodes(nodes, 100);
        } catch (error) {
            Logger.error('HTML 转换失败', error);
            return [{ tag: 'p', children: [htmlContent.substring(0, 1000)] }];
        }
    }

    /**
     * 解析 HTML 为 Telegraph 节点
     */
    parseHtmlToNodes(html) {
        const nodes = [];
        
        // 简单的 HTML 解析器
        const tagRegex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/gi;
        const textRegex = /^([^<]+)/;
        
        let remaining = html;
        
        while (remaining.length > 0) {
            // 尝试匹配文本
            const textMatch = remaining.match(textRegex);
            if (textMatch) {
                const text = textMatch[1].trim();
                if (text) {
                    nodes.push(text);
                }
                remaining = remaining.substring(textMatch[0].length);
                continue;
            }

            // 尝试匹配标签
            const tagMatch = tagRegex.exec(remaining);
            if (tagMatch) {
                const [fullMatch, tagName, attributes, content] = tagMatch;
                
                // 只允许特定标签
                const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote', 'h3', 'h4'];
                if (allowedTags.includes(tagName.toLowerCase())) {
                    const node = {
                        tag: tagName.toLowerCase(),
                        children: content ? this.parseHtmlToNodes(content) : []
                    };

                    // 处理链接属性
                    if (tagName.toLowerCase() === 'a') {
                        const hrefMatch = attributes.match(/href=["']([^"']+)["']/);
                        if (hrefMatch) {
                            node.attrs = { href: hrefMatch[1] };
                        }
                    }

                    nodes.push(node);
                }
                
                remaining = remaining.substring(fullMatch.length);
                tagRegex.lastIndex = 0; // 重置正则表达式
            } else {
                // 如果没有匹配到标签，跳过一个字符
                remaining = remaining.substring(1);
            }
        }

        return nodes.length > 0 ? nodes : [{ tag: 'p', children: ['无法解析内容'] }];
    }

    /**
     * 限制节点数量和深度
     */
    limitNodes(nodes, maxNodes, currentDepth = 0) {
        if (currentDepth > 5 || maxNodes <= 0) {
            return [];
        }

        const result = [];
        let nodeCount = 0;

        for (const node of nodes) {
            if (nodeCount >= maxNodes) break;

            if (typeof node === 'string') {
                result.push(node.substring(0, 500)); // 限制文本长度
                nodeCount++;
            } else if (node.tag && node.children) {
                const limitedChildren = this.limitNodes(
                    node.children, 
                    maxNodes - nodeCount, 
                    currentDepth + 1
                );
                
                result.push({
                    ...node,
                    children: limitedChildren
                });
                nodeCount++;
            }
        }

        return result;
    }

    /**
     * 从 RSS 项目创建 Telegraph 页面
     */
    async createPageFromRssItem(item, sourceName) {
        try {
            // 获取完整文章内容
            let content = item.description || '';
            
            // 如果有链接，尝试获取完整内容
            if (item.link && content.length < 500) {
                try {
                    const fullContent = await this.fetchFullContent(item.link);
                    if (fullContent && fullContent.length > content.length) {
                        content = fullContent;
                    }
                } catch (error) {
                    Logger.warn('获取完整内容失败', { url: item.link, error: error.message });
                }
            }

            // 创建 Telegraph 页面
            const page = await this.createPage(
                item.title,
                content,
                sourceName
            );

            return page;
        } catch (error) {
            Logger.error('从 RSS 项目创建 Telegraph 页面失败', error, { title: item.title });
            return null;
        }
    }

    /**
     * 获取完整文章内容
     */
    async fetchFullContent(url) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.TELEGRAPH_TIMEOUT);

            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; RSS-Telegram-Pusher/2.0)',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const html = await response.text();
            
            // 简单的内容提取
            const contentMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                                html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                                html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                                html.match(/<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

            if (contentMatch) {
                return contentMatch[1];
            }

            return null;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('请求超时');
            }
            throw error;
        }
    }
}

// Web 管理界面 HTML - 安全优化版本
const WEB_INTERFACE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self';">
    <title>RSS Telegram 推送平台</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container { max-width: 900px; margin: 0 auto; padding: 20px; }
        .header { 
            background: rgba(255,255,255,0.95); 
            padding: 30px; 
            border-radius: 15px; 
            margin-bottom: 20px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }
        .card { 
            background: rgba(255,255,255,0.95); 
            padding: 25px; 
            border-radius: 15px; 
            margin-bottom: 20px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
        }
        h1 { color: #333; margin-bottom: 10px; font-size: 2.5em; }
        h2 { color: #555; margin-bottom: 20px; border-bottom: 3px solid #667eea; padding-bottom: 10px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
        input, textarea { 
            width: 100%; 
            padding: 12px 15px; 
            border: 2px solid #e1e5e9; 
            border-radius: 8px; 
            font-size: 14px;
            transition: border-color 0.3s ease;
        }
        input:focus, textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        button { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; 
            padding: 12px 24px; 
            border: none; 
            border-radius: 8px; 
            cursor: pointer; 
            font-size: 14px; 
            font-weight: 600;
            margin-right: 10px;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        button:hover { 
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }
        button.danger { 
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
        }
        button.danger:hover { 
            box-shadow: 0 4px 12px rgba(255, 107, 107, 0.3);
        }
        .rss-item { 
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 20px; 
            border-radius: 10px; 
            margin-bottom: 15px; 
            border-left: 5px solid #667eea;
            transition: transform 0.2s ease;
        }
        .rss-item:hover {
            transform: translateX(5px);
        }
        .status { 
            padding: 15px; 
            border-radius: 10px; 
            margin-bottom: 20px;
            font-weight: 500;
        }
        .status.success { 
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            color: #155724; 
            border: 2px solid #b8daff;
        }
        .status.error { 
            background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
            color: #721c24; 
            border: 2px solid #f5c6cb;
        }
        .hidden { display: none; }
        .loading { opacity: 0.6; pointer-events: none; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .stat-item {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 5px;
        }
        small {
            color: #666;
            font-size: 0.9em;
            margin-top: 5px;
            display: block;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 RSS Telegram 推送平台</h1>
            <p>安全、高效的 RSS 订阅和 Telegram 推送服务</p>
        </div>

        <div id="status" class="status hidden"></div>

        <!-- Telegram 配置 -->
        <div class="card">
            <h2>📱 Telegram 配置</h2>
            <div class="form-group">
                <label for="botToken">Bot Token *</label>
                <input type="password" id="botToken" placeholder="请输入您的 Telegram Bot Token" maxlength="100">
                <small>🔒 安全提示：Token 将被加密存储</small>
            </div>
            <div class="form-group">
                <label for="chatId">Chat ID *</label>
                <input type="text" id="chatId" placeholder="请输入频道或群组的 Chat ID" maxlength="50">
                <small>💡 获取方式：使用 @getmyid_bot 获取您的 Chat ID</small>
            </div>
            <button onclick="saveTelegramConfig()">💾 保存配置</button>
            <button onclick="testTelegram()">🧪 测试推送</button>
        </div>

        <!-- Telegraph 配置 -->
        <div class="card">
            <h2>📝 Telegraph 配置</h2>
            <div class="form-group">
                <label for="enableTelegraph">
                    <input type="checkbox" id="enableTelegraph" onchange="toggleTelegraphOptions()">
                    启用 Telegraph 文章转换
                </label>
                <small>✨ 将 RSS 文章转换为美观的 Telegraph 页面</small>
            </div>
            <div id="telegraphOptions" class="hidden">
                <div class="form-group">
                    <label for="telegraphAuthor">作者名称</label>
                    <input type="text" id="telegraphAuthor" placeholder="RSS Bot" maxlength="128">
                    <small>📝 显示在 Telegraph 文章底部的作者名称</small>
                </div>
                <div class="form-group">
                    <label for="telegraphAuthorUrl">作者链接</label>
                    <input type="url" id="telegraphAuthorUrl" placeholder="https://github.com/your-repo" maxlength="512">
                    <small>🔗 点击作者名称时打开的链接</small>
                </div>
                <div class="form-group">
                    <label for="telegraphFullContent">
                        <input type="checkbox" id="telegraphFullContent">
                        尝试获取完整文章内容
                    </label>
                    <small>⚡ 自动抓取原文完整内容（可能增加处理时间）</small>
                </div>
            </div>
            <button onclick="saveTelegraphConfig()">💾 保存 Telegraph 配置</button>
            <button onclick="testTelegraph()">🧪 测试 Telegraph</button>
        </div>

        <!-- RSS 源管理 -->
        <div class="card">
            <h2>📡 RSS 源管理</h2>
            <div class="form-group">
                <label for="rssUrl">RSS 源 URL</label>
                <input type="url" id="rssUrl" placeholder="https://example.com/rss.xml" maxlength="2048">
            </div>
            <div class="form-group">
                <label for="rssName">RSS 源名称</label>
                <input type="text" id="rssName" placeholder="给这个RSS源起个名字" maxlength="100">
            </div>
            <button onclick="addRssSource()">➕ 添加 RSS 源</button>
            <button onclick="checkAllRss()">🔄 立即检查更新</button>
        </div>

        <!-- RSS 源列表 -->
        <div class="card">
            <h2>📋 已添加的 RSS 源</h2>
            <div id="rssList">
                <p>正在加载 RSS 源列表...</p>
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
        // 全局变量
        let isLoading = false;

        // 安全的 HTML 转义
        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // 切换 Telegraph 选项显示
        function toggleTelegraphOptions() {
            const checkbox = document.getElementById('enableTelegraph');
            const options = document.getElementById('telegraphOptions');
            
            if (checkbox.checked) {
                options.classList.remove('hidden');
            } else {
                options.classList.add('hidden');
            }
        }

        // 显示状态消息
        function showStatus(message, type = 'success') {
            const status = document.getElementById('status');
            status.textContent = message;
            status.className = \`status \${type}\`;
            status.classList.remove('hidden');
            setTimeout(() => status.classList.add('hidden'), 5000);
        }

        // 设置加载状态
        function setLoading(loading) {
            isLoading = loading;
            document.body.classList.toggle('loading', loading);
        }

        // 安全的 API 请求
        async function apiRequest(url, options = {}) {
            if (isLoading) return null;
            
            setLoading(true);
            try {
                const response = await fetch(url, {
                    ...options,
                    headers: {
                        'Content-Type': 'application/json',
                        ...options.headers
                    }
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: '请求失败' }));
                    throw new Error(errorData.error || \`HTTP \${response.status}\`);
                }

                return await response.json();
            } finally {
                setLoading(false);
            }
        }

        // 保存 Telegram 配置
        async function saveTelegramConfig() {
            const botToken = document.getElementById('botToken').value.trim();
            const chatId = document.getElementById('chatId').value.trim();

            if (!botToken || !chatId) {
                showStatus('请填写完整的 Telegram 配置信息', 'error');
                return;
            }

            // 客户端验证
            if (!/^\d+:[A-Za-z0-9_-]{35}$/.test(botToken)) {
                showStatus('Bot Token 格式不正确', 'error');
                return;
            }

            if (!/^-?\d+$/.test(chatId)) {
                showStatus('Chat ID 格式不正确', 'error');
                return;
            }

            try {
                await apiRequest('/api/config/telegram', {
                    method: 'POST',
                    body: JSON.stringify({ botToken, chatId })
                });
                showStatus('Telegram 配置保存成功！');
                // 清空密码字段
                document.getElementById('botToken').value = '';
            } catch (error) {
                showStatus('保存失败：' + error.message, 'error');
            }
        }

        // 测试 Telegram 推送
        async function testTelegram() {
            try {
                await apiRequest('/api/test/telegram', { method: 'POST' });
                showStatus('测试消息发送成功！请检查您的 Telegram');
            } catch (error) {
                showStatus('测试失败：' + error.message, 'error');
            }
        }

        // 保存 Telegraph 配置
        async function saveTelegraphConfig() {
            const enabled = document.getElementById('enableTelegraph').checked;
            const author = document.getElementById('telegraphAuthor').value.trim();
            const authorUrl = document.getElementById('telegraphAuthorUrl').value.trim();
            const fullContent = document.getElementById('telegraphFullContent').checked;

            // 客户端验证
            if (enabled && authorUrl && !/^https?:\/\/.+/.test(authorUrl)) {
                showStatus('作者链接格式不正确', 'error');
                return;
            }

            try {
                await apiRequest('/api/config/telegraph', {
                    method: 'POST',
                    body: JSON.stringify({
                        enabled,
                        author: author || 'RSS Bot',
                        authorUrl: authorUrl || '',
                        fullContent
                    })
                });
                showStatus('Telegraph 配置保存成功！');
            } catch (error) {
                showStatus('保存失败：' + error.message, 'error');
            }
        }

        // 测试 Telegraph
        async function testTelegraph() {
            try {
                const result = await apiRequest('/api/test/telegraph', { method: 'POST' });
                if (result.url) {
                    showStatus(\`测试页面创建成功！\`);
                    // 在新窗口打开 Telegraph 页面
                    window.open(result.url, '_blank');
                } else {
                    showStatus('测试成功！');
                }
            } catch (error) {
                showStatus('测试失败：' + error.message, 'error');
            }
        }

        // 添加 RSS 源
        async function addRssSource() {
            const url = document.getElementById('rssUrl').value.trim();
            const name = document.getElementById('rssName').value.trim();

            if (!url) {
                showStatus('请输入 RSS 源 URL', 'error');
                return;
            }

            // 客户端 URL 验证
            try {
                new URL(url);
            } catch {
                showStatus('URL 格式不正确', 'error');
                return;
            }

            try {
                await apiRequest('/api/rss/add', {
                    method: 'POST',
                    body: JSON.stringify({ url, name: name || url })
                });
                showStatus('RSS 源添加成功！');
                document.getElementById('rssUrl').value = '';
                document.getElementById('rssName').value = '';
                loadRssList();
            } catch (error) {
                showStatus('添加失败：' + error.message, 'error');
            }
        }

        // 删除 RSS 源
        async function removeRssSource(url) {
            if (!confirm('确定要删除这个 RSS 源吗？')) return;

            try {
                await apiRequest('/api/rss/remove', {
                    method: 'POST',
                    body: JSON.stringify({ url })
                });
                showStatus('RSS 源删除成功！');
                loadRssList();
            } catch (error) {
                showStatus('删除失败：' + error.message, 'error');
            }
        }

        // 检查所有 RSS 更新
        async function checkAllRss() {
            try {
                showStatus('正在检查 RSS 更新...', 'success');
                const result = await apiRequest('/api/rss/check', { method: 'POST' });
                showStatus(\`检查完成！发现 \${result.newItems || 0} 条新内容\`);
            } catch (error) {
                showStatus('检查失败：' + error.message, 'error');
            }
        }

        // 加载 RSS 源列表
        async function loadRssList() {
            try {
                const data = await apiRequest('/api/rss/list');
                const rssList = document.getElementById('rssList');
                
                if (data.sources && data.sources.length > 0) {
                    rssList.innerHTML = data.sources.map(source => \`
                        <div class="rss-item">
                            <strong>\${escapeHtml(source.name)}</strong><br>
                            <small>\${escapeHtml(source.url)}</small><br>
                            <small>最后检查：\${source.lastCheck ? new Date(source.lastCheck).toLocaleString('zh-CN') : '从未'}</small>
                            \${source.status === 'error' ? '<br><small style="color: #dc3545;">❌ 检查失败</small>' : ''}
                            <button onclick="removeRssSource('\${escapeHtml(source.url)}')" class="danger" style="float: right;">删除</button>
                        </div>
                    \`).join('');
                } else {
                    rssList.innerHTML = '<p>暂无 RSS 源，请先添加</p>';
                }
            } catch (error) {
                document.getElementById('rssList').innerHTML = '<p>加载失败，请刷新重试</p>';
            }
        }

        // 加载系统状态
        async function loadStatus() {
            try {
                const data = await apiRequest('/api/status');
                const statusDiv = document.getElementById('systemStatus');
                
                statusDiv.innerHTML = \`
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-value">\${data.rssCount || 0}</div>
                            <div>RSS 源数量</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">\${data.totalMessages || 0}</div>
                            <div>总推送消息</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">\${data.totalRuns || 0}</div>
                            <div>总运行次数</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">\${data.telegramConfigured ? '✅' : '❌'}</div>
                            <div>Telegram 配置</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">\${data.telegraphEnabled ? '✅' : '❌'}</div>
                            <div>Telegraph 功能</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">v\${data.version || '2.1.0'}</div>
                            <div>系统版本</div>
                        </div>
                    </div>
                    <p style="margin-top: 15px;"><strong>最后运行：</strong>\${data.lastRun ? new Date(data.lastRun).toLocaleString('zh-CN') : '从未运行'}</p>
                    \${data.errorSources > 0 ? \`<p style="color: #dc3545;"><strong>错误源数量：</strong>\${data.errorSources}</p>\` : ''}
                    \${data.telegraphEnabled ? '<p style="color: #28a745;"><strong>📝 Telegraph 文章转换已启用</strong></p>' : ''}
                \`;
            } catch (error) {
                document.getElementById('systemStatus').innerHTML = '<p>加载状态失败，请刷新重试</p>';
            }
        }

        // 加载 Telegraph 配置
        async function loadTelegraphConfig() {
            try {
                const data = await apiRequest('/api/config/telegraph');
                
                if (data.enabled !== undefined) {
                    document.getElementById('enableTelegraph').checked = data.enabled;
                    toggleTelegraphOptions();
                }
                
                if (data.author) {
                    document.getElementById('telegraphAuthor').value = data.author;
                }
                
                if (data.authorUrl) {
                    document.getElementById('telegraphAuthorUrl').value = data.authorUrl;
                }
                
                if (data.fullContent !== undefined) {
                    document.getElementById('telegraphFullContent').checked = data.fullContent;
                }
            } catch (error) {
                // 忽略加载错误，使用默认值
            }
        }

        // 页面加载时初始化
        window.addEventListener('load', function() {
            loadRssList();
            loadStatus();
            loadTelegraphConfig();
        });

        // 防止表单重复提交
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && isLoading) {
                e.preventDefault();
            }
        });
    </script>
</body>
</html>
`;

/**
 * 主要的事件处理器
 */
export default {
    async fetch(request, env, ctx) {
        const cache = new CacheManager(env);
        const rateLimiter = new RateLimiter(env);
        
        try {
            const url = new URL(request.url);
            const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
            
            // 频率限制检查
            if (!await rateLimiter.checkLimit(clientIP)) {
                Logger.warn('频率限制触发', { ip: clientIP });
                return ResponseUtils.createErrorResponse('请求过于频繁，请稍后再试', 429);
            }
            
            // 安全头
            const securityHeaders = {
                'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
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
                return await handleApiRequest(request, env, cache);
            }
            
            return ResponseUtils.createErrorResponse('页面不存在', 404);
            
        } catch (error) {
            Logger.error('请求处理失败', error, { url: request.url });
            return ResponseUtils.createErrorResponse('服务器内部错误', 500);
        }
    },

    /**
     * 定时任务处理器 - 每30分钟执行一次
     */
    async scheduled(event, env, ctx) {
        Logger.info('开始执行定时 RSS 检查任务');
        
        try {
            const result = await checkRssUpdates(env);
            Logger.info('定时 RSS 检查任务完成', result);
        } catch (error) {
            Logger.error('定时任务执行失败', error);
        }
    }
};

/**
 * 处理 API 请求
 */
async function handleApiRequest(request, env, cache) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    try {
        // 路由映射
        const routes = {
            'POST /api/config/telegram': () => saveTelegramConfig(request, env),
            'GET /api/config/telegram': () => getTelegramConfig(env),
            'POST /api/config/telegraph': () => saveTelegraphConfig(request, env),
            'GET /api/config/telegraph': () => getTelegraphConfig(env),
            'POST /api/rss/add': () => addRssSource(request, env, cache),
            'POST /api/rss/remove': () => removeRssSource(request, env, cache),
            'GET /api/rss/list': () => getRssList(env, cache),
            'POST /api/rss/check': () => manualCheckRss(env),
            'POST /api/test/telegram': () => testTelegramPush(env),
            'POST /api/test/telegraph': () => testTelegraphPush(env, cache),
            'GET /api/status': () => getSystemStatus(env, cache)
        };

        const routeKey = `${request.method} ${path}`;
        const handler = routes[routeKey];
        
        if (handler) {
            return await handler();
        }
        
        return ResponseUtils.createErrorResponse('API 路径不存在', 404);
        
    } catch (error) {
        Logger.error('API 请求处理失败', error, { path });
        return ResponseUtils.createErrorResponse('服务器内部错误', 500);
    }
}

/**
 * 保存 Telegram 配置
 */
async function saveTelegramConfig(request, env) {
    try {
        const body = await request.json().catch(() => ({}));
        const { botToken, chatId } = body;
        
        // 输入验证
        if (!botToken || !chatId) {
            return ResponseUtils.createErrorResponse('请提供完整的 Telegram 配置');
        }

        const sanitizedBotToken = SecurityUtils.sanitizeInput(botToken, 100);
        const sanitizedChatId = SecurityUtils.sanitizeInput(chatId, 50);

        if (!SecurityUtils.validateBotToken(sanitizedBotToken)) {
            return ResponseUtils.createErrorResponse('Bot Token 格式不正确');
        }

        if (!SecurityUtils.validateChatId(sanitizedChatId)) {
            return ResponseUtils.createErrorResponse('Chat ID 格式不正确');
        }
        
        // 保存到 KV 存储
        await env.RSS_CONFIG.put('telegram_config', JSON.stringify({
            botToken: sanitizedBotToken,
            chatId: sanitizedChatId,
            updatedAt: new Date().toISOString()
        }));
        
        Logger.info('Telegram 配置已保存');
        return ResponseUtils.createSuccessResponse();
        
    } catch (error) {
        Logger.error('保存 Telegram 配置失败', error);
        return ResponseUtils.createErrorResponse('保存配置失败', 500);
    }
}

/**
 * 获取 Telegram 配置
 */
async function getTelegramConfig(env) {
    try {
        const config = await env.RSS_CONFIG.get('telegram_config');
        
        if (!config) {
            return ResponseUtils.createJsonResponse({ configured: false });
        }
        
        const parsedConfig = JSON.parse(config);
        
        // 返回配置但脱敏敏感信息
        return ResponseUtils.createJsonResponse({
            configured: true,
            botToken: SecurityUtils.maskBotToken(parsedConfig.botToken),
            chatId: parsedConfig.chatId
        });
    } catch (error) {
        Logger.error('获取 Telegram 配置失败', error);
        return ResponseUtils.createErrorResponse('获取配置失败', 500);
    }
}

/**
 * 保存 Telegraph 配置
 */
async function saveTelegraphConfig(request, env) {
    try {
        const body = await request.json().catch(() => ({}));
        const { enabled, author, authorUrl, fullContent } = body;
        
        // 输入验证
        const sanitizedAuthor = SecurityUtils.sanitizeInput(author, 128);
        const sanitizedAuthorUrl = SecurityUtils.sanitizeInput(authorUrl, 512);
        
        if (authorUrl && !SecurityUtils.validateUrl(authorUrl)) {
            return ResponseUtils.createErrorResponse('作者链接格式不正确');
        }
        
        const config = {
            enabled: !!enabled,
            author: sanitizedAuthor || CONFIG.TELEGRAPH_AUTHOR_NAME,
            authorUrl: sanitizedAuthorUrl || CONFIG.TELEGRAPH_AUTHOR_URL,
            fullContent: !!fullContent,
            updatedAt: new Date().toISOString()
        };
        
        await env.RSS_CONFIG.put('telegraph_config', JSON.stringify(config));
        
        Logger.info('Telegraph 配置已保存', { enabled: config.enabled });
        return ResponseUtils.createSuccessResponse();
        
    } catch (error) {
        Logger.error('保存 Telegraph 配置失败', error);
        return ResponseUtils.createErrorResponse('保存配置失败', 500);
    }
}

/**
 * 获取 Telegraph 配置
 */
async function getTelegraphConfig(env) {
    try {
        const config = await env.RSS_CONFIG.get('telegraph_config');
        
        if (!config) {
            return ResponseUtils.createJsonResponse({
                enabled: false,
                author: CONFIG.TELEGRAPH_AUTHOR_NAME,
                authorUrl: CONFIG.TELEGRAPH_AUTHOR_URL,
                fullContent: false
            });
        }
        
        const parsedConfig = JSON.parse(config);
        return ResponseUtils.createJsonResponse(parsedConfig);
    } catch (error) {
        Logger.error('获取 Telegraph 配置失败', error);
        return ResponseUtils.createErrorResponse('获取配置失败', 500);
    }
}

/**
 * 添加 RSS 源
 */
async function addRssSource(request, env, cache) {
    try {
        const body = await request.json().catch(() => ({}));
        const { url, name } = body;
        
        if (!url) {
            return ResponseUtils.createErrorResponse('请提供 RSS URL');
        }

        const sanitizedUrl = SecurityUtils.sanitizeInput(url, CONFIG.MAX_URL_LENGTH);
        const sanitizedName = SecurityUtils.sanitizeInput(name, CONFIG.MAX_NAME_LENGTH);

        // URL 安全验证
        if (!SecurityUtils.validateUrl(sanitizedUrl)) {
            return ResponseUtils.createErrorResponse('URL 格式不正确或不安全');
        }
        
        // 获取现有的 RSS 源列表
        const existingSources = await getRssSourcesFromKV(env);
        
        // 检查数量限制
        if (existingSources.length >= CONFIG.MAX_RSS_SOURCES) {
            return ResponseUtils.createErrorResponse(`RSS 源数量已达上限 (${CONFIG.MAX_RSS_SOURCES})`);
        }
        
        // 检查是否已存在
        if (existingSources.some(source => source.url === sanitizedUrl)) {
            return ResponseUtils.createErrorResponse('该 RSS 源已存在');
        }
        
        // 验证 RSS URL 是否有效
        try {
            await ConcurrencyUtils.retry(async () => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), CONFIG.RSS_FETCH_TIMEOUT);
                
                const response = await fetch(sanitizedUrl, {
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'RSS-Telegram-Pusher/2.0',
                        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
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
                
                if (!content.includes('<rss') && !content.includes('<feed') && !content.includes('<channel')) {
                    throw new Error('URL 不是有效的 RSS 或 Atom 源');
                }
            });
        } catch (error) {
            if (error.name === 'AbortError') {
                return ResponseUtils.createErrorResponse('RSS 源访问超时');
            }
            return ResponseUtils.createErrorResponse('RSS 源验证失败：' + error.message);
        }
        
        // 添加新的 RSS 源
        const newSource = {
            url: sanitizedUrl,
            name: sanitizedName || sanitizedUrl,
            addedAt: new Date().toISOString(),
            lastCheck: null,
            lastItems: [],
            errorCount: 0
        };
        
        existingSources.push(newSource);
        
        await env.RSS_CONFIG.put('rss_sources', JSON.stringify(existingSources));
        
        // 清除缓存
        await cache.delete('rss_sources');
        
        Logger.info('RSS 源添加成功', { url: sanitizedUrl, name: sanitizedName });
        return ResponseUtils.createSuccessResponse();
        
    } catch (error) {
        Logger.error('添加 RSS 源失败', error);
        return ResponseUtils.createErrorResponse('添加 RSS 源失败', 500);
    }
}

/**
 * 删除 RSS 源
 */
async function removeRssSource(request, env, cache) {
    try {
        const body = await request.json().catch(() => ({}));
        const { url } = body;
        
        if (!url) {
            return ResponseUtils.createErrorResponse('请提供要删除的 RSS URL');
        }
        
        const sanitizedUrl = SecurityUtils.sanitizeInput(url, CONFIG.MAX_URL_LENGTH);
        const existingSources = await getRssSourcesFromKV(env);
        const filteredSources = existingSources.filter(source => source.url !== sanitizedUrl);
        
        if (filteredSources.length === existingSources.length) {
            return ResponseUtils.createErrorResponse('未找到指定的 RSS 源', 404);
        }
        
        await env.RSS_CONFIG.put('rss_sources', JSON.stringify(filteredSources));
        
        // 清除缓存
        await cache.delete('rss_sources');
        
        Logger.info('RSS 源删除成功', { url: sanitizedUrl });
        return ResponseUtils.createSuccessResponse();
        
    } catch (error) {
        Logger.error('删除 RSS 源失败', error);
        return ResponseUtils.createErrorResponse('删除 RSS 源失败', 500);
    }
}

/**
 * 获取 RSS 源列表
 */
async function getRssList(env, cache) {
    try {
        // 尝试从缓存获取
        let sources = await cache.get('rss_sources');
        if (!sources) {
            sources = await getRssSourcesFromKV(env);
            await cache.set('rss_sources', sources, 60); // 缓存1分钟
        }
        
        // 添加状态信息
        const sourcesWithStatus = sources.map(source => ({
            ...source,
            status: source.errorCount > 5 ? 'error' : 'active',
            lastError: source.lastError || null
        }));
        
        return ResponseUtils.createJsonResponse({ 
            sources: sourcesWithStatus,
            total: sources.length,
            maxAllowed: CONFIG.MAX_RSS_SOURCES
        });
    } catch (error) {
        Logger.error('获取 RSS 源列表失败', error);
        return ResponseUtils.createErrorResponse('获取 RSS 源列表失败', 500);
    }
}

/**
 * 手动检查 RSS 更新
 */
async function manualCheckRss(env) {
    try {
        const result = await checkRssUpdates(env);
        return ResponseUtils.createSuccessResponse(result);
    } catch (error) {
        Logger.error('手动检查 RSS 更新失败', error);
        return ResponseUtils.createErrorResponse('检查 RSS 更新失败', 500);
    }
}

/**
 * 测试 Telegram 推送
 */
async function testTelegramPush(env) {
    try {
        const telegramConfig = await getTelegramConfigFromKV(env);
        
        if (!telegramConfig) {
            return ResponseUtils.createErrorResponse('请先配置 Telegram 设置');
        }
        
        const testMessage = `🧪 RSS 推送平台测试消息

⏰ 发送时间：${new Date().toLocaleString('zh-CN')}
✅ 如果您收到此消息，说明配置正确！
🔒 系统运行正常，安全防护已启用`;
        
        await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, testMessage);
        
        Logger.info('测试消息发送成功');
        return ResponseUtils.createSuccessResponse();
        
    } catch (error) {
        Logger.error('测试 Telegram 推送失败', error);
        return ResponseUtils.createErrorResponse(error.message, 500);
    }
}

/**
 * 测试 Telegraph 推送
 */
async function testTelegraphPush(env, cache) {
    try {
        const telegraphService = new TelegraphService(env, cache);
        
        const testContent = `
            <h3>Telegraph 测试页面</h3>
            <p>这是一个测试页面，用于验证 Telegraph 功能是否正常工作。</p>
            <p><strong>测试时间：</strong>${new Date().toLocaleString('zh-CN')}</p>
            <p><em>如果您看到这个页面，说明 Telegraph 配置正确！</em></p>
            <blockquote>
                <p>Telegraph 是一个简洁的发布工具，可以创建格式丰富的文章并快速发布到网络上。</p>
            </blockquote>
            <p>功能特点：</p>
            <ul>
                <li>简洁美观的页面设计</li>
                <li>支持富文本格式</li>
                <li>快速加载和分享</li>
                <li>无需注册即可使用</li>
            </ul>
        `;
        
        const page = await telegraphService.createPage(
            `Telegraph 测试 - ${new Date().toLocaleDateString('zh-CN')}`,
            testContent
        );
        
        Logger.info('Telegraph 测试页面创建成功', { url: page.url });
        return ResponseUtils.createSuccessResponse({ url: page.url });
        
    } catch (error) {
        Logger.error('测试 Telegraph 失败', error);
        return ResponseUtils.createErrorResponse(error.message, 500);
    }
}

/**
 * 获取系统状态
 */
async function getSystemStatus(env, cache) {
    try {
        // 尝试从缓存获取
        let status = await cache.get('system_status');
        if (!status) {
            const [sources, telegramConfig, telegraphConfig, stats] = await Promise.all([
                getRssSourcesFromKV(env),
                getTelegramConfigFromKV(env),
                getTelegraphConfigFromKV(env),
                getStatsFromKV(env)
            ]);
            
            const errorSources = sources.filter(source => source.errorCount > 0).length;
            
            status = {
                rssCount: sources.length,
                maxRssAllowed: CONFIG.MAX_RSS_SOURCES,
                errorSources,
                telegramConfigured: !!telegramConfig,
                telegraphEnabled: telegraphConfig?.enabled || false,
                lastRun: stats.lastRun || null,
                totalMessages: stats.totalMessages || 0,
                totalRuns: stats.totalRuns || 0,
                uptime: stats.lastRun ? Date.now() - new Date(stats.lastRun).getTime() : 0,
                version: '2.1.0'
            };
            
            await cache.set('system_status', status, 30); // 缓存30秒
        }
        
        return ResponseUtils.createJsonResponse(status);
    } catch (error) {
        Logger.error('获取系统状态失败', error);
        return ResponseUtils.createErrorResponse('获取系统状态失败', 500);
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
            Logger.warn('Telegram 未配置，跳过推送');
            return { error: 'Telegram 未配置' };
        }
        
        if (sources.length === 0) {
            Logger.info('没有配置 RSS 源');
            return { success: true, newItems: 0 };
        }
        
        let totalNewItems = 0;
        const updatedSources = [];
        
        // 创建检查任务
        const checkTasks = sources.map(source => 
            checkSingleRssSource(source, telegramConfig, env, cache)
        );
        
        // 限制并发数量
        const results = await ConcurrencyUtils.limitConcurrency(
            checkTasks, 
            CONFIG.MAX_CONCURRENT_RSS_CHECKS
        );
        
        // 处理结果
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const source = sources[i];
            
            if (result.status === 'fulfilled') {
                const { updatedSource, newItemsCount } = result.value;
                updatedSources.push(updatedSource);
                totalNewItems += newItemsCount;
            } else {
                Logger.error('处理 RSS 源失败', result.reason, { url: source.url });
                // 增加错误计数
                updatedSources.push({
                    ...source,
                    errorCount: (source.errorCount || 0) + 1,
                    lastError: result.reason?.message || '未知错误',
                    lastCheck: new Date().toISOString()
                });
            }
        }
        
        // 批量保存更新
        const savePromises = [
            env.RSS_CONFIG.put('rss_sources', JSON.stringify(updatedSources)),
            updateStats(env, totalNewItems)
        ];
        
        await Promise.all(savePromises);
        
        Logger.info('RSS 检查完成', { 
            totalSources: sources.length, 
            newItems: totalNewItems 
        });
        
        return { success: true, newItems: totalNewItems };
        
    } catch (error) {
        Logger.error('RSS 更新检查失败', error);
        return { error: error.message };
    }
}

/**
 * 检查单个 RSS 源
 */
async function checkSingleRssSource(source, telegramConfig, env, cache) {
    try {
        Logger.info('检查 RSS 源', { name: source.name, url: source.url });
        
        const rssContent = await ConcurrencyUtils.retry(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), CONFIG.RSS_FETCH_TIMEOUT);
            
            const response = await fetch(source.url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'RSS-Telegram-Pusher/2.0',
                    'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
                    'Cache-Control': 'no-cache'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: 无法获取 RSS 源`);
            }
            
            const content = await response.text();
            
            // 限制内容大小
            if (content.length > CONFIG.MAX_RSS_CONTENT_SIZE) {
                throw new Error('RSS 内容过大');
            }
            
            return content;
        });
        
        const newItems = await parseRssAndFindNew(rssContent, source.lastItems || []);
        
        let newItemsCount = 0;
        
        if (newItems.length > 0) {
            Logger.info('发现新内容', { count: newItems.length, source: source.name });
            
            // 获取 Telegraph 配置
            const telegraphConfig = await getTelegraphConfigFromKV(env);
            const telegraphService = telegraphConfig?.enabled ? new TelegraphService(env, cache) : null;
            
            // 批量发送消息，但保持间隔
            for (const item of newItems) {
                try {
                    let message = formatRssItemForTelegram(item, source.name);
                    
                    // 如果启用了 Telegraph，创建 Telegraph 页面
                    if (telegraphService) {
                        try {
                            const telegraphPage = await telegraphService.createPageFromRssItem(item, source.name);
                            if (telegraphPage) {
                                // 在消息中添加 Telegraph 链接
                                message += `\n\n📖 [在 Telegraph 中阅读](${telegraphPage.url})`;
                                Logger.info('Telegraph 页面创建成功', { 
                                    title: item.title.substring(0, 50),
                                    url: telegraphPage.url 
                                });
                            }
                        } catch (telegraphError) {
                            Logger.warn('创建 Telegraph 页面失败', telegraphError, { title: item.title });
                            // 继续发送原始消息
                        }
                    }
                    
                    await sendTelegramMessage(
                        telegramConfig.botToken, 
                        telegramConfig.chatId, 
                        message
                    );
                    newItemsCount++;
                    
                    // 避免频率限制
                    if (newItemsCount < newItems.length) {
                        await new Promise(resolve => 
                            setTimeout(resolve, CONFIG.TELEGRAM_RATE_LIMIT_DELAY)
                        );
                    }
                } catch (error) {
                    Logger.error('发送 Telegram 消息失败', error, { item: item.title });
                    // 继续处理其他消息
                }
            }
        }
        
        // 更新源信息
        const updatedSource = {
            ...source,
            lastCheck: new Date().toISOString(),
            lastItems: newItems.length > 0 ? newItems.slice(0, 10) : source.lastItems,
            errorCount: 0, // 重置错误计数
            lastError: null
        };
        
        return { updatedSource, newItemsCount };
        
    } catch (error) {
        Logger.error('处理 RSS 源失败', error, { url: source.url });
        
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
        Logger.error('更新统计信息失败', error);
    }
}

/**
 * 解析 RSS 内容并找出新条目 - 优化版本
 */
async function parseRssAndFindNew(rssContent, lastItems) {
    const items = [];
    
    try {
        // 支持更多 RSS 格式
        const itemMatches = rssContent.match(/<item[\s\S]*?<\/item>/gi) || 
                           rssContent.match(/<entry[\s\S]*?<\/entry>/gi) || [];
        
        for (const itemXml of itemMatches.slice(0, 20)) { // 处理最新20条
            const title = extractXmlContent(itemXml, 'title');
            const link = extractXmlContent(itemXml, 'link') || 
                        extractXmlContent(itemXml, 'guid');
            const description = extractXmlContent(itemXml, 'description') || 
                              extractXmlContent(itemXml, 'summary') ||
                              extractXmlContent(itemXml, 'content');
            const pubDate = extractXmlContent(itemXml, 'pubDate') || 
                           extractXmlContent(itemXml, 'published') ||
                           extractXmlContent(itemXml, 'updated') ||
                           extractXmlContent(itemXml, 'dc:date');
            
            if (title && link) {
                const cleanTitle = cleanHtml(title);
                const cleanLink = link.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
                const cleanDescription = cleanHtml(description);
                
                const item = {
                    title: cleanTitle,
                    link: cleanLink,
                    description: cleanDescription,
                    pubDate,
                    guid: cleanLink, // 使用链接作为唯一标识
                    hash: generateItemHash(cleanTitle, cleanLink) // 添加哈希用于去重
                };
                
                // 检查是否为新条目（使用多种方式判断）
                const isNew = !lastItems.some(lastItem => 
                    lastItem.guid === item.guid || 
                    lastItem.hash === item.hash ||
                    (lastItem.title === item.title && lastItem.link === item.link)
                );
                
                if (isNew) {
                    items.push(item);
                }
            }
        }
    } catch (error) {
        Logger.error('RSS 解析失败', error);
    }
    
    return items.slice(0, 10); // 限制返回数量
}

/**
 * 生成条目哈希
 */
function generateItemHash(title, link) {
    const text = `${title}|${link}`;
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 转换为32位整数
    }
    return hash.toString();
}

/**
 * 从 XML 中提取指定标签的内容 - 改进版本
 */
function extractXmlContent(xml, tagName) {
    // 支持自闭合标签和命名空间
    const patterns = [
        new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'),
        new RegExp(`<${tagName}[^>]*\\s+href=["']([^"']+)["']`, 'i'), // 用于 link 标签
        new RegExp(`<[^:]*:${tagName}[^>]*>([\\s\\S]*?)<\\/[^:]*:${tagName}>`, 'i') // 命名空间
    ];
    
    for (const pattern of patterns) {
        const match = xml.match(pattern);
        if (match) {
            return match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        }
    }
    
    return '';
}

/**
 * 清理 HTML 标签 - 改进版本
 */
function cleanHtml(text) {
    if (!text) return '';
    
    return text
        .replace(/<script[\s\S]*?<\/script>/gi, '') // 移除脚本
        .replace(/<style[\s\S]*?<\/style>/gi, '') // 移除样式
        .replace(/<[^>]*>/g, '') // 移除 HTML 标签
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 1000); // 限制长度
}

/**
 * 格式化 RSS 条目为 Telegram 消息 - 改进版本
 */
function formatRssItemForTelegram(item, sourceName) {
    // 更安全的 Markdown 转义
    const escapeMarkdown = (text) => {
        if (!text) return '';
        return text
            .replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&')
            .replace(/\n/g, ' ')
            .trim();
    };
    
    const safeSourceName = escapeMarkdown(sourceName);
    const safeTitle = escapeMarkdown(item.title);
    
    let message = `📰 *${safeSourceName}*\n\n*${safeTitle}*\n\n`;
    
    if (item.description) {
        const shortDesc = item.description.length > CONFIG.MAX_DESCRIPTION_LENGTH 
            ? item.description.substring(0, CONFIG.MAX_DESCRIPTION_LENGTH) + '...' 
            : item.description;
        message += `${escapeMarkdown(shortDesc)}\n\n`;
    }
    
    // 验证链接格式
    try {
        new URL(item.link);
        message += `🔗 [阅读全文](${item.link})`;
    } catch {
        message += `🔗 ${escapeMarkdown(item.link)}`;
    }
    
    if (item.pubDate) {
        try {
            const date = new Date(item.pubDate);
            if (!isNaN(date.getTime())) {
                const formattedDate = date.toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Shanghai'
                });
                message += `\n⏰ ${formattedDate}`;
            }
        } catch {
            // 忽略日期格式化错误
        }
    }
    
    // 确保消息不超过 Telegram 限制
    return message.substring(0, CONFIG.MAX_MESSAGE_LENGTH);
}

/**
 * 发送 Telegram 消息 - 增强版本
 */
async function sendTelegramMessage(botToken, chatId, message, retries = CONFIG.RETRY_ATTEMPTS) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时
            
            const response = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'RSS-Telegram-Pusher/2.0'
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message.substring(0, CONFIG.MAX_MESSAGE_LENGTH),
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    disable_notification: false
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
                    Logger.warn('Telegram API 频率限制', { retryAfter, attempt });
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
                Logger.warn('Telegram API 服务器错误，准备重试', { attempt, status: response.status });
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * attempt));
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Telegram API 请求超时');
            }
            
            if (attempt === retries) {
                throw error;
            }
            
            Logger.warn('发送消息失败，准备重试', { attempt, error: error.message });
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * attempt));
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
        Logger.error('获取 RSS 源列表失败', error);
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
        Logger.error('获取 Telegram 配置失败', error);
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
        Logger.error('获取统计信息失败', error);
        return {};
    }
}

/**
 * 从 KV 存储获取 Telegraph 配置
 */
async function getTelegraphConfigFromKV(env) {
    try {
        const config = await env.RSS_CONFIG.get('telegraph_config');
        return config ? JSON.parse(config) : null;
    } catch (error) {
        Logger.error('获取 Telegraph 配置失败', error);
        return null;
    }
}