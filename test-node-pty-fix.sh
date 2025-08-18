#!/bin/bash

# ========================================
# node-pty glibc 修复功能测试脚本
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

# 测试环境变量配置
test_environment_config() {
    log_info "测试环境变量配置..."
    
    local env_file="$HOME/.vscode-server-deps/vscode-server-env.sh"
    
    if [ -f "$env_file" ]; then
        log_success "环境变量配置文件存在: $env_file"
        
        # 测试加载环境变量
        source "$env_file"
        
        if [ -n "$LD_LIBRARY_PATH" ]; then
            log_success "LD_LIBRARY_PATH 已设置: $LD_LIBRARY_PATH"
        else
            log_warn "LD_LIBRARY_PATH 未设置"
        fi
        
        if [ -n "$VSCODE_SERVER_CUSTOM_GLIBC_LINKER" ]; then
            log_success "VSCODE_SERVER_CUSTOM_GLIBC_LINKER 已设置: $VSCODE_SERVER_CUSTOM_GLIBC_LINKER"
        else
            log_warn "VSCODE_SERVER_CUSTOM_GLIBC_LINKER 未设置"
        fi
    else
        log_error "环境变量配置文件不存在: $env_file"
        return 1
    fi
}

# 测试 node-pty 模块修复
test_node_pty_fix() {
    log_info "测试 node-pty 模块修复..."
    
    local server_data_dir="$HOME/.vscode-server"
    local deps_dir="$HOME/.vscode-server-deps"
    
    if [ ! -d "$server_data_dir" ]; then
        log_warn "VSCode Server 目录不存在: $server_data_dir"
        return 0
    fi
    
    # 查找 node-pty 模块
    local pty_modules=$(find "$server_data_dir" -name "node-pty" -type d 2>/dev/null | head -3)
    
    if [ -n "$pty_modules" ]; then
        log_info "发现 node-pty 模块:"
        echo "$pty_modules" | while read pty_path; do
            echo "  $pty_path"
            
            # 查找 .node 文件
            local node_files=$(find "$pty_path" -name "*.node" -type f 2>/dev/null)
            
            if [ -n "$node_files" ]; then
                echo "$node_files" | while read node_file; do
                    echo "    检查: $node_file"
                    
                    # 检查动态链接器
                    if command -v patchelf >/dev/null 2>&1; then
                        local interpreter=$(patchelf --print-interpreter "$node_file" 2>/dev/null)
                        local expected_interpreter="$deps_dir/glibc-2.39/lib/ld-linux-x86-64.so.2"
                        
                        if [ "$interpreter" = "$expected_interpreter" ]; then
                            log_success "      动态链接器已修复: $interpreter"
                        else
                            log_warn "      动态链接器未修复: $interpreter (期望: $expected_interpreter)"
                        fi
                    else
                        log_warn "      patchelf 不可用，无法检查动态链接器"
                    fi
                done
            else
                log_warn "    未找到 .node 文件"
            fi
        done
    else
        log_warn "未找到 node-pty 模块"
    fi
}

# 测试 glibc 依赖
test_glibc_deps() {
    log_info "测试 glibc 依赖..."
    
    local deps_dir="$HOME/.vscode-server-deps"
    
    if [ ! -d "$deps_dir" ]; then
        log_error "依赖目录不存在: $deps_dir"
        return 1
    fi
    
    # 检查 glibc
    if [ -f "$deps_dir/glibc-2.39/lib/libc.so.6" ]; then
        log_success "glibc-2.39 已安装"
    else
        log_error "glibc-2.39 未安装"
        return 1
    fi
    
    # 检查动态链接器
    if [ -f "$deps_dir/glibc-2.39/lib/ld-linux-x86-64.so.2" ]; then
        log_success "动态链接器已安装"
    else
        log_error "动态链接器未安装"
        return 1
    fi
    
    # 检查 gcc
    if [ -d "$deps_dir/gcc-14.2.0" ]; then
        log_success "gcc-14.2.0 已安装"
    else
        log_warn "gcc-14.2.0 未安装"
    fi
    
    # 检查 patchelf
    if [ -f "$deps_dir/bin/patchelf" ]; then
        log_success "patchelf 已安装: $deps_dir/bin/patchelf"
    elif command -v patchelf >/dev/null 2>&1; then
        log_success "patchelf 已安装: $(which patchelf)"
    else
        log_warn "patchelf 未安装"
    fi
}

# 测试基本命令
test_basic_commands() {
    log_info "测试基本命令..."
    
    # 加载环境变量
    if [ -f "$HOME/.vscode-server-deps/vscode-server-env.sh" ]; then
        source "$HOME/.vscode-server-deps/vscode-server-env.sh"
    fi
    
    # 测试 sed
    if sed --version >/dev/null 2>&1; then
        log_success "sed 命令正常"
    else
        log_error "sed 命令异常"
        return 1
    fi
    
    # 测试 mkdir
    if mkdir --version >/dev/null 2>&1; then
        log_success "mkdir 命令正常"
    else
        log_error "mkdir 命令异常"
        return 1
    fi
    
    # 测试 wget
    if wget --version >/dev/null 2>&1; then
        log_success "wget 命令正常"
    else
        log_warn "wget 命令异常"
    fi
}

# 显示系统信息
show_system_info() {
    log_info "系统信息:"
    echo "  操作系统: $(uname -s)"
    echo "  架构: $(uname -m)"
    echo "  内核版本: $(uname -r)"
    
    if [ -f /etc/os-release ]; then
        echo "  发行版: $(grep PRETTY_NAME /etc/os-release | cut -d'"' -f2)"
    fi
    
    echo "  系统 glibc 版本: $(ldd --version | head -1)"
    echo "  用户: $(whoami)"
    echo "  主目录: $HOME"
}

# 主函数
main() {
    echo "========================================"
    echo "node-pty glibc 修复功能测试"
    echo "========================================"
    echo ""
    
    # 显示系统信息
    show_system_info
    echo ""
    
    # 测试 glibc 依赖
    if test_glibc_deps; then
        log_success "glibc 依赖检查通过"
    else
        log_error "glibc 依赖检查失败"
        echo ""
        echo "请先启用 enableCustomGlibc 功能并重新连接 SSH 主机"
        exit 1
    fi
    echo ""
    
    # 测试环境变量配置
    if test_environment_config; then
        log_success "环境变量配置检查通过"
    else
        log_error "环境变量配置检查失败"
    fi
    echo ""
    
    # 测试 node-pty 模块修复
    test_node_pty_fix
    echo ""
    
    # 测试基本命令
    if test_basic_commands; then
        log_success "基本命令测试通过"
    else
        log_error "基本命令测试失败"
    fi
    echo ""
    
    log_success "测试完成！"
    echo ""
    echo "如果所有测试都通过，说明 node-pty glibc 修复功能正常工作。"
    echo "如果遇到问题，请查看 VSCode 输出日志获取详细信息。"
}

# 执行主函数
main "$@"
