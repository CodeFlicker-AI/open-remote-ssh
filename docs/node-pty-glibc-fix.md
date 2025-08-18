# node-pty glibc 兼容性自动修复功能

## 概述

本插件已集成自动修复 node-pty 的 glibc 兼容性问题的功能，无需用户手动执行脚本。当启用 `enableCustomGlibc` 功能时，插件会自动检测并修复 node-pty 模块的 glibc 版本冲突问题。

## 问题背景

在 VSCode 1.86 版本更新后，由于 Electron 版本升级到 27，导致 Node.js 和 Chromium 版本也随之更新。新版本的 Node.js 对 glibc 版本要求更高，导致在旧版本 Linux 系统上出现以下错误：

```
Error: /lib64/libc.so.6: version `GLIBC_2.28' not found (required by /home/user/.vscode-server/bin/xxx/node_modules/node-pty/build/Release/pty.node)
```

## 自动修复机制

### 1. 检测阶段

插件会在以下时机自动检测 node-pty 兼容性问题：

- 插件激活时
- 启用 `enableCustomGlibc` 功能时
- VSCode Server 安装时
- 每次 SSH 连接时

### 2. 修复阶段

当检测到需要修复时，插件会自动执行以下步骤：

1. **检查依赖环境**
   - 验证自定义 glibc 是否已安装
   - 检查 patchelf 工具是否可用
   - 确认 VSCode Server 目录权限

2. **查找 node-pty 模块**
   - 在 VSCode Server 目录中查找所有 node-pty 模块
   - 定位需要修复的 `.node` 文件

3. **修复动态链接器**
   - 使用 patchelf 工具修改 `.node` 文件的动态链接器路径
   - 设置正确的 rpath 指向自定义 glibc 库
   - 确保使用兼容的 glibc 版本

4. **环境变量配置**
   - 创建环境变量配置文件
   - 设置 `LD_LIBRARY_PATH` 优先使用自定义库
   - 配置 VSCode Server 启动环境

### 3. 启动阶段

在 VSCode Server 启动时：

- 自动加载修复后的环境变量
- 使用自定义 glibc 环境启动服务
- 确保 node-pty 模块正常工作

## 配置要求

### 基本配置

```json
{
    "remote.SSH.enableCustomGlibc": true
}
```

### 完整配置（可选）

```json
{
    "remote.SSH.enableCustomGlibc": true,
    "remote.SSH.customGlibcUrl": "https://your-domain.com/glibc-2.39.tar.gz",
    "remote.SSH.customGccUrl": "https://your-domain.com/gcc-14.2.0.tgz",
    "remote.SSH.customPatchelfUrl": "https://your-domain.com/patchelf"
}
```

## 工作原理

### 1. 动态链接器修复

插件使用 `patchelf` 工具修改 node-pty 的 `.node` 文件：

```bash
patchelf --set-interpreter /path/to/custom/glibc/lib/ld-linux-x86-64.so.2 \
         --set-rpath /path/to/custom/glibc/lib:/path/to/custom/gcc/lib64 \
         /path/to/node-pty/build/Release/pty.node
```

### 2. 环境变量设置

创建环境变量配置文件 `~/.vscode-server-deps/vscode-server-env.sh`：

```bash
#!/bin/bash
export LD_LIBRARY_PATH="/path/to/custom/glibc/lib:/path/to/custom/gcc/lib64:$LD_LIBRARY_PATH"
export VSCODE_SERVER_CUSTOM_GLIBC_LINKER="/path/to/custom/glibc/lib/ld-linux-x86-64.so.2"
```

### 3. 自动加载

在 VSCode Server 启动时自动加载环境变量：

```bash
if [ -f "$HOME/.vscode-server-deps/vscode-server-env.sh" ]; then
    source "$HOME/.vscode-server-deps/vscode-server-env.sh"
fi
```

## 支持的场景

### 适用场景

- ✅ CentOS 7 及以下版本
- ✅ Ubuntu 16.04 及以下版本
- ✅ 其他使用旧版本 glibc 的 Linux 发行版
- ✅ Docker 容器环境
- ✅ 云服务器环境

### 不适用场景

- ❌ Windows 系统（不使用 glibc）
- ❌ macOS 系统（使用不同的系统库）
- ❌ 云开发容器环境（自动跳过）

## 故障排除

### 1. 修复失败

**症状**：仍然出现 glibc 版本错误

**解决方案**：
1. 检查是否启用了 `enableCustomGlibc`
2. 查看 VSCode 输出日志中的修复信息
3. 确认网络连接正常，可以下载依赖文件
4. 检查用户目录权限

### 2. patchelf 不可用

**症状**：日志显示 "patchelf 不可用"

**解决方案**：
1. 提供 `customPatchelfUrl` 配置
2. 或手动安装 patchelf 工具

### 3. 权限问题

**症状**：文件不可写错误

**解决方案**：
1. 检查 VSCode Server 目录权限
2. 确保用户有写入权限
3. 重新安装 VSCode Server

### 4. 网络问题

**症状**：依赖下载失败

**解决方案**：
1. 检查网络连接
2. 配置内网或 CDN 地址
3. 手动下载依赖文件

## 日志信息

插件会在以下位置记录详细的修复日志：

1. **VSCode 输出面板**：查看 "Remote - SSH" 输出
2. **服务器日志**：`~/.vscode-server/.{commit}.log`
3. **环境配置文件**：`~/.vscode-server-deps/vscode-server-env.sh`

### 常见日志信息

```
[INFO] 开始修复 node-pty 的 glibc 兼容性问题...
[INFO] 检查并修复 node-pty 的 glibc 兼容性...
[INFO] 发现 node-pty 模块: /path/to/node-pty
[INFO] 修复成功: /path/to/pty.node
[INFO] node-pty 修复完成: 修复了 X 个文件
[INFO] 环境变量配置文件已创建
```

## 性能影响

### 修复开销

- **首次修复**：约 5-10 秒（下载依赖 + 修复文件）
- **后续启动**：约 1-2 秒（加载环境变量）
- **内存占用**：增加约 50-100MB（自定义 glibc 库）

### 优化建议

1. **使用内网地址**：配置内网或 CDN 地址加速下载
2. **缓存依赖**：依赖文件会缓存到 `~/.vscode-server-deps`
3. **按需修复**：只在需要时进行修复，避免重复操作

## 技术细节

### 1. 符号版本机制

glibc 使用符号版本机制管理 ABI 兼容性：

- `GLIBC_2.28`：新版本符号
- `GLIBC_PRIVATE`：内部符号
- `__tunable_get_val`：glibc 2.39 中的新符号

### 2. 动态链接过程

1. 程序启动时加载动态链接器
2. 根据 `LD_LIBRARY_PATH` 查找共享库
3. 解析符号引用
4. 处理符号版本冲突

### 3. 修复原理

通过修改 `.node` 文件的动态链接器路径，确保使用兼容的 glibc 版本，避免符号版本冲突。

## 更新日志

### v0.0.62

- ✅ 集成自动修复 node-pty glibc 兼容性功能
- ✅ 支持智能检测和按需修复
- ✅ 自动环境变量配置
- ✅ 详细的日志记录

## 相关资源

- [VSCode Remote SSH 官方文档](https://code.visualstudio.com/docs/remote/ssh)
- [glibc 符号版本机制](https://www.gnu.org/software/libc/manual/html_node/Symbol-Versioning.html)
- [patchelf 工具文档](https://github.com/NixOS/patchelf)
- [node-pty 项目](https://github.com/microsoft/node-pty)
