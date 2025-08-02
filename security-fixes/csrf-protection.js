// CSRF 保护机制
class CSRFProtection {
    constructor(env) {
        this.env = env;
    }
    
    // 生成 CSRF Token
    static generateCSRFToken() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    
    // 验证 CSRF Token
    async validateCSRFToken(request, token) {
        try {
            // 从请求头或请求体中获取 token
            const submittedToken = request.headers.get('X-CSRF-Token') || 
                                 request.headers.get('X-Requested-With') ||
                                 (await this.getTokenFromBody(request));
            
            if (!submittedToken || !token) {
                return false;
            }
            
            // 时间常数比较防止时序攻击
            return this.constantTimeCompare(submittedToken, token);
        } catch {
            return false;
        }
    }
    
    // 从请求体获取 token
    async getTokenFromBody(request) {
        try {
            if (request.headers.get('Content-Type')?.includes('application/json')) {
                const body = await request.json();
                return body.csrfToken;
            }
        } catch {
            // 忽略解析错误
        }
        return null;
    }
    
    // 时间常数比较
    constantTimeCompare(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        
        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        
        return result === 0;
    }
    
    // 存储 CSRF Token
    async storeCSRFToken(sessionId, token) {
        const key = `csrf_token:${sessionId}`;
        await this.env.RSS_CONFIG.put(key, token, { expirationTtl: 3600 }); // 1小时过期
    }
    
    // 获取存储的 CSRF Token
    async getStoredCSRFToken(sessionId) {
        const key = `csrf_token:${sessionId}`;
        return await this.env.RSS_CONFIG.get(key);
    }
    
    // 生成会话 ID
    static generateSessionId() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    
    // 中间件：CSRF 保护
    async csrfMiddleware(request) {
        const method = request.method.toUpperCase();
        
        // 只对状态改变的请求进行 CSRF 检查
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            const sessionId = request.headers.get('X-Session-ID') || 
                            this.getSessionIdFromCookie(request);
            
            if (!sessionId) {
                return {
                    valid: false,
                    error: 'Missing session ID'
                };
            }
            
            const storedToken = await this.getStoredCSRFToken(sessionId);
            const isValid = await this.validateCSRFToken(request, storedToken);
            
            if (!isValid) {
                return {
                    valid: false,
                    error: 'Invalid CSRF token'
                };
            }
        }
        
        return { valid: true };
    }
    
    // 从 Cookie 获取会话 ID
    getSessionIdFromCookie(request) {
        const cookieHeader = request.headers.get('Cookie');
        if (!cookieHeader) return null;
        
        const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
            const [key, value] = cookie.trim().split('=');
            acc[key] = value;
            return acc;
        }, {});
        
        return cookies.sessionId;
    }
    
    // 创建安全的响应头
    static createSecureResponse(data, status = 200, sessionId = null, csrfToken = null) {
        const headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        };
        
        // 添加 CSRF Token 到响应头
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }
        
        // 设置安全的 Cookie
        if (sessionId) {
            headers['Set-Cookie'] = [
                `sessionId=${sessionId}`,
                'HttpOnly',
                'Secure',
                'SameSite=Strict',
                'Max-Age=3600',
                'Path=/'
            ].join('; ');
        }
        
        return new Response(JSON.stringify(data), { status, headers });
    }
}

// 使用示例
class SecureAPIHandler {
    constructor(env) {
        this.env = env;
        this.csrfProtection = new CSRFProtection(env);
    }
    
    async handleSecureRequest(request) {
        // CSRF 验证
        const csrfResult = await this.csrfProtection.csrfMiddleware(request);
        if (!csrfResult.valid) {
            return CSRFProtection.createSecureResponse(
                { error: 'CSRF validation failed: ' + csrfResult.error },
                403
            );
        }
        
        // 处理实际请求
        // ... 业务逻辑
        
        return CSRFProtection.createSecureResponse({ success: true });
    }
    
    // 初始化会话和 CSRF Token
    async initializeSession() {
        const sessionId = CSRFProtection.generateSessionId();
        const csrfToken = CSRFProtection.generateCSRFToken();
        
        await this.csrfProtection.storeCSRFToken(sessionId, csrfToken);
        
        return CSRFProtection.createSecureResponse(
            { 
                message: 'Session initialized',
                csrfToken: csrfToken 
            },
            200,
            sessionId,
            csrfToken
        );
    }
}