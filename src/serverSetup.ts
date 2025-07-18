import * as crypto from 'crypto';
import Log from './common/logger';
import { getVSCodeServerConfig } from './serverConfig';
import SSHConnection from './ssh/sshConnection';
import * as fs from 'fs';
import * as path from 'path';

export interface ServerInstallOptions {
    id: string;
    quality: string;
    commit: string;
    version: string;
    release?: string; // vscodium specific
    extensionIds: string[];
    envVariables: string[];
    useSocketPath: boolean;
    serverApplicationName: string;
    serverDataFolderName: string;
    serverDownloadUrlTemplate: string;
    // 新增 glibc 相关依赖参数
    glibcUrl?: string;
    gccUrl?: string;
    patchelfUrl?: string;
    // 新增：控制是否启用自定义 glibc 安装
    enableCustomGlibc?: boolean;
}

export interface ServerInstallResult {
    exitCode: number;
    listeningOn: number | string;
    connectionToken: string;
    logFile: string;
    osReleaseId: string;
    arch: string;
    platform: string;
    tmpDir: string;
    [key: string]: any;
}

export class ServerInstallError extends Error {
    constructor(message: string) {
        super(message);
    }
}

const DEFAULT_DOWNLOAD_URL_TEMPLATE = 'https://cdnfile.corp.kuaishou.com/kc/files/a/kwaipilot/vscodium/vscode-reh-${os}-${arch}-${version}.tar.gz';

