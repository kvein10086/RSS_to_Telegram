@echo off
setlocal enabledelayedexpansion

:: RSS to Telegram - Windows 快速设置脚本

echo.
echo 🚀 RSS to Telegram - 快速设置脚本
echo ================================================
echo.

:: 步骤 1: 检查环境
echo 🚀 步骤 1: 检查环境依赖
echo.

:: 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js 未安装。请访问 https://nodejs.org/ 下载安装。
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js 已安装: !NODE_VERSION!

:: 检查 npm
npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ npm 未安装。请重新安装 Node.js。
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo ✅ npm 已安装: !NPM_VERSION!

:: 步骤 2: 安装 Wrangler
echo.
echo 🚀 步骤 2: 检查/安装 Wrangler CLI
echo.

wrangler --version >nul 2>&1
if errorlevel 1 (
    echo ⚠️  Wrangler 未安装，正在安装...
    npm install -g wrangler
    if errorlevel 1 (
        echo ❌ Wrangler 安装失败
        pause
        exit /b 1
    )
    echo ✅ Wrangler 安装完成
) else (
    for /f "tokens=*" %%i in ('wrangler --version') do set WRANGLER_VERSION=%%i
    echo ✅ Wrangler 已安装: !WRANGLER_VERSION!
)

:: 步骤 3: 登录 Cloudflare
echo.
echo 🚀 步骤 3: 登录 Cloudflare
echo.

wrangler whoami >nul 2>&1
if errorlevel 1 (
    echo ℹ️  需要登录 Cloudflare...
    wrangler auth login
    if errorlevel 1 (
        echo ❌ Cloudflare 登录失败
        pause
        exit /b 1
    )
) else (
    echo ✅ 已登录 Cloudflare
)

:: 步骤 4: 创建 KV 命名空间
echo.
echo 🚀 步骤 4: 创建 KV 命名空间
echo.

echo ℹ️  创建生产环境 KV 命名空间...
for /f "tokens=*" %%i in ('wrangler kv:namespace create "RSS_CONFIG"') do (
    set PROD_OUTPUT=%%i
    echo !PROD_OUTPUT! | findstr "id =" >nul
    if not errorlevel 1 (
        for /f "tokens=3 delims= " %%j in ("!PROD_OUTPUT!") do (
            set PROD_ID=%%j
            set PROD_ID=!PROD_ID:"=!
        )
    )
)

if "!PROD_ID!"=="" (
    echo ❌ 无法创建生产环境 KV 命名空间
    pause
    exit /b 1
)
echo ✅ 生产环境 KV 创建成功: !PROD_ID!

echo ℹ️  创建预览环境 KV 命名空间...
for /f "tokens=*" %%i in ('wrangler kv:namespace create "RSS_CONFIG" --preview') do (
    set PREVIEW_OUTPUT=%%i
    echo !PREVIEW_OUTPUT! | findstr "preview_id =" >nul
    if not errorlevel 1 (
        for /f "tokens=3 delims= " %%j in ("!PREVIEW_OUTPUT!") do (
            set PREVIEW_ID=%%j
            set PREVIEW_ID=!PREVIEW_ID:"=!
        )
    )
)

if "!PREVIEW_ID!"=="" (
    echo ❌ 无法创建预览环境 KV 命名空间
    pause
    exit /b 1
)
echo ✅ 预览环境 KV 创建成功: !PREVIEW_ID!

:: 步骤 5: 更新配置文件
echo.
echo 🚀 步骤 5: 更新配置文件
echo.

if not exist "wrangler.toml" (
    echo ❌ wrangler.toml 文件不存在
    pause
    exit /b 1
)

:: 备份原文件
copy wrangler.toml wrangler.toml.backup >nul

:: 替换 KV ID
powershell -Command "(Get-Content wrangler.toml) -replace 'id = \"your-kv-namespace-id\"', 'id = \"!PROD_ID!\"' | Set-Content wrangler.toml"
powershell -Command "(Get-Content wrangler.toml) -replace 'preview_id = \"your-preview-kv-namespace-id\"', 'preview_id = \"!PREVIEW_ID!\"' | Set-Content wrangler.toml"

echo ✅ 配置文件更新完成

:: 步骤 6: 部署
echo.
echo 🚀 步骤 6: 部署到 Cloudflare Workers
echo.

for /f "tokens=*" %%i in ('wrangler deploy') do (
    set DEPLOY_LINE=%%i
    echo !DEPLOY_LINE! | findstr "https://" >nul
    if not errorlevel 1 (
        for /f "tokens=*" %%j in ("!DEPLOY_LINE!") do (
            echo %%j | findstr "workers.dev" >nul
            if not errorlevel 1 (
                set WORKER_URL=%%j
            )
        )
    )
)

if "!WORKER_URL!"=="" (
    echo ⚠️  部署成功，但无法提取 Worker URL
    echo ℹ️  请在 Cloudflare Dashboard 中查看您的 Worker
) else (
    echo ✅ 部署成功！
    echo.
    echo 🎉 您的 RSS to Telegram 已部署完成！
    echo 📱 管理界面地址: !WORKER_URL!
    echo.
    echo 📋 下一步操作:
    echo 1. 访问管理界面: !WORKER_URL!
    echo 2. 配置 Telegram Bot Token 和 Chat ID
    echo 3. 添加 RSS 源
    echo 4. 测试推送功能
)

echo.
echo ✨ 设置完成！感谢使用 RSS to Telegram！
echo.
pause