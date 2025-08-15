# Open Remote SSH

一个增强的 VS Code Remote-SSH 扩展，支持自定义 glibc 依赖注入和手动指定下载链接。

## 新功能

### 手动指定下载链接

除了默认的 `serverDownloadUrlTemplate` 配置外，现在还可以通过 `remote.SSH.serverDownloadUrl` 设置手动指定完整的下载链接。

**配置选项：**
- `remote.SSH.serverDownloadUrlTemplate`: 下载链接模板，支持变量替换
- `remote.SSH.serverDownloadUrl`: 完整的下载链接，优先级高于模板

**使用方式：**
1. 在 VS Code 设置中添加 `remote.SSH.serverDownloadUrl` 配置
2. 设置值为完整的下载链接，例如：`https://example.com/vscode-server-linux-x64-1.69.0.tar.gz`
3. 如果设置了此选项，将优先使用此链接进行下载，忽略 `serverDownloadUrlTemplate` 设置

**优先级顺序：**
1. `remote.SSH.serverDownloadUrl` (手动指定的完整链接)
2. `remote.SSH.serverDownloadUrlTemplate` (模板链接)
3. `product.json` 中的默认模板
4. 内置的默认模板

![Open Remote SSH](https://raw.githubusercontent.com/jeanp413/open-remote-ssh/master/docs/images/open-remote-ssh.gif)

## SSH Host Requirements
You can connect to a running SSH server on the following platforms.

**Supported**:

- x86_64 Debian 8+, Ubuntu 16.04+, CentOS / RHEL 7+ Linux.
- ARMv7l (AArch32) Raspbian Stretch/9+ (32-bit).
- ARMv8l (AArch64) Ubuntu 18.04+ (64-bit).
- macOS 10.14+ (Mojave)
- Windows 10+
- FreeBSD 13 (Requires manual remote-extension-host installation)
- DragonFlyBSD (Requires manual remote-extension-host installation)

## Requirements

**Activation**

> NOTE: Not needed in VSCodium since version 1.75

Enable the extension in your `argv.json`


```json
{
    ...
    "enable-proposed-api": [
        ...,
        "jeanp413.open-remote-ssh",
    ]
    ...
}
```
which you can open by running the `Preferences: Configure Runtime Arguments` command.
The file is located in `~/.vscode-oss/argv.json`.

**Alpine linux**

When running on alpine linux, the packages `libstdc++` and `bash` are necessary and can be installed via
running
```bash
sudo apk add bash libstdc++
```

## SSH configuration file

[OpenSSH](https://www.openssh.com/) supports using a [configuration file](https://linuxize.com/post/using-the-ssh-config-file/) to store all your different SSH connections. To use an SSH config file, run the `Remote-SSH: Open SSH Configuration File...` command.
