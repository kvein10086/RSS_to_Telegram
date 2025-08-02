#!/usr/bin/env node

/**
 * RSS to Telegram - 一键部署脚本
 * 自动化 Cloudflare Workers 部署过程
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
    log(`\n🚀 步骤 ${step}: ${message}`, 'cyan');
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

// 创建输入接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

// 执行命令并返回结果
function runCommand(command, description) {
    try {
        log(`执行: ${command}`, 'blue');
        const result = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
        return { success: true, output: result };
    } catch (error) {
        return { success: false, error: error.message, output: error.stdout || error.stderr };
    }
}

// 检查必要的工具
function checkPrerequisites() {
    logStep(1, '检查环境依赖');
    
    // 检查 Node.js
    const nodeCheck = runCommand('node --version', '检查 Node.js');
    if (!nodeCheck.success) {
        logError('Node.js 未安装。请访问 https://nodejs.org/ 下载安装。');
        process.exit(1);
    }
    logSuccess(`Node.js 已安装: ${nodeCheck.output.trim()}`);
    
    // 检查 npm
    const npmCheck = runCommand('npm --version', '检查 npm');
    if (!npmCheck.success) {
        logError('npm 未安装。请重新安装 Node.js。');
        process.exit(1);
    }
    logSuccess(`npm 已安装: ${npmCheck.output.trim()}`);
    
    // 检查或安装 Wrangler
    const wranglerCheck = runCommand('wrangler --version', '检查 Wrangler');
    if (!wranglerCheck.success) {
        log('Wrangler 未安装，正在安装...', 'yellow');
        const installResult = runCommand('npm install -g wrangler', '安装 Wrangler');
        if (!installResult.success) {
            logError('Wrangler 安装失败。请手动安装: npm install -g wrangler');
            process.exit(1);
        }
        logSuccess('Wrangler 安装成功');
    } else {
        logSuccess(`Wrangler 已安装: ${wranglerCheck.output.trim()}`);
    }
}

// 登录 Cloudflare
async function loginCloudflare() {
    logStep(2, '登录 Cloudflare');
    
    // 检查是否已登录
    const whoamiResult = runCommand('wrangler whoami', '检查登录状态');
    if (whoamiResult.success && whoamiResult.output.includes('You are logged in')) {
        logSuccess('已登录 Cloudflare');
        return;
    }
    
    log('需要登录 Cloudflare...', 'yellow');
    const loginResult = runCommand('wrangler auth login', '登录 Cloudflare');
    
    if (!loginResult.success) {
        logError('Cloudflare 登录失败');
        process.exit(1);
    }
    
    // 再次检查登录状态
    const verifyResult = runCommand('wrangler whoami', '验证登录状态');
    if (!verifyResult.success || !verifyResult.output.includes('You are logged in')) {
        logError('登录验证失败，请重试');
        process.exit(1);
    }
    
    logSuccess('Cloudflare 登录成功');
}

// 创建 KV 命名空间
async function createKVNamespaces() {
    logStep(3, '创建 KV 命名空间');
    
    // 创建生产环境 KV
    const prodResult = runCommand('wrangler kv:namespace create "RSS_CONFIG"', '创建生产环境 KV');
    if (!prodResult.success) {
        logError('创建生产环境 KV 命名空间失败');
        process.exit(1);
    }
    
    // 提取 KV ID
    const prodMatch = prodResult.output.match(/id = "([^"]+)"/);
    if (!prodMatch) {
        logError('无法提取生产环境 KV ID');
        process.exit(1);
    }
    const prodId = prodMatch[1];
    logSuccess(`生产环境 KV 创建成功: ${prodId}`);
    
    // 创建预览环境 KV
    const previewResult = runCommand('wrangler kv:namespace create "RSS_CONFIG" --preview', '创建预览环境 KV');
    if (!previewResult.success) {
        logError('创建预览环境 KV 命名空间失败');
        process.exit(1);
    }
    
    // 提取预览 KV ID
    const previewMatch = previewResult.output.match(/preview_id = "([^"]+)"/);
    if (!previewMatch) {
        logError('无法提取预览环境 KV ID');
        process.exit(1);
    }
    const previewId = previewMatch[1];
    logSuccess(`预览环境 KV 创建成功: ${previewId}`);
    
    return { prodId, previewId };
}

// 更新 wrangler.toml 配置
async function updateWranglerConfig(kvIds) {
    logStep(4, '更新配置文件');
    
    const configPath = path.join(__dirname, 'wrangler.toml');
    
    if (!fs.existsSync(configPath)) {
        logError('wrangler.toml 文件不存在');
        process.exit(1);
    }
    
    let config = fs.readFileSync(configPath, 'utf8');
    
    // 替换 KV ID
    config = config.replace(/id = "your-kv-namespace-id"/, `id = "${kvIds.prodId}"`);
    config = config.replace(/preview_id = "your-preview-kv-namespace-id"/, `preview_id = "${kvIds.previewId}"`);
    
    // 询问是否自定义 Worker 名称
    const customName = await askQuestion('是否要自定义 Worker 名称？(留空使用默认名称): ');
    if (customName) {
        config = config.replace(/name = "rss-telegram-pusher"/, `name = "${customName}"`);
        logSuccess(`Worker 名称设置为: ${customName}`);
    }
    
    fs.writeFileSync(configPath, config);
    logSuccess('配置文件更新成功');
}

// 部署 Worker
async function deployWorker() {
    logStep(5, '部署到 Cloudflare Workers');
    
    const deployResult = runCommand('wrangler deploy', '部署 Worker');
    if (!deployResult.success) {
        logError('Worker 部署失败');
        logError(deployResult.error);
        process.exit(1);
    }
    
    // 提取 Worker URL
    const urlMatch = deployResult.output.match(/https:\/\/[^\s]+\.workers\.dev/);
    if (urlMatch) {
        const workerUrl = urlMatch[0];
        logSuccess('部署成功！');
        log(`\n🎉 您的 RSS to Telegram 已部署完成！`, 'green');
        log(`📱 管理界面地址: ${workerUrl}`, 'cyan');
        log(`\n📋 下一步操作:`, 'yellow');
        log(`1. 访问管理界面: ${workerUrl}`);
        log(`2. 配置 Telegram Bot Token 和 Chat ID`);
        log(`3. 添加 RSS 源`);
        log(`4. 测试推送功能`);
        
        return workerUrl;
    } else {
        logWarning('部署成功，但无法提取 Worker URL');
        log('请在 Cloudflare Dashboard 中查看您的 Worker');
    }
}

// 主函数
async function main() {
    try {
        log('🚀 RSS to Telegram - 一键部署脚本', 'bright');
        log('='.repeat(50), 'blue');
        
        // 检查环境
        checkPrerequisites();
        
        // 登录 Cloudflare
        await loginCloudflare();
        
        // 创建 KV 命名空间
        const kvIds = await createKVNamespaces();
        
        // 更新配置
        await updateWranglerConfig(kvIds);
        
        // 部署
        await deployWorker();
        
        log('\n✨ 部署完成！感谢使用 RSS to Telegram！', 'green');
        
    } catch (error) {
        logError(`部署过程中发生错误: ${error.message}`);
        process.exit(1);
    } finally {
        rl.close();
    }
}

// 运行主函数
if (require.main === module) {
    main();
}

module.exports = { main };