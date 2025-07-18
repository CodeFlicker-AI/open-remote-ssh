#!/bin/bash

echo "=== 详细的 CLOUDDEV_CONTAINER 检查测试 ==="

# 模拟 enableCustomGlibc 为 true 的情况
enableCustomGlibc=true
echo "enableCustomGlibc: $enableCustomGlibc"

# 测试环境变量
echo "1. 检查环境变量 CLOUDDEV_CONTAINER:"
echo "CLOUDDEV_CONTAINER = '$CLOUDDEV_CONTAINER'"

# 测试文件存在性
echo "2. 检查 /home/clouddev/.preference.env.zsh 文件:"
if [ -f "/home/clouddev/.preference.env.zsh" ]; then
    echo "文件存在"
    echo "3. 检查文件中是否包含 CLOUDDEV_CONTAINER:"
    if grep -q "CLOUDDEV_CONTAINER" "/home/clouddev/.preference.env.zsh"; then
        echo "文件中包含 CLOUDDEV_CONTAINER 配置"
        echo "文件内容:"
        grep "CLOUDDEV_CONTAINER" "/home/clouddev/.preference.env.zsh"
    else
        echo "文件中不包含 CLOUDDEV_CONTAINER 配置"
    fi
else
    echo "文件不存在"
fi

# 测试完整的检查逻辑（模拟安装脚本中的逻辑）
echo "4. 完整的检查逻辑测试（模拟安装脚本）:"
if [ -n "$CLOUDDEV_CONTAINER" ]; then
    echo "检测到 CLOUDDEV_CONTAINER 环境变量，跳过自定义 glibc 注入"
    echo "CLOUDDEV_CONTAINER 值: $CLOUDDEV_CONTAINER"
elif [ -f "/home/clouddev/.preference.env.zsh" ] && grep -q "CLOUDDEV_CONTAINER" "/home/clouddev/.preference.env.zsh"; then
    echo "检测到 /home/clouddev/.preference.env.zsh 文件中包含 CLOUDDEV_CONTAINER 配置，跳过自定义 glibc 注入"
else
    echo "未检测到 CLOUDDEV_CONTAINER 配置，将执行 glibc 安装"
    echo "GLIBC_URL: https://example.com/glibc.tar.gz"
    echo "GCC_URL: https://example.com/gcc.tar.gz"
    echo "PATCHELF_URL: https://example.com/patchelf"
fi

# 测试客户端检查逻辑
echo "5. 客户端检查逻辑测试:"
echo "模拟客户端检查远程服务器的 CLOUDDEV_CONTAINER 配置..."

# 模拟检查环境变量
if [ -n "$CLOUDDEV_CONTAINER" ]; then
    echo "✓ 检测到远程服务器 CLOUDDEV_CONTAINER 环境变量: $CLOUDDEV_CONTAINER"
    echo "✓ 客户端将设置 enableCustomGlibc = false"
else
    echo "✗ 未检测到 CLOUDDEV_CONTAINER 环境变量"
    
    # 模拟检查文件
    if [ -f "/home/clouddev/.preference.env.zsh" ]; then
        echo "✓ 检测到 /home/clouddev/.preference.env.zsh 文件存在"
        if grep -q "CLOUDDEV_CONTAINER" "/home/clouddev/.preference.env.zsh"; then
            echo "✓ 检测到文件中包含 CLOUDDEV_CONTAINER 配置"
            echo "✓ 客户端将设置 enableCustomGlibc = false"
        else
            echo "✗ 文件中不包含 CLOUDDEV_CONTAINER 配置"
            echo "✗ 客户端将保持 enableCustomGlibc = true"
        fi
    else
        echo "✗ 未检测到 /home/clouddev/.preference.env.zsh 文件"
        echo "✗ 客户端将保持 enableCustomGlibc = true"
    fi
fi 