export async function installCodeServer(conn: SSHConnection, serverDownloadUrlTemplate: string | undefined, extensionIds: string[], envVariables: string[], platform: string | undefined, useSocketPath: boolean, logger: Log): Promise<ServerInstallResult> {
    let shell = 'powershell';

    // detect platform and shell for windows
    if (!platform || platform === 'windows') {
        const result = await conn.exec('uname -s');

        if (result.stdout) {
            if (result.stdout.includes('windows32')) {
                platform = 'windows';
            } else if (result.stdout.includes('MINGW64')) {
                platform = 'windows';
                shell = 'bash';
            }
        } else if (result.stderr) {
            if (result.stderr.includes('FullyQualifiedErrorId : CommandNotFoundException')) {
                platform = 'windows';
            }

            if (result.stderr.includes('is not recognized as an internal or external command')) {
                platform = 'windows';
                shell = 'cmd';
            }
        }

        if (platform) {
            logger.trace(`Detected platform: ${platform}, ${shell}`);
        }
    }

    const scriptId = crypto.randomBytes(12).toString('hex');

    const vscodeServerConfig = await getVSCodeServerConfig();
    // 获取 remote.SSH 配置
    const remoteSSHconfig = require('vscode').workspace.getConfiguration('remote.SSH');
    const glibcUrl = remoteSSHconfig.get('customGlibcUrl');
    const gccUrl = remoteSSHconfig.get('customGccUrl');
    const patchelfUrl = remoteSSHconfig.get('customPatchelfUrl');
    let enableCustomGlibc = remoteSSHconfig.get('enableCustomGlibc', false);
    
    // 检查 CLOUDDEV_CONTAINER 环境变量，如果存在则禁用自定义 glibc 注入
    if (process.env.CLOUDDEV_CONTAINER) {
        logger.info('检测到 CLOUDDEV_CONTAINER 环境变量，禁用自定义 glibc 注入');
        enableCustomGlibc = false;
    }
    const installOptions: ServerInstallOptions = {
        id: scriptId,
        version: vscodeServerConfig.version,
        commit: vscodeServerConfig.commit,
        quality: vscodeServerConfig.quality,
        release: vscodeServerConfig.release,
        extensionIds,
        envVariables,
        useSocketPath,
        serverApplicationName: vscodeServerConfig.serverApplicationName,
        serverDataFolderName: vscodeServerConfig.serverDataFolderName,
        serverDownloadUrlTemplate: serverDownloadUrlTemplate || vscodeServerConfig.serverDownloadUrlTemplate || DEFAULT_DOWNLOAD_URL_TEMPLATE,
        // 依赖下载地址从 remote.SSH 配置读取
        glibcUrl,
        gccUrl,
        patchelfUrl,
        // 控制是否启用自定义 glibc 安装
        enableCustomGlibc,
    };

    let commandOutput: { stdout: string; stderr: string };
    if (platform === 'windows') {
        const installServerScript = generatePowerShellInstallScript(installOptions);

        // 保存 PowerShell 安装脚本到本地，便于后续定位问题
        try {
            const ps1Path = path.join(process.cwd(), 'vscode-server-install.ps1');
            fs.writeFileSync(ps1Path, installServerScript, 'utf8');
            logger.info(`已将 PowerShell 安装脚本保存到本地：${ps1Path}`);
        } catch (e) {
            logger.error('保存 PowerShell 安装脚本失败: ' + e);
        }

        logger.trace('Server install command:', installServerScript);

        const installDir = `$HOME\\${vscodeServerConfig.serverDataFolderName}\\install`;
        const installScript = `${installDir}\\${vscodeServerConfig.commit}.ps1`;
        const endRegex = new RegExp(`${scriptId}: end`);
        // investigate if it's possible to use `-EncodedCommand` flag
        // https://devblogs.microsoft.com/powershell/invoking-powershell-with-complex-expressions-using-scriptblocks/
        let command = '';
        if (shell === 'powershell') {
            command = `md -Force ${installDir}; echo @'\n${installServerScript}\n'@ | Set-Content ${installScript}; powershell -ExecutionPolicy ByPass -File "${installScript}"`;
        } else if (shell === 'bash') {
            command = `mkdir -p ${installDir.replace(/\\/g, '/')} && echo '\n${installServerScript.replace(/'/g, '\'"\'"\'')}\n' > ${installScript.replace(/\\/g, '/')} && powershell -ExecutionPolicy ByPass -File "${installScript}"`;
        } else if (shell === 'cmd') {
            const script = installServerScript.trim()
                // remove comments
                .replace(/^#.*$/gm, '')
                // remove empty lines
                .replace(/\n{2,}/gm, '\n')
                // remove leading spaces
                .replace(/^\s*/gm, '')
                // escape double quotes (from powershell/cmd)
                .replace(/"/g, '"""')
                // escape single quotes (from cmd)
                .replace(/'/g, `''`)
                // escape redirect (from cmd)
                .replace(/>/g, `^>`)
                // escape new lines (from powershell/cmd)
                .replace(/\n/g, '\'`n\'');

            command = `powershell "md -Force ${installDir}" && powershell "echo '${script}'" > ${installScript.replace('$HOME', '%USERPROFILE%')} && powershell -ExecutionPolicy ByPass -File "${installScript.replace('$HOME', '%USERPROFILE%')}"`;

            logger.trace('Command length (8191 max):', command.length);

            if (command.length > 8191) {
                throw new ServerInstallError(`Command line too long`);
            }
        } else {
            throw new ServerInstallError(`Not supported shell: ${shell}`);
        }

        commandOutput = await conn.execPartial(command, (stdout: string) => endRegex.test(stdout));
    } else {
        const installServerScript = generateBashInstallScript(installOptions);

        // 保存 Bash 安装脚本到本地，便于后续定位问题
        try {
            const shPath = path.join(process.cwd(), 'vscode-server-install.sh');
            fs.writeFileSync(shPath, installServerScript, 'utf8');
            logger.info(`已将 Bash 安装脚本保存到本地：${shPath}`);
        } catch (e) {
            logger.error('保存 Bash 安装脚本失败: ' + e);
        }

        logger.trace('Server install command:', installServerScript);
        // Fish shell does not support heredoc so let's workaround it using -c option,
        // also replace single quotes (') within the script with ('\'') as there's no quoting within single quotes, see https://unix.stackexchange.com/a/24676
        commandOutput = await conn.exec(`bash -c '${installServerScript.replace(/'/g, `'\\''`)}'`);
    }

    if (commandOutput.stderr) {
        logger.trace('Server install command stderr:', commandOutput.stderr);
    }
    logger.trace('Server install command stdout:', commandOutput.stdout);

    const resultMap = parseServerInstallOutput(commandOutput.stdout, scriptId);
    if (!resultMap) {
        throw new ServerInstallError(`Failed parsing install script output`);
    }

    const exitCode = parseInt(resultMap.exitCode, 10);
    if (exitCode !== 0) {
        throw new ServerInstallError(`Couldn't install vscode server on remote server, install script returned non-zero exit status`);
    }

    const listeningOn = resultMap.listeningOn.match(/^\d+$/)
        ? parseInt(resultMap.listeningOn, 10)
        : resultMap.listeningOn;

    const remoteEnvVars = Object.fromEntries(Object.entries(resultMap).filter(([key,]) => envVariables.includes(key)));

    return {
        exitCode,
        listeningOn,
        connectionToken: resultMap.connectionToken,
        logFile: resultMap.logFile,
        osReleaseId: resultMap.osReleaseId,
        arch: resultMap.arch,
        platform: resultMap.platform,
        tmpDir: resultMap.tmpDir,
        ...remoteEnvVars
    };
}

/**
 * 删除远程主机上所有 server 相关目录（彻底清理）
 * @param conn SSH 连接实例
 * @param logger 日志实例
 */
export async function deleteRemoteServerDirs(conn: SSHConnection, logger: Log): Promise<void> {
    const vscodeServerConfig = await getVSCodeServerConfig();
    // 远程 server 目录（如 $HOME/.vscode-server、$HOME/.vscode-remote、$HOME/.vscode-oss-server 等）
    const folderNames = [
        vscodeServerConfig.serverDataFolderName,
    ];
    for (const folder of folderNames) {
        // 支持多种 shell，兼容性更好
        const cmd = `rm -rf $HOME/${folder}`;
        logger.info(`[Server清理] 执行远程命令: ${cmd}`);
        try {
            const { stdout, stderr } = await conn.exec(cmd);
            if (stdout) {logger.trace(`[Server清理][stdout] ${stdout}`);}
            if (stderr) {logger.trace(`[Server清理][stderr] ${stderr}`);}
        } catch (e) {
            logger.error(`[Server清理] 删除 $HOME/${folder} 失败`, e);
        }
    }
}

function parseServerInstallOutput(str: string, scriptId: string): { [k: string]: string } | undefined {
    const startResultStr = `${scriptId}: start`;
    const endResultStr = `${scriptId}: end`;

    const startResultIdx = str.indexOf(startResultStr);
    if (startResultIdx < 0) {
        return undefined;
    }

    const endResultIdx = str.indexOf(endResultStr, startResultIdx + startResultStr.length);
    if (endResultIdx < 0) {
        return undefined;
    }

    const installResult = str.substring(startResultIdx + startResultStr.length, endResultIdx);

    const resultMap: { [k: string]: string } = {};
    const resultArr = installResult.split(/\r?\n/);
    for (const line of resultArr) {
        const [key, value] = line.split('==');
        resultMap[key] = value;
    }

    return resultMap;
}

function generateBashInstallScript({ id, quality, version, commit, release, extensionIds, envVariables, useSocketPath, serverApplicationName, serverDataFolderName, serverDownloadUrlTemplate, glibcUrl, gccUrl, patchelfUrl, enableCustomGlibc }: ServerInstallOptions) {
    const extensions = extensionIds.map(id => '--install-extension ' + id).join(' ');
    // 依赖下载地址优先用参数，否则用默认
    const GLIBC_URL = glibcUrl || '';
    const GCC_URL = gccUrl || '';
    const PATCHELF_URL = patchelfUrl || '';
    
    // 根据 enableCustomGlibc 参数决定是否包含 glibc 安装脚本
    // 同时检查 CLOUDDEV_CONTAINER 环境变量，如果存在则跳过 glibc 安装
    const glibcInstallScript = enableCustomGlibc ? `
# ========== 自动下载安装 glibc 及相关依赖 ==========
# 检查 CLOUDDEV_CONTAINER 环境变量，如果存在则跳过 glibc 安装
if [ -n "$CLOUDDEV_CONTAINER" ]; then
  echo "检测到 CLOUDDEV_CONTAINER 环境变量，跳过自定义 glibc 注入"
else
  GLIBC_URL="${GLIBC_URL}"
  GCC_URL="${GCC_URL}"
  PATCHELF_URL="${PATCHELF_URL}"
  # 依赖安装目录，使用用户目录，避免权限问题
  DEPS_DIR="$HOME/.vscode-server-deps"
  mkdir -p "$DEPS_DIR"
  cd "$DEPS_DIR"

  # 下载 glibc
  if [ ! -d "glibc-2.39" ]; then
    wget $GLIBC_URL -O glibc-2.39.tar.gz
    tar xzf glibc-2.39.tar.gz
    rm glibc-2.39.tar.gz
  fi

  # 下载 gcc
  if [ ! -d "gcc-14.2.0" ]; then
    wget $GCC_URL -O gcc-14.2.0.tgz
    tar xzvf gcc-14.2.0.tgz
    rm gcc-14.2.0.tgz
  fi

  # 安装 patchelf 到本地目录
  if ! command -v patchelf &> /dev/null; then
    if [ -n "$PATCHELF_URL" ]; then
      wget $PATCHELF_URL -O patchelf
      chmod +x patchelf
      # 放到本地 bin 目录
      mkdir -p "$DEPS_DIR/bin"
      mv patchelf "$DEPS_DIR/bin/patchelf"
      export PATH="$DEPS_DIR/bin:$PATH"
    else
      echo "请手动安装 patchelf 或提供 PATCHELF_URL"
      exit 1
    fi
  fi

  # 输出依赖路径
  export VSCODE_SERVER_CUSTOM_GLIBC_LINKER="$DEPS_DIR/glibc-2.39/lib/ld-linux-x86-64.so.2"
  export VSCODE_SERVER_CUSTOM_GLIBC_PATH="$DEPS_DIR/glibc-2.39/lib:$DEPS_DIR/gcc-14.2.0/lib64:/lib64"
  export VSCODE_SERVER_PATCHELF_PATH="$DEPS_DIR/bin/patchelf"
fi
# ========== 依赖安装结束 ==========
` : '';
    
    return `
# Server installation script

${glibcInstallScript}

TMP_DIR="\${XDG_RUNTIME_DIR:-\"/tmp\"}"

DISTRO_VERSION="${version}"
DISTRO_COMMIT="${commit}"
DISTRO_QUALITY="${quality}"
DISTRO_VSCODIUM_RELEASE="${release ?? ''}"

SERVER_APP_NAME="${serverApplicationName}"
SERVER_INITIAL_EXTENSIONS="${extensions}"
SERVER_LISTEN_FLAG="${useSocketPath ? `--socket-path=\"$TMP_DIR/vscode-server-sock-${crypto.randomUUID()}\"` : '--port=0'}"
SERVER_DATA_DIR="$HOME/${serverDataFolderName}"
SERVER_DIR="$SERVER_DATA_DIR/bin/$DISTRO_COMMIT"
SERVER_SCRIPT="$SERVER_DIR/bin/$SERVER_APP_NAME"
SERVER_LOGFILE="$SERVER_DATA_DIR/.$DISTRO_COMMIT.log"
SERVER_PIDFILE="$SERVER_DATA_DIR/.$DISTRO_COMMIT.pid"
SERVER_TOKENFILE="$SERVER_DATA_DIR/.$DISTRO_COMMIT.token"
SERVER_ARCH=
SERVER_CONNECTION_TOKEN=
SERVER_DOWNLOAD_URL=

LISTENING_ON=
OS_RELEASE_ID=
ARCH=
PLATFORM=

# Mimic output from logs of remote-ssh extension
print_install_results_and_exit() {
    local code=$1
    local msg=$2
    echo "${id}: start"
    echo "exitCode==$code=="
    echo "errorMsg==$2=="
    echo "listeningOn==$LISTENING_ON=="
    echo "connectionToken==$SERVER_CONNECTION_TOKEN=="
    echo "logFile==$SERVER_LOGFILE=="
    echo "osReleaseId==$OS_RELEASE_ID=="
    echo "arch==$ARCH=="
    echo "platform==$PLATFORM=="
    echo "tmpDir==$TMP_DIR=="
    ${envVariables.map(envVar => `echo \"${envVar}==\$${envVar}==\"`).join('\n')}
    echo "${id}: end"
    exit 0
}

# Check if platform is supported
KERNEL="$(uname -s)"
case $KERNEL in
    Darwin)
        PLATFORM="darwin"
        ;;
    Linux)
        PLATFORM="linux"
        ;;
    FreeBSD)
        PLATFORM="freebsd"
        ;;
    DragonFly)
        PLATFORM="dragonfly"
        ;;
    *)
        echo "Error platform not supported: $KERNEL"
        print_install_results_and_exit 1 "Error platform not supported: $KERNEL"
        ;;
