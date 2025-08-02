/**
 * RSS Telegram 推送平台 - 最小化部署版本
 * 用于首次部署，不依赖 KV 存储
 */

// 简单的 Web 界面
const MINIMAL_WEB_INTERFACE = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RSS Telegram 推送平台 - 设置中</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container { 
            max-width: 600px; 
            margin: 0 auto; 
            padding: 40px; 
            background: rgba(255,255,255,0.95); 
            border-radius: 15px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            backdrop-filter: blur(10px);
            text-align: center;
        }
        h1 { color: #333; margin-bottom: 20px; font-size: 2.5em; }
        .status { 
            padding: 20px; 
            border-radius: 10px; 
            margin: 20px 0;
            background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%);
            color: #2d3436;
            border: 2px solid #fdcb6e;
        }
        .steps {
            text-align: left;
            margin: 20px 0;
        }
        .step {
            margin: 15px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #667eea;
        }
        code {
            background: #2d3436;
            color: #00b894;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
        }
        .warning {
            background: linear-gradient(135deg, #ff7675 0%, #fd79a8 100%);
            color: white;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 RSS Telegram 推送平台</h1>
        
        <div class="status">
            <h2>⚙️ 系统正在设置中</h2>
            <p>Worker 已成功部署，但需要完成 KV 存储配置才能正常使用。</p>
        </div>

        <div class="warning">
            <strong>⚠️ 重要提示</strong><br>
            当前版本是最小化部署版本，功能受限。请按照以下步骤完成完整配置。
        </div>

        <div class="steps">
            <h3>📋 完成配置步骤：</h3>
            
            <div class="step">
                <strong>步骤 1：创建 KV 命名空间</strong><br>
                在项目目录中运行：<br>
                <code>npx wrangler kv:namespace create "RSS_CONFIG"</code><br>
                <code>npx wrangler kv:namespace create "RSS_CONFIG" --preview</code>
            </div>

            <div class="step">
                <strong>步骤 2：更新配置文件</strong><br>
                将返回的 KV 命名空间 ID 更新到 <code>wrangler.toml</code> 文件中，并取消注释 KV 配置部分。
            </div>

            <div class="step">
                <strong>步骤 3：更新主文件</strong><br>
                将 <code>wrangler.toml</code> 中的 <code>main</code> 字段改为：<br>
                <code>main = "src/worker-optimized-final.js"</code>
            </div>

            <div class="step">
                <strong>步骤 4：重新部署</strong><br>
                运行：<code>npx wrangler deploy</code>
            </div>
        </div>

        <div class="status">
            <p><strong>📖 详细说明</strong></p>
            <p>请查看项目中的 <code>QUICK-FIX.md</code> 和 <code>DEPLOYMENT.md</code> 文件获取完整的配置指南。</p>
        </div>

        <div style="margin-top: 30px; color: #666; font-size: 0.9em;">
            <p>RSS to Telegram v2.1.0 - 最小化部署版本</p>
            <p>部署时间：${new Date().toLocaleString('zh-CN')}</p>
        </div>
    </div>
</body>
</html>
`;

/**
 * 主要的事件处理器 - 最小化版本
 */
export default {
    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);
            
            // 安全头
            const securityHeaders = {
                'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-XSS-Protection': '1; mode=block',
                'Referrer-Policy': 'strict-origin-when-cross-origin'
            };
            
            // 根路径返回设置页面
            if (url.pathname === '/') {
                return new Response(MINIMAL_WEB_INTERFACE, {
                    headers: { 
                        'Content-Type': 'text/html; charset=utf-8',
                        ...securityHeaders
                    }
                });
            }
            
            // API 路由返回设置提示
            if (url.pathname.startsWith('/api/')) {
                return new Response(JSON.stringify({
                    error: '系统正在设置中',
                    message: '请完成 KV 存储配置后重新部署',
                    status: 'setup_required',
                    timestamp: new Date().toISOString()
                }), {
                    status: 503,
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        ...securityHeaders
                    }
                });
            }
            
            // 其他路径返回 404
            return new Response(JSON.stringify({
                error: '页面不存在',
                message: '请访问根路径进行配置',
                timestamp: new Date().toISOString()
            }), {
                status: 404,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    ...securityHeaders
                }
            });
            
        } catch (error) {
            console.error('请求处理失败:', error);
            return new Response(JSON.stringify({
                error: '服务器内部错误',
                message: '系统正在设置中，请稍后重试',
                timestamp: new Date().toISOString()
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8'
                }
            });
        }
    },

    /**
     * 定时任务处理器 - 最小化版本
     */
    async scheduled(event, env, ctx) {
        console.log('定时任务触发，但系统尚未完成配置');
        // 在配置完成前不执行任何操作
        return;
    }
};