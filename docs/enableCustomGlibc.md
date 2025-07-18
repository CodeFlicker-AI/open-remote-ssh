# enableCustomGlibc 功能说明

## 概述

`enableCustomGlibc` 是一个新增的控制参数，用于控制是否在远程服务器上自动安装自定义的 glibc 及相关依赖。

## 功能背景

在某些 Linux 发行版中，系统自带的 glibc 版本可能较旧，导致 VS Code Server 无法正常运行。通过启用此功能，可以自动下载并安装较新版本的 glibc，解决兼容性问题。

## 配置方法

### 1. 通过 VS Code 设置配置

在 VS Code 的设置中，找到 `remote.SSH` 配置项，添加以下设置：

```json
{
    "remote.SSH.enableCustomGlibc": true,
    "remote.SSH.customGlibcUrl": "https://your-domain.com/glibc-2.39.tar.gz",
    "remote.SSH.customGccUrl": "https://your-domain.com/gcc-14.2.0.tgz",
    "remote.SSH.customPatchelfUrl": "https://your-domain.com/patchelf"
}
```

### 2. 配置参数说明

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableCustomGlibc` | boolean | false | 是否启用自定义 glibc 安装 |
| `customGlibcUrl` | string | 默认 URL | glibc 下载地址 |
| `customGccUrl` | string | 默认 URL | gcc 下载地址 |
| `customPatchelfUrl` | string | 空字符串 | patchelf 下载地址（可选） |

## 工作原理

### 启用时（enableCustomGlibc = true）

1. **环境变量检查**：首先检查 `CLOUDDEV_CONTAINER` 环境变量，如果存在则跳过 glibc 安装
2. **自动下载依赖**：脚本会自动下载 glibc、gcc 和 patchelf（如果提供了 URL）
3. **本地安装**：所有依赖都安装到 `$HOME/.vscode-server-deps` 目录
4. **环境变量设置**：设置相关的环境变量指向自定义的库路径
5. **权限处理**：使用用户目录避免权限问题

### 禁用时（enableCustomGlibc = false）

- 跳过所有 glibc 相关的安装步骤
- 使用系统默认的库和工具

### CLOUDDEV_CONTAINER 环境变量

当检测到 `CLOUDDEV_CONTAINER` 环境变量存在时，无论 `enableCustomGlibc` 设置如何，都会自动禁用自定义 glibc 注入。这个功能主要用于云开发容器环境，避免不必要的依赖安装。

## 支持的平台

- **Linux**：完全支持，包括 Alpine Linux
- **Windows**：暂不支持（会显示警告信息）
- **macOS**：暂不支持（macOS 不使用 glibc）

## 使用场景

### 适用场景

1. **旧版本 Linux 发行版**：如 CentOS 7、Ubuntu 16.04 等
2. **最小化系统**：如 Docker 容器、云服务器等
3. **glibc 版本过低**：系统 glibc 版本低于 2.17

### 不适用场景

1. **Windows 系统**：Windows 不使用 glibc
2. **macOS 系统**：macOS 使用不同的系统库
3. **系统已是最新版本**：如果系统 glibc 版本已经足够新
4. **云开发容器环境**：设置了 `CLOUDDEV_CONTAINER` 环境变量的容器环境会自动跳过 glibc 安装

## 注意事项

### 1. 网络要求

- 需要能够访问配置的下载 URL
- 建议使用内网或 CDN 地址以提高下载速度

### 2. 磁盘空间

- glibc 和 gcc 的安装会占用额外的磁盘空间
- 建议确保有足够的可用空间（约 500MB）

### 3. 权限问题

- 所有依赖都安装在用户目录下，避免需要 root 权限
- 如果遇到权限问题，请检查用户目录的写入权限

### 4. 兼容性

- 此功能主要针对 Linux 系统
- Windows 和 macOS 系统会忽略此设置

## 故障排除

### 常见问题

1. **下载失败**
   - 检查网络连接
   - 验证下载 URL 是否正确
   - 确认服务器可以访问外部网络

2. **安装失败**
   - 检查磁盘空间是否充足
   - 确认用户目录有写入权限
   - 查看安装日志获取详细错误信息

3. **运行时错误**
   - 检查环境变量是否正确设置
   - 确认库文件路径是否正确
   - 验证 patchelf 是否正常工作

### 调试方法

1. **查看安装日志**：脚本会保存到本地，便于分析问题
2. **检查环境变量**：确认 `VSCODE_SERVER_CUSTOM_GLIBC_*` 变量是否正确设置
3. **手动测试**：可以手动执行安装步骤来定位问题

## 示例配置

### 完整配置示例

```json
{
    "remote.SSH.enableCustomGlibc": true,
    "remote.SSH.customGlibcUrl": "https://halo.corp.kuaishou.com/api/cloud-storage/v1/public-objects/xinchenghua-public/glibc-2.39.tar.gz",
    "remote.SSH.customGccUrl": "https://halo.corp.kuaishou.com/api/cloud-storage/v1/public-objects/xinchenghua-public/gcc-14.2.0.tgz",
    "remote.SSH.customPatchelfUrl": "https://github.com/NixOS/patchelf/releases/download/0.18.0/patchelf-0.18.0-x86_64"
}
```

### 最小配置示例

```json
{
    "remote.SSH.enableCustomGlibc": true
}
```

使用最小配置时，会使用默认的下载地址。 