esac

# Check machine architecture
ARCH="$(uname -m)"
case $ARCH in
    x86_64 | amd64)
        SERVER_ARCH="x64"
        ;;
    armv7l | armv8l)
        SERVER_ARCH="armhf"
        ;;
    arm64 | aarch64)
        SERVER_ARCH="arm64"
        ;;
    ppc64le)
        SERVER_ARCH="ppc64le"
        ;;
    riscv64)
        SERVER_ARCH="riscv64"
        ;;
    loongarch64)
        SERVER_ARCH="loong64"
        ;;
    s390x)
        SERVER_ARCH="s390x"
        ;;
    *)
        echo "Error architecture not supported: $ARCH"
        print_install_results_and_exit 1 "Error architecture not supported: $ARCH"
        ;;
esac

# https://www.freedesktop.org/software/systemd/man/os-release.html
OS_RELEASE_ID="$(grep -i '^ID=' /etc/os-release 2>/dev/null | sed 's/^ID=//gi' | sed 's/"//g')"
if [[ -z $OS_RELEASE_ID ]]; then
    OS_RELEASE_ID="$(grep -i '^ID=' /usr/lib/os-release 2>/dev/null | sed 's/^ID=//gi' | sed 's/"//g')"
    if [[ -z $OS_RELEASE_ID ]]; then
        OS_RELEASE_ID="unknown"
    fi
