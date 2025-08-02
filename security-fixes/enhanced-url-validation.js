// 增强的 URL 验证函数
class EnhancedSecurityUtils {
    static validateUrl(url) {
        try {
            const parsedUrl = new URL(url);
            
            // 检查协议
            if (!CONFIG.ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
                return false;
            }
            
            const hostname = parsedUrl.hostname.toLowerCase();
            const port = parsedUrl.port;
            
            // 扩展的内网地址检查
            const privateNetworks = [
                // IPv4 私有网络
                /^10\./,
                /^172\.(1[6-9]|2[0-9]|3[01])\./,
                /^192\.168\./,
                /^127\./,
                /^0\.0\.0\.0$/,
                
                // 本地主机
                /^localhost$/,
                /^.*\.localhost$/,
                
                // IPv6 私有地址
                /^::1$/,
                /^fe80:/,
                /^fc00:/,
                /^fd00:/,
                
                // 云服务元数据端点
                /^169\.254\.169\.254$/,
                /^metadata\.google\.internal$/,
                /^169\.254\./,
                
                // 特殊用途地址
                /^0\./,
                /^224\./,  // 组播地址
                /^255\./,  // 广播地址
                
                // 危险域名
                /^.*\.internal$/,
                /^.*\.local$/,
                /^.*\.corp$/,
                /^.*\.lan$/
            ];
            
            // 检查是否匹配私有网络
            if (privateNetworks.some(pattern => pattern.test(hostname))) {
                return false;
            }
            
            // 检查危险端口
            const dangerousPorts = [
                22,    // SSH
                23,    // Telnet
                25,    // SMTP
                53,    // DNS
                110,   // POP3
                143,   // IMAP
                993,   // IMAPS
                995,   // POP3S
                1433,  // SQL Server
                3306,  // MySQL
                5432,  // PostgreSQL
                6379,  // Redis
                27017, // MongoDB
                9200,  // Elasticsearch
                11211  // Memcached
            ];
            
            if (port && dangerousPorts.includes(parseInt(port))) {
                return false;
            }
            
            // 检查 URL 长度
            if (url.length > 2048) {
                return false;
            }
            
            // 检查是否包含危险字符
            const dangerousPatterns = [
                /@/,           // 用户信息
                /\.\./,        // 路径遍历
                /file:/,       // 文件协议
                /ftp:/,        // FTP 协议
                /gopher:/,     // Gopher 协议
                /dict:/,       // Dict 协议
                /ldap:/,       // LDAP 协议
                /jar:/,        // JAR 协议
                /netdoc:/,     // NetDoc 协议
            ];
            
            if (dangerousPatterns.some(pattern => pattern.test(url.toLowerCase()))) {
                return false;
            }
            
            return true;
        } catch {
            return false;
        }
    }
    
    // DNS 解析验证（可选，需要在实际环境中实现）
    static async validateUrlWithDNS(url) {
        // 在 Cloudflare Workers 中，可以使用 DoH 进行 DNS 查询
        // 这里提供一个概念性的实现
        try {
            const parsedUrl = new URL(url);
            const hostname = parsedUrl.hostname;
            
            // 使用 Cloudflare DoH 服务查询 IP
            const dohResponse = await fetch(
                `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`,
                {
                    headers: {
                        'Accept': 'application/dns-json'
                    }
                }
            );
            
            const dnsResult = await dohResponse.json();
            
            if (dnsResult.Answer) {
                for (const answer of dnsResult.Answer) {
                    if (answer.type === 1) { // A 记录
                        const ip = answer.data;
                        if (!this.isPublicIP(ip)) {
                            return false;
                        }
                    }
                }
            }
            
            return true;
        } catch {
            return false;
        }
    }
    
    static isPublicIP(ip) {
        const privateRanges = [
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[01])\./,
            /^192\.168\./,
            /^127\./,
            /^169\.254\./,
            /^0\./,
            /^224\./,
            /^255\./
        ];
        
        return !privateRanges.some(range => range.test(ip));
    }
}