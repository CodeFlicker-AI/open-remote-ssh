#!/bin/bash

# 你可以根据实际情况修改下载链接
URL="https://cdnfile.corp.kuaishou.com/kc/files/a/kwaipilot/vscodium/vscodium-reh-linux-x64-1.99.2.tar.gz"
FILENAME="vscode-server.tar.gz"
WORKDIR="vscode-server-test"

# 清理旧文件
rm -rf "$WORKDIR" "$FILENAME"
mkdir "$WORKDIR"

echo "1. 开始用 curl 下载 $URL ..."
curl -L --retry 3 --connect-timeout 10 -o "$FILENAME" "$URL"
if [ $? -ne 0 ]; then
  echo "下载失败！"
  exit 1
fi

echo "2. 检查文件类型："

file "$FILENAME"

echo "3. 检查 gzip 完整性："
gzip -t "$FILENAME"
if [ $? -ne 0 ]; then
  echo "gzip 检查未通过，文件可能损坏！"
  exit 2
else
  echo "gzip 检查通过。"
fi

echo "4. 尝试解压到 $WORKDIR ..."
tar -xzf "$FILENAME" -C "$WORKDIR"
if [ $? -ne 0 ]; then
  echo "tar 解压失败，文件可能损坏或格式不对！"
  exit 3
else
  echo "tar 解压成功。"
fi

echo "5. 检查解压结果："
ls -l "$WORKDIR"

echo "验证完成。"