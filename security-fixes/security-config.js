// 安全配置和最佳实践
const SECURITY_CONFIG = {
    // 增强的配置常量
    MAX_RSS_SOURCES: 50,
    MAX_RSS_CONTENT_SIZE: 5 * 1024 * 1024, // 5MB
    MAX_DESCRIPTION_LENGTH: 200,
    MAX_INPUT_LENGTH: 1000,
    MAX_URL_LENGTH: 2048,
    MAX_NAME_LENGTH: 100,
    
    // 安全相关配置
    CSRF_TOKEN_LENGTH: 32,
    SESSION_TIMEOUT: 3600, // 1小时
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION: 900, // 15分钟
    
    // 频率限制配置
    RATE_LIMIT: {
        GLOBAL: { requests: 1000, window: 60 },
        PER_IP: { requests: 60, window: 60 },
        PER_ENDPOINT: { requests: 30, window: 60 },
        SUSPICIOUS_UA: { requests: 6, window: 60 }
    },
    
    // 内容安全配置
    ALLOWED_HTML_TAGS: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
        'a', 'code', 'pre', 'blockquote', 'h3', 'h4'
    ],
    
    BLOCKED_PROTOCOLS: [
        'javascript:', 'data:', 'vbscript:', 'file:',
        'ftp:', 'gopher:', 'dict:', 'ldap:', 'jar:'
    ],
    
    // 安全头配置
    SECURITY_HEADERS: {
        'Content-Security-Policy': [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "connect-src 'self' https://api.telegram.org https://api.telegra.ph",
            "font-src 'self'",
            "object-src 'none'",
            "media-src 'none'",
            "frame-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "upgrade-insecure-requests"
        ].join('; '),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': [
            'geolocation=()',
            'microphone=()',
            'camera=()',
            'payment=()',
            'usb=()',
            'magnetometer=()',
            'gyroscope=()',
            'speaker=()',
            'fullscreen=()',
            'sync-xhr=()'
        ].join(', '),
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    }
};

// 安全工具类
class SecurityManager {
    constructor(env) {
        this.env = env;
    }
    
    // 创建安全响应
    createSecureResponse(data, status = 200, additionalHeaders = {}) {
        const headers = {
            'Content-Type': 'application/json; charset=utf-8',
            ...SECURITY_CONFIG.SECURITY_HEADERS,
            ...additionalHeaders
        };
        
        return new Response(JSON.stringify(data), { status, headers });
    }
    
    // 验证请求安全性
    async validateRequestSecurity(request) {
        const checks = [
            this.checkContentLength(request),
            this.checkUserAgent(request),
            this.checkOrigin(request),
            this.checkMethod(request)
        ];
        
        for (const check of checks) {
            const result = await check;
            if (!result.valid) {
                return result;
            }
        }
        
        return { valid: true };
    }
    
