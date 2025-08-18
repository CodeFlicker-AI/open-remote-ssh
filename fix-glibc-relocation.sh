#!/bin/bash

# ========================================
# glibc relocation 错误修复脚本
# 解决 __tunable_get_val 符号版本冲突问题
# ========================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# 检查是否为 root 用户
check_root() {
    if [ "$EUID" -eq 0 ]; then
        log_error "请不要以 root 用户运行此脚本"
        exit 1
    fi
}

# 检查系统架构
check_architecture() {
    local arch=$(uname -m)
    if [ "$arch" != "x86_64" ]; then
        log_error "此脚本仅支持 x86_64 架构，当前架构: $arch"
        exit 1
    fi
    log_info "检测到系统架构: $arch"
}

# 检查 VSCode Server 依赖目录
check_vscode_deps() {
    local deps_dir="$HOME/.vscode-server-deps"
    
    if [ ! -d "$deps_dir" ]; then
        log_error "VSCode Server 依赖目录不存在: $deps_dir"
        log_info "请先运行 VSCode Server 安装或启用 enableCustomGlibc 功能"
        exit 1
    fi
    
    if [ ! -d "$deps_dir/glibc-2.39" ]; then
        log_error "glibc-2.39 目录不存在: $deps_dir/glibc-2.39"
        log_info "请先安装 glibc-2.39"
        exit 1
    fi
    
    log_info "发现 VSCode Server 依赖目录: $deps_dir"
}

# 检查动态链接器版本
check_ld_version() {
    local deps_dir="$HOME/.vscode-server-deps"
    local custom_ld="$deps_dir/glibc-2.39/lib/ld-linux-x86-64.so.2"
    local system_ld="/lib64/ld-linux-x86-64.so.2"
    
    log_info "检查动态链接器版本..."
    
    if [ -f "$custom_ld" ]; then
        log_info "自定义动态链接器: $custom_ld"
        if "$custom_ld" --version >/dev/null 2>&1; then
            log_success "自定义动态链接器可用"
        else
            log_warn "自定义动态链接器可能有问题"
        fi
    else
        log_error "自定义动态链接器不存在: $custom_ld"
        return 1
    fi
    
    if [ -f "$system_ld" ]; then
        log_info "系统动态链接器: $system_ld"
        if "$system_ld" --version >/dev/null 2>&1; then
            log_info "系统动态链接器可用"
        else
            log_warn "系统动态链接器可能有问题"
        fi
    fi
}

# 修复环境变量设置
fix_environment_variables() {
    local deps_dir="$HOME/.vscode-server-deps"
    
    log_info "修复环境变量设置..."
    
    # 创建修复后的环境变量文件
    local env_file="$HOME/.vscode-server-env-fixed"
    cat > "$env_file" << EOF
# VSCode Server 修复后的环境变量配置
# 自动生成于: $(date)
# 解决 __tunable_get_val 符号版本冲突问题

# 设置自定义 glibc 路径
export VSCODE_SERVER_CUSTOM_GLIBC_LINKER="$deps_dir/glibc-2.39/lib/ld-linux-x86-64.so.2"
export VSCODE_SERVER_CUSTOM_GLIBC_PATH="$deps_dir/glibc-2.39/lib:$deps_dir/gcc-14.2.0/lib64:/lib64"
export VSCODE_SERVER_PATCHELF_PATH="$deps_dir/bin/patchelf"

# 重要：优先使用自定义的 glibc 库，避免符号版本冲突
export LD_LIBRARY_PATH="$deps_dir/glibc-2.39/lib:$deps_dir/gcc-14.2.0/lib64:$deps_dir:$LD_LIBRARY_PATH"

# 设置 LD_PRELOAD 强制使用自定义的动态链接器（可选）
# export LD_PRELOAD="$deps_dir/glibc-2.39/lib/libc.so.6"

echo "已加载修复后的环境变量配置"
echo "LD_LIBRARY_PATH: \$LD_LIBRARY_PATH"
echo "VSCODE_SERVER_CUSTOM_GLIBC_LINKER: \$VSCODE_SERVER_CUSTOM_GLIBC_LINKER"
EOF
    
    log_success "环境变量修复文件已创建: $env_file"
    
    # 创建启动脚本
    local start_script="$HOME/start-vscode-server-fixed.sh"
    cat > "$start_script" << EOF
#!/bin/bash
# VSCode Server 修复启动脚本

# 加载修复后的环境变量
source "$env_file"

# 启动 VSCode Server
echo "使用修复后的环境启动 VSCode Server..."
echo "环境变量已设置:"
echo "  LD_LIBRARY_PATH: \$LD_LIBRARY_PATH"
echo "  VSCODE_SERVER_CUSTOM_GLIBC_LINKER: \$VSCODE_SERVER_CUSTOM_GLIBC_LINKER"

# 这里可以添加具体的启动命令
# 例如：code-server 或其他 VSCode Server 启动命令
EOF
    
    chmod +x "$start_script"
    log_success "启动脚本已创建: $start_script"
}

# 测试修复效果
test_fix() {
    local deps_dir="$HOME/.vscode-server-deps"
    
    log_info "测试修复效果..."
    
    # 加载修复后的环境变量
    source "$HOME/.vscode-server-env-fixed"
    
    # 测试基本命令
    log_info "测试 sed 命令..."
    if sed --version >/dev/null 2>&1; then
        log_success "sed 命令测试通过"
    else
        log_error "sed 命令测试失败"
        return 1
    fi
    
    log_info "测试 mkdir 命令..."
    if mkdir --version >/dev/null 2>&1; then
        log_success "mkdir 命令测试通过"
    else
        log_error "mkdir 命令测试失败"
        return 1
    fi
    
    log_info "测试 wget 命令..."
    if wget --version >/dev/null 2>&1; then
        log_success "wget 命令测试通过"
    else
        log_error "wget 命令测试失败"
        return 1
    fi
}

# 清理旧的 VSCode Server 进程
cleanup_vscode_server() {
    log_info "清理旧的 VSCode Server 进程..."
    
    # 查找并终止 VSCode Server 进程
    local pids=$(ps -ef | grep vscode-server | grep -v grep | awk '{print $2}' | tr '\n' ' ')
    
    if [ -n "$pids" ]; then
        log_info "发现 VSCode Server 进程: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        log_success "已终止 VSCode Server 进程"
    else
        log_info "未发现运行中的 VSCode Server 进程"
    fi
    
    # 清理服务器缓存
    if [ -d "$HOME/.vscode-server/cli/servers" ]; then
        log_info "清理服务器缓存..."
        rm -rf "$HOME/.vscode-server/cli/servers"
        log_success "服务器缓存已清理"
    fi
}

# 主函数
main() {
    log_info "开始修复 glibc relocation 错误..."
    
    # 检查前置条件
    check_root
    check_architecture
    check_vscode_deps
    check_ld_version
    
    # 执行修复
    fix_environment_variables
    cleanup_vscode_server
    
    # 测试修复效果
    if test_fix; then
        log_success "修复完成！"
        echo ""
        echo "使用方法："
        echo "1. 加载修复后的环境变量："
        echo "   source $HOME/.vscode-server-env-fixed"
        echo ""
        echo "2. 或者使用修复启动脚本："
        echo "   $HOME/start-vscode-server-fixed.sh"
        echo ""
        echo "3. 重新连接 VSCode SSH 主机"
    else
        log_error "修复测试失败，请检查依赖安装"
        exit 1
    fi
}

# 执行主函数
main "$@"