fi

# Create installation folder
if [[ ! -d $SERVER_DIR ]]; then
    mkdir -p $SERVER_DIR
    if (( $? > 0 )); then
        echo "Error creating server install directory: $SERVER_DIR"
        print_install_results_and_exit 1 "Error creating server install directory: $SERVER_DIR"
    fi
fi

# adjust platform for vscodium download, if needed
if [[ $OS_RELEASE_ID = alpine ]]; then
    PLATFORM=$OS_RELEASE_ID
fi

SERVER_DOWNLOAD_URL="$(echo "${serverDownloadUrlTemplate.replace(/\$\{/g, '\\${')}" | sed "s/\\\${quality}/$DISTRO_QUALITY/g" | sed "s/\\\${version}/$DISTRO_VERSION/g" | sed "s/\\\${commit}/$DISTRO_COMMIT/g" | sed "s/\\\${os}/$PLATFORM/g" | sed "s/\\\${arch}/$SERVER_ARCH/g" | sed "s/\\\${release}/$DISTRO_VSCODIUM_RELEASE/g")"


echo "SERVER_DOWNLOAD_URL: $SERVER_DOWNLOAD_URL"

# Check if server script is already installed
if [[ ! -f $SERVER_SCRIPT ]]; then
    case "$PLATFORM" in
        darwin | linux | alpine )
            ;;
        *)
            echo "Error '$PLATFORM' needs manual installation of remote extension host"
            print_install_results_and_exit 1 "Error '$PLATFORM' needs manual installation of remote extension host"
            ;;
    esac

    pushd $SERVER_DIR > /dev/null

    if [[ ! -z $(which wget) ]]; then
        wget --tries=3 --timeout=10 --continue --no-verbose -O vscode-server.tar.gz $SERVER_DOWNLOAD_URL
    elif [[ ! -z $(which curl) ]]; then
        curl --retry 3 --connect-timeout 10 --location --show-error --silent --output vscode-server.tar.gz $SERVER_DOWNLOAD_URL
    else
        echo "Error no tool to download server binary"
        print_install_results_and_exit 1 "Error no tool to download server binary"
    fi

    if (( $? > 0 )); then
        echo "Error downloading server from $SERVER_DOWNLOAD_URL"
        print_install_results_and_exit 1 "Error downloading server from $SERVER_DOWNLOAD_URL"
    fi

    tar -xf vscode-server.tar.gz --strip-components 1
    if (( $? > 0 )); then
        echo "Error while extracting server contents"
        print_install_results_and_exit 1 "Error while extracting server contents"
    fi

    if [[ ! -f $SERVER_SCRIPT ]]; then
        echo "Error server contents are corrupted"
        print_install_results_and_exit 1 "Error server contents are corrupted"
    fi

    rm -f vscode-server.tar.gz

    popd > /dev/null
