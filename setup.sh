#!/bin/bash

# RSS to Telegram - 快速设置脚本
# 适用于 Linux/macOS 系统

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_step() {
    echo -e "\n${BLUE}🚀 步骤 $1: $2${NC}"
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 主函数
main() {
    echo -e "${CYAN}"
    echo "🚀 RSS to Telegram - 快速设置脚本"
    echo "================================================"
    echo -e "${NC}"

    # 步骤 1: 检查环境
    log_step 1 "检查环境依赖"
    
    if ! command_exists node; then
        log_error "Node.js 未安装。请访问 https://nodejs.org/ 下载安装。"
        exit 1
    fi
    log_success "Node.js 已安装: $(node --version)"
    
    if ! command_exists npm; then
        log_error "npm 未安装。请重新安装 Node.js。"
        exit 1
    fi
    log_success "npm 已安装: $(npm --version)"
    
    # 步骤 2: 安装 Wrangler
    log_step 2 "检查/安装 Wrangler CLI"
    
    if ! command_exists wrangler; then
        log_warning "Wrangler 未安装，正在安装..."
        npm install -g wrangler
        log_success "Wrangler 安装完成"
    else
        log_success "Wrangler 已安装: $(wrangler --version)"
    fi
    
    # 步骤 3: 登录 Cloudflare
    log_step 3 "登录 Cloudflare"
    
    if ! wrangler whoami >/dev/null 2>&1; then
        log_info "需要登录 Cloudflare..."
        wrangler auth login
    else
        log_success "已登录 Cloudflare"
    fi
    
    # 步骤 4: 创建 KV 命名空间
    log_step 4 "创建 KV 命名空间"
    
    log_info "创建生产环境 KV 命名空间..."
    PROD_OUTPUT=$(wrangler kv:namespace create "RSS_CONFIG")
    PROD_ID=$(echo "$PROD_OUTPUT" | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
    
    if [ -z "$PROD_ID" ]; then
        log_error "无法创建生产环境 KV 命名空间"
        exit 1
    fi
    log_success "生产环境 KV 创建成功: $PROD_ID"
    
    log_info "创建预览环境 KV 命名空间..."
    PREVIEW_OUTPUT=$(wrangler kv:namespace create "RSS_CONFIG" --preview)
    PREVIEW_ID=$(echo "$PREVIEW_OUTPUT" | grep -o 'preview_id = "[^"]*"' | cut -d'"' -f2)
    
    if [ -z "$PREVIEW_ID" ]; then
        log_error "无法创建预览环境 KV 命名空间"
        exit 1
    fi
    log_success "预览环境 KV 创建成功: $PREVIEW_ID"
    
    # 步骤 5: 更新配置文件
    log_step 5 "更新配置文件"
    
    if [ ! -f "wrangler.toml" ]; then
        log_error "wrangler.toml 文件不存在"
        exit 1
    fi
    
    # 备份原文件
    cp wrangler.toml wrangler.toml.backup
    
    # 替换 KV ID
    sed -i.tmp "s/id = \"your-kv-namespace-id\"/id = \"$PROD_ID\"/" wrangler.toml
    sed -i.tmp "s/preview_id = \"your-preview-kv-namespace-id\"/preview_id = \"$PREVIEW_ID\"/" wrangler.toml
    rm wrangler.toml.tmp
    
    log_success "配置文件更新完成"
    
    # 步骤 6: 部署
    log_step 6 "部署到 Cloudflare Workers"
    
    DEPLOY_OUTPUT=$(wrangler deploy)
    WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -o 'https://[^[:space:]]*\.workers\.dev')
    
    if [ -z "$WORKER_URL" ]; then
        log_warning "部署成功，但无法提取 Worker URL"
        log_info "请在 Cloudflare Dashboard 中查看您的 Worker"
    else
        log_success "部署成功！"
        echo -e "\n${GREEN}🎉 您的 RSS to Telegram 已部署完成！${NC}"
        echo -e "${CYAN}📱 管理界面地址: $WORKER_URL${NC}"
        echo -e "\n${YELLOW}📋 下一步操作:${NC}"
        echo "1. 访问管理界面: $WORKER_URL"
        echo "2. 配置 Telegram Bot Token 和 Chat ID"
        echo "3. 添加 RSS 源"
        echo "4. 测试推送功能"
    fi
    
    echo -e "\n${GREEN}✨ 设置完成！感谢使用 RSS to Telegram！${NC}"
}

# 运行主函数
main "$@"