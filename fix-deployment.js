#!/usr/bin/env node

/**
 * RSS to Telegram 部署修复脚本
 * 自动检测和修复常见的部署问题
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 RSS to Telegram 部署修复脚本');
console.log('=====================================\n');

// 检查文件是否存在
function checkFileExists(filePath) {
    return fs.existsSync(filePath);
}

// 读取文件内容
function readFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        console.error(`❌ 无法读取文件 ${filePath}:`, error.message);
        return null;
    }
}

// 写入文件内容
function writeFile(filePath, content) {
    try {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ 已更新文件: ${filePath}`);
        return true;
    } catch (error) {
        console.error(`❌ 无法写入文件 ${filePath}:`, error.message);
        return false;
    }
}

// 执行命令
function runCommand(command, description) {
    try {
        console.log(`🔄 ${description}...`);
        const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
        console.log(`✅ ${description} 完成`);
        return output;
    } catch (error) {
        console.error(`❌ ${description} 失败:`, error.message);
        return null;
    }
}

// 修复 wrangler.toml 配置
function fixWranglerConfig() {
    console.log('🔍 检查 wrangler.toml 配置...');
    
    const wranglerPath = 'wrangler.toml';
    if (!checkFileExists(wranglerPath)) {
        console.error('❌ 未找到 wrangler.toml 文件');
        return false;
    }
    
    let content = readFile(wranglerPath);
    if (!content) return false;
    
    let modified = false;
    
    // 修复项目名称格式
    if (content.includes('name = "RSS_to_Telegram"')) {
        content = content.replace('name = "RSS_to_Telegram"', 'name = "rss-to-telegram"');
        console.log('✅ 修复项目名称格式');
        modified = true;
    }
    
    // 检查主文件路径
    if (content.includes('main = "src/worker.js"') && checkFileExists('src/worker-optimized-final.js')) {
        content = content.replace('main = "src/worker.js"', 'main = "src/worker-optimized-final.js"');
        console.log('✅ 更新主文件路径');
        modified = true;
    }
    
    // 更新兼容性日期
    const currentDate = new Date().toISOString().split('T')[0];
    if (content.includes('compatibility_date = "2024-01-01"')) {
        content = content.replace('compatibility_date = "2024-01-01"', `compatibility_date = "${currentDate}"`);
        console.log('✅ 更新兼容性日期');
        modified = true;
    }
    
    if (modified) {
        return writeFile(wranglerPath, content);
    } else {
        console.log('✅ wrangler.toml 配置正确');
        return true;
    }
}

// 修复 package.json 配置
function fixPackageJson() {
    console.log('🔍 检查 package.json 配置...');
    
    const packagePath = 'package.json';
    if (!checkFileExists(packagePath)) {
        console.error('❌ 未找到 package.json 文件');
        return false;
    }
    
    try {
        const packageContent = JSON.parse(readFile(packagePath));
        let modified = false;
        
        // 修复项目名称
        if (packageContent.name === 'RSS_to_Telegram') {
            packageContent.name = 'rss-to-telegram';
            console.log('✅ 修复 package.json 项目名称');
            modified = true;
        }
        
        // 更新版本号
        if (packageContent.version === '1.0.0') {
            packageContent.version = '2.1.0';
            console.log('✅ 更新版本号到 2.1.0');
            modified = true;
        }
        
        // 更新主文件路径
        if (packageContent.main === 'src/worker.js' && checkFileExists('src/worker-optimized-final.js')) {
            packageContent.main = 'src/worker-optimized-final.js';
            console.log('✅ 更新 package.json 主文件路径');
            modified = true;
        }
        
        // 更新 Wrangler 版本
        if (packageContent.devDependencies && packageContent.devDependencies.wrangler) {
            const currentVersion = packageContent.devDependencies.wrangler;
            if (currentVersion.includes('^3.') || currentVersion.includes('^2.')) {
                packageContent.devDependencies.wrangler = '^4.27.0';
                console.log('✅ 更新 Wrangler 到最新版本');
                modified = true;
            }
        }
        
        if (modified) {
            return writeFile(packagePath, JSON.stringify(packageContent, null, 2));
        } else {
            console.log('✅ package.json 配置正确');
            return true;
        }
    } catch (error) {
        console.error('❌ 解析 package.json 失败:', error.message);
        return false;
    }
}

// 检查必要文件
function checkRequiredFiles() {
    console.log('🔍 检查必要文件...');
    
    const requiredFiles = [
        'src/worker-optimized-final.js',
        'wrangler.toml',
        'package.json'
    ];
    
    let allFilesExist = true;
    
    for (const file of requiredFiles) {
        if (checkFileExists(file)) {
            console.log(`✅ ${file} 存在`);
        } else {
            console.error(`❌ 缺少必要文件: ${file}`);
            allFilesExist = false;
        }
    }
    
    return allFilesExist;
}

// 检查 KV 命名空间配置
function checkKVNamespace() {
    console.log('🔍 检查 KV 命名空间配置...');
    
    const wranglerContent = readFile('wrangler.toml');
    if (!wranglerContent) return false;
    
    if (wranglerContent.includes('id = "your-kv-namespace-id"')) {
        console.log('⚠️  KV 命名空间 ID 需要配置');
        console.log('请运行以下命令创建 KV 命名空间:');
        console.log('  npx wrangler kv:namespace create "RSS_CONFIG"');
        console.log('  npx wrangler kv:namespace create "RSS_CONFIG" --preview');
        console.log('然后将返回的 ID 更新到 wrangler.toml 文件中');
        return false;
    } else {
        console.log('✅ KV 命名空间配置看起来正确');
        return true;
    }
}

// 主修复流程
async function main() {
    try {
        console.log('开始检查和修复部署问题...\n');
        
        // 1. 检查必要文件
        if (!checkRequiredFiles()) {
            console.error('\n❌ 缺少必要文件，请检查项目完整性');
            process.exit(1);
        }
        
        console.log('');
        
        // 2. 修复 wrangler.toml
        if (!fixWranglerConfig()) {
            console.error('\n❌ 修复 wrangler.toml 失败');
            process.exit(1);
        }
        
        console.log('');
        
        // 3. 修复 package.json
        if (!fixPackageJson()) {
            console.error('\n❌ 修复 package.json 失败');
            process.exit(1);
        }
        
        console.log('');
        
        // 4. 检查 KV 命名空间
        const kvConfigured = checkKVNamespace();
        
        console.log('');
        
        // 5. 尝试更新依赖
        console.log('🔄 更新项目依赖...');
        const installOutput = runCommand('npm install', '安装/更新依赖');
        
        console.log('\n=====================================');
        console.log('🎉 修复完成！');
        
        if (!kvConfigured) {
            console.log('\n⚠️  下一步操作:');
            console.log('1. 创建 KV 命名空间:');
            console.log('   npx wrangler kv:namespace create "RSS_CONFIG"');
            console.log('   npx wrangler kv:namespace create "RSS_CONFIG" --preview');
            console.log('2. 将返回的 ID 更新到 wrangler.toml 文件中');
            console.log('3. 运行部署命令: npx wrangler deploy');
        } else {
            console.log('\n✅ 现在可以尝试部署:');
            console.log('   npx wrangler deploy');
        }
        
        console.log('\n📖 详细部署指南请查看 DEPLOYMENT.md 文件');
        
    } catch (error) {
        console.error('\n❌ 修复过程中出现错误:', error.message);
        process.exit(1);
    }
}

// 运行主程序
if (require.main === module) {
    main();
}

module.exports = {
    fixWranglerConfig,
    fixPackageJson,
    checkRequiredFiles,
    checkKVNamespace
};