else
    echo "Server script already installed in $SERVER_SCRIPT"
fi

# Try to find if server is already running
if [[ -f $SERVER_PIDFILE ]]; then
    SERVER_PID="$(cat $SERVER_PIDFILE)"
    SERVER_RUNNING_PROCESS="$(ps -o pid,args -p $SERVER_PID | grep $SERVER_SCRIPT)"
else
    SERVER_RUNNING_PROCESS="$(ps -o pid,args -A | grep $SERVER_SCRIPT | grep -v grep)"
fi

if [[ -z $SERVER_RUNNING_PROCESS ]]; then
    if [[ -f $SERVER_LOGFILE ]]; then
        rm $SERVER_LOGFILE
    fi
    if [[ -f $SERVER_TOKENFILE ]]; then
        rm $SERVER_TOKENFILE
    fi

    touch $SERVER_TOKENFILE
    chmod 600 $SERVER_TOKENFILE
    SERVER_CONNECTION_TOKEN="${crypto.randomUUID()}"
    echo $SERVER_CONNECTION_TOKEN > $SERVER_TOKENFILE

    $SERVER_SCRIPT --start-server --host=127.0.0.1 $SERVER_LISTEN_FLAG $SERVER_INITIAL_EXTENSIONS --connection-token-file $SERVER_TOKENFILE --telemetry-level off --enable-remote-auto-shutdown --accept-server-license-terms &> $SERVER_LOGFILE &
    echo $! > $SERVER_PIDFILE
