#!/bin/bash

echo "=== CLOUDDEV_CONTAINER 检查测试 ==="

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

# 测试完整的检查逻辑
echo "4. 完整的检查逻辑测试:"
if [ -n "$CLOUDDEV_CONTAINER" ]; then
    echo "检测到 CLOUDDEV_CONTAINER 环境变量，跳过自定义 glibc 注入"
    echo "CLOUDDEV_CONTAINER 值: $CLOUDDEV_CONTAINER"
elif [ -f "/home/clouddev/.preference.env.zsh" ] && grep -q "CLOUDDEV_CONTAINER" "/home/clouddev/.preference.env.zsh"; then
    echo "检测到 /home/clouddev/.preference.env.zsh 文件中包含 CLOUDDEV_CONTAINER 配置，跳过自定义 glibc 注入"
else
    echo "未检测到 CLOUDDEV_CONTAINER 配置，将执行 glibc 安装"
fi 