    // 检查内容长度
    checkContentLength(request) {
        const contentLength = request.headers.get('Content-Length');
        if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) { // 10MB
            return {
                valid: false,
                error: 'Request too large',
                status: 413
            };
        }
        return { valid: true };
    }
    
    // 检查 User-Agent
    checkUserAgent(request) {
        const userAgent = request.headers.get('User-Agent');
        if (!userAgent || userAgent.length < 10) {
            return {
                valid: false,
                error: 'Invalid User-Agent',
                status: 400
            };
        }
        return { valid: true };
    }
    
    // 检查来源
    checkOrigin(request) {
        const method = request.method.toUpperCase();
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            const origin = request.headers.get('Origin');
            const referer = request.headers.get('Referer');
            
            // 对于状态改变的请求，需要有合法的来源
            if (!origin && !referer) {
                return {
                    valid: false,
                    error: 'Missing origin information',
                    status: 403
                };
            }
        }
        return { valid: true };
    }
    
    // 检查 HTTP 方法
    checkMethod(request) {
        const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'];
        if (!allowedMethods.includes(request.method.toUpperCase())) {
            return {
                valid: false,
                error: 'Method not allowed',
                status: 405
            };
        }
        return { valid: true };
    }
    
    // 记录安全事件
    async logSecurityEvent(event, details = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            event: event,
            details: details,
            severity: this.getEventSeverity(event)
        };
        
        try {
            const key = `security_log:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
            await this.env.RSS_CONFIG.put(key, JSON.stringify(logEntry), { expirationTtl: 86400 * 7 }); // 保存7天
        } catch (error) {
            console.error('Failed to log security event:', error);
        }
    }
    
    // 获取事件严重性
    getEventSeverity(event) {
        const severityMap = {
            'rate_limit_exceeded': 'medium',
            'invalid_csrf_token': 'high',
            'suspicious_request': 'medium',
            'xss_attempt': 'high',
            'ssrf_attempt': 'high',
            'invalid_input': 'low',
            'authentication_failure': 'medium'
        };
        
        return severityMap[event] || 'low';
    }
    
    // 获取客户端信息
    getClientInfo(request) {
        return {
            ip: request.headers.get('CF-Connecting-IP') || 
                request.headers.get('X-Forwarded-For') || 
                request.headers.get('X-Real-IP') || 
                'unknown',
            userAgent: request.headers.get('User-Agent') || 'unknown',
            country: request.headers.get('CF-IPCountry') || 'unknown',
            asn: request.headers.get('CF-ASN') || 'unknown',
            timestamp: new Date().toISOString()
        };
    }
    
    // 检查是否为可信来源
    isTrustedSource(request) {
        const clientInfo = this.getClientInfo(request);
        
        // 检查是否来自可信的 ASN
        const trustedASNs = ['13335']; // Cloudflare ASN
        if (trustedASNs.includes(clientInfo.asn)) {
            return true;
        }
        
        // 检查是否来自可信的国家
        const blockedCountries = ['CN', 'RU', 'KP']; // 示例
        if (blockedCountries.includes(clientInfo.country)) {
            return false;
        }
        
        return true;
    }
}

// 输入验证器
class InputValidator {
    // 验证 RSS URL
    static validateRSSUrl(url) {
        if (!url || typeof url !== 'string') {
            return { valid: false, error: 'URL is required' };
        }
        
        if (url.length > SECURITY_CONFIG.MAX_URL_LENGTH) {
            return { valid: false, error: 'URL too long' };
        }
        
        try {
            const parsedUrl = new URL(url);
            
            // 检查协议
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                return { valid: false, error: 'Invalid protocol' };
            }
            
            // 检查是否包含危险字符
            const dangerousPatterns = [
                /@/, /\.\./, /javascript:/, /data:/, /vbscript:/
            ];
            
            if (dangerousPatterns.some(pattern => pattern.test(url))) {
                return { valid: false, error: 'URL contains dangerous patterns' };
            }
            
            return { valid: true };
        } catch {
            return { valid: false, error: 'Invalid URL format' };
        }
    }
    
    // 验证 Telegram Bot Token
    static validateBotToken(token) {
        if (!token || typeof token !== 'string') {
            return { valid: false, error: 'Bot token is required' };
        }
        
        if (!SECURITY_CONFIG.BOT_TOKEN_PATTERN?.test(token)) {
            return { valid: false, error: 'Invalid bot token format' };
        }
        
        return { valid: true };
    }
    
    // 验证 Chat ID
    static validateChatId(chatId) {
        if (!chatId || typeof chatId !== 'string') {
            return { valid: false, error: 'Chat ID is required' };
        }
        
        if (!SECURITY_CONFIG.CHAT_ID_PATTERN?.test(chatId)) {
            return { valid: false, error: 'Invalid chat ID format' };
        }
        
        return { valid: true };
    }
    
    // 通用文本验证
    static validateText(text, maxLength = SECURITY_CONFIG.MAX_INPUT_LENGTH, required = false) {
        if (required && (!text || typeof text !== 'string')) {
            return { valid: false, error: 'Text is required' };
        }
        
        if (text && text.length > maxLength) {
            return { valid: false, error: `Text too long (max ${maxLength} characters)` };
        }
        
        // 检查是否包含危险字符
        const dangerousPatterns = [
            /<script/i, /javascript:/i, /vbscript:/i, /on\w+=/i
        ];
        
        if (text && dangerousPatterns.some(pattern => pattern.test(text))) {
            return { valid: false, error: 'Text contains dangerous content' };
        }
        
        return { valid: true };
    }
}

export { SECURITY_CONFIG, SecurityManager, InputValidator };