else
    echo "Server script is already running $SERVER_SCRIPT"
fi

if [[ -f $SERVER_TOKENFILE ]]; then
    SERVER_CONNECTION_TOKEN="$(cat $SERVER_TOKENFILE)"
else
    echo "Error server token file not found $SERVER_TOKENFILE"
    print_install_results_and_exit 1 "Error server token file not found $SERVER_TOKENFILE"
fi

if [[ -f $SERVER_LOGFILE ]]; then
    for i in {1..5}; do
        LISTENING_ON="$(cat $SERVER_LOGFILE | grep -E 'Extension host agent listening on .+' | sed 's/Extension host agent listening on //')"
        if [[ -n $LISTENING_ON ]]; then
            break
        fi
        sleep 0.5
    done

    if [[ -z $LISTENING_ON ]]; then
        echo "Error server did not start successfully"
        print_install_results_and_exit 1 "Error server did not start successfully"
    fi
else
    echo "Error server log file not found $SERVER_LOGFILE"
    print_install_results_and_exit 1 "Error server log file not found $SERVER_LOGFILE"
fi

# Finish server setup
print_install_results_and_exit 0
`;
}

function generatePowerShellInstallScript({ id, quality, version, commit, release, extensionIds, envVariables, useSocketPath, serverApplicationName, serverDataFolderName, serverDownloadUrlTemplate, enableCustomGlibc }: ServerInstallOptions) {
    const extensions = extensionIds.map(id => '--install-extension ' + id).join(' ');
    const downloadUrl = serverDownloadUrlTemplate
        .replace(/\$\{quality\}/g, quality)
        .replace(/\$\{version\}/g, version)
        .replace(/\$\{commit\}/g, commit)
        .replace(/\$\{os\}/g, 'win32')
        .replace(/\$\{arch\}/g, 'x64')
        .replace(/\$\{release\}/g, release ?? '');

    // 注意：enableCustomGlibc 功能在 Windows 环境下暂不支持
    // 因为 glibc 是 Linux 系统的 C 标准库，Windows 使用不同的运行时库
    if (enableCustomGlibc) {
        console.warn('enableCustomGlibc 功能在 Windows 环境下暂不支持，将忽略此设置');
    }

    return `
