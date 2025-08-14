#!/bin/bash

# ========================================
# libstdc++.so.6 版本兼容性修复脚本
# 解决 CXXABI_1.3.8 版本缺失问题
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

# 检查系统版本
check_system_version() {
    if [ -f /etc/centos-release ]; then
        local version=$(cat /etc/centos-release)
        log_info "检测到系统: $version"
    elif [ -f /etc/redhat-release ]; then
        local version=$(cat /etc/redhat-release)
        log_info "检测到系统: $version"
    elif [ -f /etc/os-release ]; then
        local version=$(grep PRETTY_NAME /etc/os-release | cut -d'"' -f2)
        log_info "检测到系统: $version"
    else
        log_warn "无法确定系统版本"
    fi
}

# 检查当前 libstdc++.so.6 版本
check_libstdcxx_version() {
    log_info "检查系统 libstdc++.so.6 版本兼容性..."
    
    if [ ! -f "/lib64/libstdc++.so.6" ]; then
        log_error "未找到系统 libstdc++.so.6 文件"
        return 1
    fi
    
    # 获取支持的 CXXABI 版本
    local cxxabi_versions=$(strings /lib64/libstdc++.so.6 | grep CXXABI | sort -V)
    local highest_version=$(echo "$cxxabi_versions" | tail -1)
    
    log_info "当前系统支持的 CXXABI 版本:"
    echo "$cxxabi_versions" | sed 's/^/  /'
    
    # 检查是否支持 CXXABI_1.3.8
    if echo "$cxxabi_versions" | grep -q "CXXABI_1.3.8"; then
        log_success "系统 libstdc++.so.6 已支持 CXXABI_1.3.8，无需修复"
        return 0
    else
        log_warn "系统 libstdc++.so.6 不支持 CXXABI_1.3.8"
        log_warn "最高支持版本: $highest_version"
        return 1
    fi
}

# 下载兼容的 libstdc++.so.6
download_compatible_libstdcxx() {
    local deps_dir="$HOME/.vscode-server-deps"
    local libstdcxx_url="https://cdnfile.corp.kuaishou.com/kc/files/a/kwaipilot/glibc-2.39/libstdc.so.6"
    
    log_info "创建依赖目录: $deps_dir"
    mkdir -p "$deps_dir"
    cd "$deps_dir"
    
    # 检查是否已有兼容版本
    if [ -f "libstdc++.so.6" ]; then
        log_info "发现已存在的兼容 libstdc++.so.6，跳过下载"
        return 0
    fi
    
    log_info "下载兼容的 libstdc++.so.6..."
    if command -v wget >/dev/null 2>&1; then
        wget --tries=3 --timeout=30 --continue --no-verbose -O libstdc++.so.6 "$libstdcxx_url"
    elif command -v curl >/dev/null 2>&1; then
        curl --retry 3 --connect-timeout 30 --location --show-error --silent --output libstdc++.so.6 "$libstdcxx_url"
    else
        log_error "未找到 wget 或 curl 命令，无法下载文件"
        return 1
    fi
    
    if [ ! -f "libstdc++.so.6" ]; then
        log_error "下载失败，文件不存在"
        return 1
    fi
    
    # 验证文件
    if ! file "libstdc++.so.6" | grep -q "ELF.*shared object"; then
        log_error "下载的文件不是有效的 ELF 共享库"
        rm -f "libstdc++.so.6"
        return 1
    fi
    
    log_success "成功下载兼容的 libstdc++.so.6"
    
    # 检查下载的库是否支持 CXXABI_1.3.8
    if strings "libstdc++.so.6" | grep -q "CXXABI_1.3.8"; then
        log_success "下载的库支持 CXXABI_1.3.8"
    else
        log_warn "下载的库可能不支持 CXXABI_1.3.8，但会尝试使用"
    fi
}

# 设置环境变量
setup_environment() {
    local deps_dir="$HOME/.vscode-server-deps"
    
    log_info "设置环境变量..."
    
    # 创建环境变量配置文件
    local env_file="$HOME/.vscode-server-env"
    cat > "$env_file" << EOF
# VSCode Server 自定义库路径配置
# 自动生成于: $(date)

# 设置 LD_LIBRARY_PATH 以优先使用兼容的库
export LD_LIBRARY_PATH="$deps_dir:\$LD_LIBRARY_PATH"

# 设置其他相关环境变量
export VSCODE_SERVER_CUSTOM_LIBSTDCXX_PATH="$deps_dir/libstdc++.so.6"

# 显示当前配置
echo "VSCode Server 环境变量已设置:"
echo "  LD_LIBRARY_PATH: \$LD_LIBRARY_PATH"
echo "  VSCODE_SERVER_CUSTOM_LIBSTDCXX_PATH: \$VSCODE_SERVER_CUSTOM_LIBSTDCXX_PATH"
EOF
    
    chmod 600 "$env_file"
    log_success "环境变量配置文件已创建: $env_file"
    
    # 添加到 shell 配置文件
    local shell_rc=""
    if [ -f "$HOME/.bashrc" ]; then
        shell_rc="$HOME/.bashrc"
    elif [ -f "$HOME/.zshrc" ]; then
        shell_rc="$HOME/.zshrc"
    elif [ -f "$HOME/.profile" ]; then
        shell_rc="$HOME/.profile"
    fi
    
    if [ -n "$shell_rc" ]; then
        if ! grep -q "source.*vscode-server-env" "$shell_rc"; then
            echo "" >> "$shell_rc"
            echo "# VSCode Server 自定义库路径配置" >> "$shell_rc"
            echo "if [ -f \"$env_file\" ]; then" >> "$shell_rc"
            echo "    source \"$env_file\"" >> "$shell_rc"
            echo "fi" >> "$shell_rc"
            log_success "已添加到 $shell_rc"
        else
            log_info "环境变量配置已存在于 $shell_rc"
        fi
    fi
}

