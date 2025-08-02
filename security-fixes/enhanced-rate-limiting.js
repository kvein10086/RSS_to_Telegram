// 增强的频率限制系统
class EnhancedRateLimiter {
    constructor(env) {
        this.env = env;
    }
    
    // 多层级频率限制
    async checkMultiLayerLimit(identifier, endpoint, userAgent = '') {
        const checks = [
            // IP 级别限制
            this.checkIPLimit(identifier),
            // 端点级别限制
            this.checkEndpointLimit(identifier, endpoint),
            // User-Agent 级别限制（防止自动化工具）
            this.checkUserAgentLimit(userAgent),
            // 全局限制
            this.checkGlobalLimit()
        ];
        
        const results = await Promise.all(checks);
        
        // 如果任何一个检查失败，返回失败
        for (let i = 0; i < results.length; i++) {
            if (!results[i].allowed) {
                return {
                    allowed: false,
                    reason: results[i].reason,
                    retryAfter: results[i].retryAfter
                };
            }
        }
        
        return { allowed: true };
    }
    
    // IP 级别限制
    async checkIPLimit(ip, maxRequests = 60, windowMinutes = 1) {
        const key = `rate_limit:ip:${ip}`;
        return await this.checkLimit(key, maxRequests, windowMinutes * 60);
    }
    
    // 端点级别限制
    async checkEndpointLimit(ip, endpoint, maxRequests = 30, windowMinutes = 1) {
        const key = `rate_limit:endpoint:${ip}:${endpoint}`;
        return await this.checkLimit(key, maxRequests, windowMinutes * 60);
    }
    
    // User-Agent 级别限制
    async checkUserAgentLimit(userAgent, maxRequests = 100, windowMinutes = 5) {
        if (!userAgent) {
            return { allowed: false, reason: 'Missing User-Agent', retryAfter: 60 };
        }
        
        // 检查是否为可疑的 User-Agent
        const suspiciousPatterns = [
            /bot/i,
            /crawler/i,
            /spider/i,
            /scraper/i,
            /curl/i,
            /wget/i,
            /python/i,
            /java/i,
            /go-http/i,
            /^$/
        ];
        
        const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));
        if (isSuspicious) {
            maxRequests = Math.floor(maxRequests * 0.1); // 降低限制
        }
        
        const key = `rate_limit:ua:${this.hashString(userAgent)}`;
        return await this.checkLimit(key, maxRequests, windowMinutes * 60);
    }
    
    // 全局限制
    async checkGlobalLimit(maxRequests = 1000, windowMinutes = 1) {
        const key = `rate_limit:global`;
        return await this.checkLimit(key, maxRequests, windowMinutes * 60);
    }
    
    // 基础限制检查
    async checkLimit(key, maxRequests, windowSeconds) {
        try {
            const now = Date.now();
            const windowStart = now - (windowSeconds * 1000);
            
            const existing = await this.env.RSS_CONFIG.get(key);
            let requests = existing ? JSON.parse(existing) : [];
            
            // 清理过期请求
            requests = requests.filter(timestamp => timestamp > windowStart);
            
            if (requests.length >= maxRequests) {
                const oldestRequest = Math.min(...requests);
                const retryAfter = Math.ceil((oldestRequest + windowSeconds * 1000 - now) / 1000);
                
                return {
                    allowed: false,
                    reason: 'Rate limit exceeded',
                    retryAfter: Math.max(retryAfter, 1)
                };
            }
            
            // 添加当前请求
            requests.push(now);
            
            // 保存更新后的请求列表
            await this.env.RSS_CONFIG.put(
                key, 
                JSON.stringify(requests), 
                { expirationTtl: windowSeconds + 60 }
            );
            
            return { allowed: true };
        } catch (error) {
            console.error('Rate limit check failed:', error);
            // 出错时允许请求，但记录错误
            return { allowed: true };
        }
    }
    
    // 自适应频率限制
    async adaptiveRateLimit(identifier, endpoint, requestSize = 0) {
        const baseLimit = 60;
        let adjustedLimit = baseLimit;
        
        // 根据请求大小调整限制
        if (requestSize > 1024) { // 1KB
            adjustedLimit = Math.floor(baseLimit * 0.5);
        }
        
        // 根据历史行为调整限制
        const behaviorScore = await this.getBehaviorScore(identifier);
        if (behaviorScore < 0.5) {
            adjustedLimit = Math.floor(adjustedLimit * 0.3);
        }
        
        return await this.checkIPLimit(identifier, adjustedLimit);
    }
    
    // 获取行为评分
    async getBehaviorScore(identifier) {
        try {
            const key = `behavior_score:${identifier}`;
            const score = await this.env.RSS_CONFIG.get(key);
            return score ? parseFloat(score) : 1.0;
        } catch {
            return 1.0;
        }
    }
    
    // 更新行为评分
    async updateBehaviorScore(identifier, action) {
        try {
            const key = `behavior_score:${identifier}`;
            let score = await this.getBehaviorScore(identifier);
            
            // 根据行为调整评分
            switch (action) {
                case 'success':
                    score = Math.min(1.0, score + 0.01);
                    break;
                case 'error':
                    score = Math.max(0.0, score - 0.05);
                    break;
                case 'suspicious':
                    score = Math.max(0.0, score - 0.1);
                    break;
            }
            
            await this.env.RSS_CONFIG.put(key, score.toString(), { expirationTtl: 86400 });
        } catch (error) {
            console.error('Failed to update behavior score:', error);
        }
    }
    
    // 字符串哈希函数
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString();
    }
    
    // 检查是否为可疑请求
    isSuspiciousRequest(request) {
        const userAgent = request.headers.get('User-Agent') || '';
        const referer = request.headers.get('Referer') || '';
        const origin = request.headers.get('Origin') || '';
        
        // 检查缺少必要头部
        if (!userAgent) {
            return { suspicious: true, reason: 'Missing User-Agent' };
        }
        
        // 检查可疑的 User-Agent
        const suspiciousUA = [
            /bot/i, /crawler/i, /spider/i, /scraper/i,
            /curl/i, /wget/i, /python/i, /java/i
        ];
        
        if (suspiciousUA.some(pattern => pattern.test(userAgent))) {
            return { suspicious: true, reason: 'Suspicious User-Agent' };
        }
        
        // 检查请求频率模式
        const timestamp = Date.now();
        const requestPattern = this.analyzeRequestPattern(request.headers.get('CF-Connecting-IP'), timestamp);
        
        if (requestPattern.suspicious) {
            return { suspicious: true, reason: 'Suspicious request pattern' };
        }
        
        return { suspicious: false };
    }
    
    // 分析请求模式
    analyzeRequestPattern(ip, timestamp) {
        // 这里可以实现更复杂的模式分析
        // 例如检查请求间隔是否过于规律等
        return { suspicious: false };
    }
    
    // 创建限制响应
    static createRateLimitResponse(retryAfter = 60) {
        return new Response(
            JSON.stringify({
                error: 'Rate limit exceeded',
                retryAfter: retryAfter,
                timestamp: new Date().toISOString()
            }),
            {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': retryAfter.toString(),
                    'X-RateLimit-Limit': '60',
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': (Date.now() + retryAfter * 1000).toString()
                }
            }
        );
    }
}