# Server installation script

$TMP_DIR="$env:TEMP\\$([System.IO.Path]::GetRandomFileName())"
$ProgressPreference = "SilentlyContinue"

$DISTRO_VERSION="${version}"
$DISTRO_COMMIT="${commit}"
$DISTRO_QUALITY="${quality}"
$DISTRO_VSCODIUM_RELEASE="${release ?? ''}"

$SERVER_APP_NAME="${serverApplicationName}"
$SERVER_INITIAL_EXTENSIONS="${extensions}"
$SERVER_LISTEN_FLAG="${useSocketPath ? `--socket-path="$TMP_DIR/vscode-server-sock-${crypto.randomUUID()}"` : '--port=0'}"
$SERVER_DATA_DIR="$(Resolve-Path ~)\\${serverDataFolderName}"
$SERVER_DIR="$SERVER_DATA_DIR\\bin\\$DISTRO_COMMIT"
$SERVER_SCRIPT="$SERVER_DIR\\bin\\$SERVER_APP_NAME.cmd"
$SERVER_LOGFILE="$SERVER_DATA_DIR\\.$DISTRO_COMMIT.log"
$SERVER_PIDFILE="$SERVER_DATA_DIR\\.$DISTRO_COMMIT.pid"
$SERVER_TOKENFILE="$SERVER_DATA_DIR\\.$DISTRO_COMMIT.token"
$SERVER_ARCH=
$SERVER_CONNECTION_TOKEN=
$SERVER_DOWNLOAD_URL=

$LISTENING_ON=
$OS_RELEASE_ID=
$ARCH=
$PLATFORM="win32"

function printInstallResults($code) {
    "${id}: start"
    "exitCode==$code=="
    "listeningOn==$LISTENING_ON=="
    "connectionToken==$SERVER_CONNECTION_TOKEN=="
    "logFile==$SERVER_LOGFILE=="
    "osReleaseId==$OS_RELEASE_ID=="
    "arch==$ARCH=="
    "platform==$PLATFORM=="
    "tmpDir==$TMP_DIR=="
    ${envVariables.map(envVar => `"${envVar}==$${envVar}=="`).join('\n')}
    "${id}: end"
}

# Check machine architecture
$ARCH=$env:PROCESSOR_ARCHITECTURE
# Use x64 version for ARM64, as it's not yet available.
if(($ARCH -eq "AMD64") -or ($ARCH -eq "IA64") -or ($ARCH -eq "ARM64")) {
    $SERVER_ARCH="x64"
}
else {
    "Error architecture not supported: $ARCH"
    printInstallResults 1
    exit 0
}

