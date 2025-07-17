 **vscode 1.99 云开发机兼容问题解决** 

本文适合云开发机操作系统为 CentOS 7 的用户。


这里提供了两种方案，请按需选择。方案 1 比较折腾，但能用新版，方案 2 就是停留在上一个版本。

# 方案 1 ：按官方指示配置环境变量

官方提供了解决方案：[https://code.visualstudio.com/docs/remote/faq#\_can-i-run-vs-code-server-on-older-linux-distributions](https://code.visualstudio.com/docs/remote/faq#_can-i-run-vs-code-server-on-older-linux-distributions)

简要说，就是要配置 VSCODE\_SERVER\_CUSTOM\_GLIBC\_LINKER VSCODE\_SERVER\_CUSTOM\_GLIBC\_PATH VSCODE\_SERVER\_PATCHELF\_PATH 三个环境变量。下面提供了一种公司内可行的方法。

  

下载依赖库

```Bash
# 请 SSH 到云开发机执行
# 默认下载到 opt 目录下，后面设置环境变量也是用此目录下的
cd /opt

# 下载编译好的高版本 glibc
sudo wget https://halo.corp.kuaishou.com/api/cloud-storage/v1/public-objects/xinchenghua-public/glibc-2.39.tar.gz
sudo tar xzf glibc-2.39.tar.gz
sudo rm glibc-2.39.tar.gz

# 下载编译好的高版本 gcc （主要用 libstdc++ 等）
sudo wget https://halo.corp.kuaishou.com/api/cloud-storage/v1/public-objects/xinchenghua-public/gcc-14.2.0.tgz
sudo tar xzvf gcc-14.2.0.tgz
sudo rm gcc-14.2.0.tgz

# 安装 patchelf
sudo yum install patchelf
# 验证 patchelf 位置，一般会在 /usr/bin/patchelf
which patchelf

# 或者，可以按下面操作直接下载编译好的二进制
# wget https://halo.corp.kuaishou.com/api/cloud-storage/v1/public-objects/xinchenghua-public/patchelf
# chmod +x patchelf
# 找个地方放一下比如 sudo mv patchelf /usr/bin/patchelf
```

  

请把下面环境变量设置脚本放在 ~/.bashrc 或 /etc/bashrc  或 /etc/profile（/etc/profile 可能不行） 等会被自动加载的地方。

> 如果你的用户默认 shell 不是 bash ，请按实际情况调整。

```Bash
export VSCODE_SERVER_CUSTOM_GLIBC_LINKER=/opt/glibc-2.39/lib/ld-linux-x86-64.so.2
export VSCODE_SERVER_CUSTOM_GLIBC_PATH=/opt/glibc-2.39/lib:/opt/gcc-14.2.0/lib64:/lib64
export VSCODE_SERVER_PATCHELF_PATH=/usr/bin/patchelf
```

如果内容中实际路径不同，请自行修改。

  

启动新版本 vscode ！完成！成功后上方会显示一个横条，右边关闭即可，不影响使用。

  

## FAQ

### Q：还是提示不满足运行的先决条件

2025-05-25 之前建议放在 /etc/profile ，不过后来发现不会自动加载此位置（或者说 vscode server 的进程还没加载这个）， **所以建议把 export 内容放到所有下面几个文件里，如 /etc/bashrc, ~/.bashrc 等。** 如果你的用户默认 shell 不是 bash ，请按实际情况调整。

  

#### 排查上述三个环境变量是否正常的方法

vscode 尝试连接失败后，先别关 vscode ，用 terminal ssh 登录上去，可以用 ps 命令找到对应进程

```Bash
ps -ef | grep vscode-server | grep -v grep
```

随便找一个进程，记下第二列的进程号。用下面命令查看环境变量。

```Bash
cat /proc/进程号/environ | strings | grep VSCODE
```

如果不存在上述三个环境变量，可能就是因为没放对位置，导致环境变量没加载。尝试把上面环境变量 export 的内容放在 /etc/bashrc, ~/.bashrc 之类的地方。

然后关掉 vscode ，杀掉进程，删除 ~/.vscode-server/cli/servers

```Bash
# kill vscode
ps -ef | grep vscode-server | grep -v grep | awk {'print $2'} | xargs kill

# 删除下载的 servers
rm -rf ~/.vscode-server/cli/servers
```

重新打开 vscode 再次尝试连接。

  

### Q：卡在下载 vscode server

先看看下载是否在正常进行中，打开 OUTPUT 可以看到一些日志。

![](https://docs.corp.kuaishou.com/image/api/external/load/out?code=fcACJfFTFvg3z_7JDGOIlFK2y:2320285046083504760fcACJfFTFvg3z_7JDGOIlFK2y:1752752259242)

如上图这种状态，说明下载过程比较正常，稍微等一会就可以了。

  

如果不是，大概率是没有配置过网络代理，参考 [云开发机 C++ 开发使用教程](https://docs.corp.kuaishou.com/k/home/VZW8ZDZ2cXnk/fcABCZpckTQDzMDvyLYPL8FoT#section=h.g7qfo9hmfg7j) 配置代理

如果想清理重新下载 Remote 的 servers，可以删除此目录 ~/.vscode-server/cli/servers

> 千万别直接删 ~/.vscode-server 目录，你会丢失 Remote 上所有装过的插件及配置，别问我怎么知道的
  

如果是其它情况，请细看看 OUTPUT 里的日志。

  

### Q：卡在下载 vscode server ，弹出提示里包含 scp

这是在使用另一种下载方式：从 Mac 下载，然后通过 scp 传输到开发机上。

 **进入这个模式的，基本上还是因为开发机网络没配置好代理，因为首先会尝试开发机自行下载，走不通才会进入这种模式。** 

  

mac 的（办公网络的）下载速度很慢，比上面开发机通过网络代理网速更慢，你要慢慢等也可以。

如果想关闭这种 scp 下载方式，可以修改配置 remote.SSH.localServerDownload 成 off

![](https://docs.corp.kuaishou.com/image/api/external/load/out?code=fcACJfFTFvg3z_7JDGOIlFK2y:-1694555160720788759fcACJfFTFvg3z_7JDGOIlFK2y:1752752259242)

  

# Q：在 Terminal 可以 ssh 登录，但是用 vscode remote ssh 无法登录，提示 Timeout 错误

remote.SSH.useLocalServer 配置改成 false

  

# 方案 2 ：降级到 vscode 1.98.2 版本

```Bash
# 这段脚本需要 SSH 到云开发机执行

# 请先关闭所有 vscode 窗口
# kill vscode
ps -ef | grep vscode-server | grep -v grep | awk {'print $2'} | xargs kill

# 删除下载的 servers
rm -rf ~/.vscode-server/cli/servers
```

  

在本机 mac 上

1. 官方网站下载 1.98.2 版本 [https://code.visualstudio.com/updates/v1\_98](https://code.visualstudio.com/updates/v1_98)
2. 解压替换掉 Applications 里的 Visual Studio Code.app
3. 打开 vscode 的 Settings 将 Update: Mode 改成 none

![](https://docs.corp.kuaishou.com/image/api/external/load/out?code=fcACJfFTFvg3z_7JDGOIlFK2y:-1273013217452487475fcACJfFTFvg3z_7JDGOIlFK2y:1752752259242)