# 测试库加载
test_library_loading() {
    local deps_dir="$HOME/.vscode-server-deps"
    
    log_info "测试兼容库加载..."
    
    if [ ! -f "$deps_dir/libstdc++.so.6" ]; then
        log_error "兼容的 libstdc++.so.6 不存在"
        return 1
    fi
    
    # 创建测试脚本
    local test_script="$deps_dir/test_libstdcxx.sh"
    cat > "$test_script" << 'EOF'
#!/bin/bash
export LD_LIBRARY_PATH="$HOME/.vscode-server-deps:$LD_LIBRARY_PATH"
echo "测试环境变量:"
echo "  LD_LIBRARY_PATH: $LD_LIBRARY_PATH"
echo "  当前使用的 libstdc++.so.6: $(ldd /bin/ls | grep libstdc++ | awk '{print $3}')"
echo "  兼容库支持的 CXXABI 版本:"
strings "$HOME/.vscode-server-deps/libstdc++.so.6" | grep CXXABI | sort -V
EOF
    
    chmod +x "$test_script"
    
    log_info "运行测试脚本..."
    bash "$test_script"
    
    log_success "库加载测试完成"
}

# 创建启动脚本
create_startup_script() {
    local deps_dir="$HOME/.vscode-server-deps"
    local startup_script="$deps_dir/start-vscode-server.sh"
    
    log_info "创建 VSCode Server 启动脚本..."
    
    cat > "$startup_script" << EOF
#!/bin/bash
# VSCode Server 启动脚本（自动设置兼容库路径）

# 设置兼容库路径
export LD_LIBRARY_PATH="$deps_dir:\$LD_LIBRARY_PATH"
export VSCODE_SERVER_CUSTOM_LIBSTDCXX_PATH="$deps_dir/libstdc++.so.6"

echo "VSCode Server 启动环境已配置:"
echo "  LD_LIBRARY_PATH: \$LD_LIBRARY_PATH"
echo "  兼容库路径: \$VSCODE_SERVER_CUSTOM_LIBSTDCXX_PATH"

# 启动 VSCode Server（如果有的话）
if [ -f "\$HOME/.vscode-server/bin/*/bin/code-server" ]; then
    echo "启动 VSCode Server..."
    exec "\$HOME/.vscode-server/bin/*/bin/code-server" "\$@"
else
    echo "未找到 VSCode Server，请先安装"
    echo "您可以使用以下命令启动其他需要兼容库的程序:"
    echo "  source $startup_script"
    echo "  your_command"
fi
EOF
    
    chmod +x "$startup_script"
    log_success "启动脚本已创建: $startup_script"
}

# 显示使用说明
show_usage_instructions() {
    log_info "修复完成！以下是使用方法："
    echo ""
    echo "1. 自动加载环境变量（推荐）:"
    echo "   source ~/.vscode-server-env"
    echo ""
    echo "2. 使用启动脚本:"
    echo "   $HOME/.vscode-server-deps/start-vscode-server.sh"
    echo ""
    echo "3. 手动设置环境变量:"
    echo "   export LD_LIBRARY_PATH=\"$HOME/.vscode-server-deps:\$LD_LIBRARY_PATH\""
    echo ""
    echo "4. 验证配置:"
    echo "   ldd /bin/ls | grep libstdc++"
    echo "   strings $HOME/.vscode-server-deps/libstdc++.so.6 | grep CXXABI"
    echo ""
    echo "注意：重启终端后，环境变量会自动加载"
}

# 主函数
main() {
    echo "========================================"
    echo "libstdc++.so.6 版本兼容性修复脚本"
    echo "========================================"
    echo ""
    
    # 检查前置条件
    check_root
    check_architecture
    check_system_version
    
    # 检查当前版本
    if check_libstdcxx_version; then
        log_success "系统已支持 CXXABI_1.3.8，无需修复"
        exit 0
    fi
    
    # 下载兼容库
    if ! download_compatible_libstdcxx; then
        log_error "下载兼容库失败"
        exit 1
    fi
    
    # 设置环境变量
    setup_environment
    
    # 测试库加载
    test_library_loading
    
    # 创建启动脚本
    create_startup_script
    
    # 显示使用说明
    show_usage_instructions
    
    log_success "修复完成！"
}

# 运行主函数
main "$@"