# Create installation folder
if(!(Test-Path $SERVER_DIR)) {
    try {
        ni -it d $SERVER_DIR -f -ea si
    } catch {
        "Error creating server install directory - $($_.ToString())"
        exit 1
    }

    if(!(Test-Path $SERVER_DIR)) {
        "Error creating server install directory"
        exit 1
    }
}

cd $SERVER_DIR

# Check if server script is already installed
if(!(Test-Path $SERVER_SCRIPT)) {
    del vscode-server.tar.gz

    $REQUEST_ARGUMENTS = @{
        Uri="${downloadUrl}"
        TimeoutSec=20
        OutFile="vscode-server.tar.gz"
        UseBasicParsing=$True
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    Invoke-RestMethod @REQUEST_ARGUMENTS

    if(Test-Path "vscode-server.tar.gz") {
        tar -xf vscode-server.tar.gz --strip-components 1

        del vscode-server.tar.gz
    }

    if(!(Test-Path $SERVER_SCRIPT)) {
        "Error while installing the server binary"
        exit 1
    }
}
else {
    "Server script already installed in $SERVER_SCRIPT"
}

# Try to find if server is already running
if(Get-Process node -ErrorAction SilentlyContinue | Where-Object Path -Like "$SERVER_DIR\\*") {
    echo "Server script is already running $SERVER_SCRIPT"
}
else {
    if(Test-Path $SERVER_LOGFILE) {
        del $SERVER_LOGFILE
    }
    if(Test-Path $SERVER_PIDFILE) {
        del $SERVER_PIDFILE
    }
    if(Test-Path $SERVER_TOKENFILE) {
        del $SERVER_TOKENFILE
    }

    $SERVER_CONNECTION_TOKEN="${crypto.randomUUID()}"
    [System.IO.File]::WriteAllLines($SERVER_TOKENFILE, $SERVER_CONNECTION_TOKEN)

    $SCRIPT_ARGUMENTS="--start-server --host=127.0.0.1 $SERVER_LISTEN_FLAG $SERVER_INITIAL_EXTENSIONS --connection-token-file $SERVER_TOKENFILE --telemetry-level off --enable-remote-auto-shutdown --accept-server-license-terms *> '$SERVER_LOGFILE'"

    $START_ARGUMENTS = @{
        FilePath = "powershell.exe"
        WindowStyle = "hidden"
        ArgumentList = @(
            "-ExecutionPolicy", "Unrestricted", "-NoLogo", "-NoProfile", "-NonInteractive", "-c", "$SERVER_SCRIPT $SCRIPT_ARGUMENTS"
        )
        PassThru = $True
    }

    $SERVER_ID = (start @START_ARGUMENTS).ID

    if($SERVER_ID) {
        [System.IO.File]::WriteAllLines($SERVER_PIDFILE, $SERVER_ID)
    }
}

if(Test-Path $SERVER_TOKENFILE) {
    $SERVER_CONNECTION_TOKEN="$(cat $SERVER_TOKENFILE)"
}
else {
    "Error server token file not found $SERVER_TOKENFILE"
    printInstallResults 1
    exit 0
}

sleep -Milliseconds 500

$SELECT_ARGUMENTS = @{
    Path = $SERVER_LOGFILE
    Pattern = "Extension host agent listening on (\\d+)"
}

for($I = 1; $I -le 5; $I++) {
    if(Test-Path $SERVER_LOGFILE) {
        $GROUPS = (Select-String @SELECT_ARGUMENTS).Matches.Groups

        if($GROUPS) {
            $LISTENING_ON = $GROUPS[1].Value
            break
        }
    }

    sleep -Milliseconds 500
}

if(!(Test-Path $SERVER_LOGFILE)) {
    "Error server log file not found $SERVER_LOGFILE"
    printInstallResults 1
    exit 0
}

# Finish server setup
printInstallResults 0

if($SERVER_ID) {
    while($True) {
        if(!(gps -Id $SERVER_ID)) {
            "server died, exit"
            exit 0
        }

        sleep 30
    }
}
`;
}
