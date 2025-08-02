// 增强的 XSS 防护
class EnhancedXSSProtection {
    // 更严格的 HTML 转义
    static escapeHtml(text) {
        if (!text) return '';
        
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '/': '&#x2F;',
            '`': '&#x60;',
            '=': '&#x3D;',
            '{': '&#x7B;',
            '}': '&#x7D;'
        };
        
        return text.replace(/[&<>"'`=\/{}]/g, (char) => escapeMap[char]);
    }
    
    // 内容安全过滤器
    static sanitizeContent(content) {
        if (!content) return '';
        
        // 移除潜在的危险内容
        let sanitized = content
            // 移除脚本标签
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<script[^>]*>/gi, '')
            
            // 移除样式标签
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<style[^>]*>/gi, '')
            
            // 移除链接标签
            .replace(/<link[\s\S]*?>/gi, '')
            
            // 移除元标签
            .replace(/<meta[\s\S]*?>/gi, '')
            
            // 移除对象和嵌入标签
            .replace(/<(object|embed|applet|iframe|frame|frameset)[\s\S]*?<\/\1>/gi, '')
            .replace(/<(object|embed|applet|iframe|frame|frameset)[^>]*>/gi, '')
            
            // 移除表单标签
            .replace(/<(form|input|textarea|select|button)[\s\S]*?<\/\1>/gi, '')
            .replace(/<(form|input|textarea|select|button)[^>]*>/gi, '')
            
            // 移除事件处理器
            .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '')
            
            // 移除 javascript: 协议
            .replace(/javascript\s*:/gi, '')
            
            // 移除 data: 协议（除了图片）
            .replace(/data\s*:(?!image\/)/gi, '')
            
            // 移除 vbscript: 协议
            .replace(/vbscript\s*:/gi, '')
            
            // 移除表达式
            .replace(/expression\s*\(/gi, '')
            
            // 移除 CSS 导入
            .replace(/@import/gi, '');
        
        return this.escapeHtml(sanitized);
    }
    
    // Telegraph 内容安全转换
    static sanitizeTelegraphContent(htmlContent) {
        if (!htmlContent) {
            return [{ tag: 'p', children: ['内容为空'] }];
        }

        try {
            // 首先进行基本的安全清理
            let cleanContent = this.sanitizeContent(htmlContent);
            
            // 进一步清理和简化 HTML
            cleanContent = cleanContent
                .replace(/<(div|span|section|article)[^>]*>/gi, '<p>')
                .replace(/<\/(div|span|section|article)>/gi, '</p>')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/\s+/g, ' ')
                .trim();

            // 解析为 Telegraph 节点
            const nodes = this.parseHtmlToSafeNodes(cleanContent);
            
            // 限制节点数量和深度
            return this.limitNodes(nodes, 100);
        } catch (error) {
            console.error('HTML 转换失败:', error);
            return [{ tag: 'p', children: [this.escapeHtml(htmlContent.substring(0, 1000))] }];
        }
    }
    
    // 安全的 HTML 解析
    static parseHtmlToSafeNodes(html) {
        const nodes = [];
        
        // 允许的标签白名单
        const allowedTags = new Set([
            'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 
            'a', 'code', 'pre', 'blockquote', 'h3', 'h4'
        ]);
        
        // 简单但安全的 HTML 解析器
        const tagRegex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/gi;
        const textRegex = /^([^<]+)/;
        
        let remaining = html;
        
        while (remaining.length > 0) {
            // 尝试匹配文本
            const textMatch = remaining.match(textRegex);
            if (textMatch) {
                const text = textMatch[1].trim();
                if (text) {
                    nodes.push(this.escapeHtml(text));
                }
                remaining = remaining.substring(textMatch[0].length);
                continue;
            }

            // 尝试匹配标签
            const tagMatch = tagRegex.exec(remaining);
            if (tagMatch) {
                const [fullMatch, tagName, attributes, content] = tagMatch;
                
                // 只允许白名单中的标签
                if (allowedTags.has(tagName.toLowerCase())) {
                    const node = {
                        tag: tagName.toLowerCase(),
                        children: content ? this.parseHtmlToSafeNodes(content) : []
                    };

                    // 安全处理链接属性
                    if (tagName.toLowerCase() === 'a') {
                        const hrefMatch = attributes.match(/href\s*=\s*["']([^"']+)["']/);
                        if (hrefMatch && this.isValidUrl(hrefMatch[1])) {
                            node.attrs = { href: hrefMatch[1] };
                        }
                    }

                    nodes.push(node);
                }
                
                remaining = remaining.substring(fullMatch.length);
                tagRegex.lastIndex = 0;
            } else {
                // 如果没有匹配到标签，跳过一个字符
                remaining = remaining.substring(1);
            }
        }

        return nodes.length > 0 ? nodes : [{ tag: 'p', children: ['无法解析内容'] }];
    }
    
    // URL 验证
    static isValidUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return ['http:', 'https:'].includes(parsedUrl.protocol) &&
                   !url.toLowerCase().includes('javascript:') &&
                   !url.toLowerCase().includes('data:') &&
                   !url.toLowerCase().includes('vbscript:');
        } catch {
            return false;
        }
    }
    
    // 限制节点数量和深度
    static limitNodes(nodes, maxNodes, currentDepth = 0) {
        if (currentDepth > 5 || maxNodes <= 0) {
            return [];
        }

        const result = [];
        let nodeCount = 0;

        for (const node of nodes) {
            if (nodeCount >= maxNodes) break;

            if (typeof node === 'string') {
                // 限制文本长度并转义
                result.push(this.escapeHtml(node.substring(0, 500)));
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
    
    // 增强的 CSP 头
    static getSecurityHeaders() {
        return {
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
                "form-action 'self'"
            ].join('; '),
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), speaker=()',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
        };
    }
}