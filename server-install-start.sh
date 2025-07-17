#!/usr/bin/env bash

# =====================
# 远程 VSCode Server 安装脚本（参数化版）
# 支持所有参数通过命令行注入，未传递时使用默认值（参考 product.json）
# =====================

# 默认值（参考 product.json）
DEFAULT_VERSION="1.99.2"                # version
DEFAULT_COMMIT="0d38f1cdca0ce38fa15b2c5626b12a994c4cc784" # commit
DEFAULT_QUALITY="stable"                # quality
DEFAULT_RELEASE=""                      # release
DEFAULT_EXTENSIONS=""                   # 扩展列表，默认空
DEFAULT_ENV_VARS=""                     # 环境变量，默认空
DEFAULT_USE_SOCKET_PATH="false"         # 是否用 socket path
DEFAULT_SERVER_APP_NAME="kwaipilot-server"   # serverApplicationName
DEFAULT_SERVER_DATA_FOLDER=".kwaipilot-server" # serverDataFolderName
DEFAULT_DOWNLOAD_URL_TEMPLATE="https://team-robot.corp.kuaishou.com/download/vscode-reh-{os}-{arch}-{version}.tar.gz" # downloadUrlTemplate
DEFAULT_SCRIPT_ID="default-script-id"    # id

# 解析命令行参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --version) VERSION="$2"; shift 2;;
    --commit) COMMIT="$2"; shift 2;;
    --quality) QUALITY="$2"; shift 2;;
    --release) RELEASE="$2"; shift 2;;
    --extensions) EXTENSIONS="$2"; shift 2;;
    --env) ENV_VARS="$2"; shift 2;;
    --use-socket-path) USE_SOCKET_PATH="$2"; shift 2;;
    --server-app-name) SERVER_APP_NAME="$2"; shift 2;;
    --server-data-folder) SERVER_DATA_FOLDER="$2"; shift 2;;
    --download-url-template) DOWNLOAD_URL_TEMPLATE="$2"; shift 2;;
    --id) SCRIPT_ID="$2"; shift 2;;
    *) echo "未知参数: $1"; exit 1;;
  esac
done

# 使用默认值（如果未传递参数）
VERSION="${VERSION:-$DEFAULT_VERSION}"
COMMIT="${COMMIT:-$DEFAULT_COMMIT}"
QUALITY="${QUALITY:-$DEFAULT_QUALITY}"
RELEASE="${RELEASE:-$DEFAULT_RELEASE}"
EXTENSIONS="${EXTENSIONS:-$DEFAULT_EXTENSIONS}"
ENV_VARS="${ENV_VARS:-$DEFAULT_ENV_VARS}"
USE_SOCKET_PATH="${USE_SOCKET_PATH:-$DEFAULT_USE_SOCKET_PATH}"
SERVER_APP_NAME="${SERVER_APP_NAME:-$DEFAULT_SERVER_APP_NAME}"
SERVER_DATA_FOLDER="${SERVER_DATA_FOLDER:-$DEFAULT_SERVER_DATA_FOLDER}"
DOWNLOAD_URL_TEMPLATE="${DOWNLOAD_URL_TEMPLATE:-$DEFAULT_DOWNLOAD_URL_TEMPLATE}"
SCRIPT_ID="${SCRIPT_ID:-$DEFAULT_SCRIPT_ID}"

# 处理扩展列表
SERVER_INITIAL_EXTENSIONS=""
if [[ -n "$EXTENSIONS" ]]; then
  IFS=',' read -ra EXT_ARR <<< "$EXTENSIONS"
  for ext in "${EXT_ARR[@]}"; do
    [[ -n "$ext" ]] && SERVER_INITIAL_EXTENSIONS+="--install-extension $ext "
  done
fi

# 处理环境变量列表
ENV_ARR=()
if [[ -n "$ENV_VARS" ]]; then
  IFS=',' read -ra ENV_ARR <<< "$ENV_VARS"
fi

# 生成临时目录
TMP_DIR="${XDG_RUNTIME_DIR:-"/tmp"}"

# 生成监听参数
if [[ "$USE_SOCKET_PATH" == "true" ]]; then
  # 生成唯一 socket 路径
  if command -v uuidgen >/dev/null 2>&1; then
    SOCKET_UUID=$(uuidgen)
  else
    SOCKET_UUID=$(date +%s%N)
  fi
  SERVER_LISTEN_FLAG="--socket-path=\"$TMP_DIR/vscode-server-sock-$SOCKET_UUID\""
else
  SERVER_LISTEN_FLAG="--port=0"
fi

# 其它变量
DISTRO_VERSION="$VERSION"
DISTRO_COMMIT="$COMMIT"
DISTRO_QUALITY="$QUALITY"
DISTRO_VSCODIUM_RELEASE="$RELEASE"
SERVER_DATA_DIR="$HOME/$SERVER_DATA_FOLDER"
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
    echo "${SCRIPT_ID}: start"
    echo "exitCode==$code=="
    echo "errorMsg==$msg=="
    echo "listeningOn==$LISTENING_ON=="
    echo "connectionToken==$SERVER_CONNECTION_TOKEN=="
    echo "logFile==$SERVER_LOGFILE=="
    echo "osReleaseId==$OS_RELEASE_ID=="
    echo "arch==$ARCH=="
    echo "platform==$PLATFORM=="
    echo "tmpDir==$TMP_DIR=="
    for envVar in "${ENV_ARR[@]}"; do
      eval "echo \"$envVar==\[1m\${$envVar}\u001b[0m==\""
    done
    echo "${SCRIPT_ID}: end"
    exit 0
}

# 检查平台类型
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

# 检查架构
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

# 检查 OS 发行版
OS_RELEASE_ID="$(grep -i '^ID=' /etc/os-release 2>/dev/null | sed 's/^ID=//gi' | sed 's/"//g')"
if [[ -z $OS_RELEASE_ID ]]; then
    OS_RELEASE_ID="$(grep -i '^ID=' /usr/lib/os-release 2>/dev/null | sed 's/^ID=//gi' | sed 's/"//g')"
    if [[ -z $OS_RELEASE_ID ]]; then
        OS_RELEASE_ID="unknown"
    fi
fi

# 创建安装目录
if [[ ! -d $SERVER_DIR ]]; then
    mkdir -p $SERVER_DIR
    if (( $? > 0 )); then
        echo "Error creating server install directory: $SERVER_DIR"
        print_install_results_and_exit 1 "Error creating server install directory: $SERVER_DIR"
    fi
fi

# vscodium 特殊处理
if [[ $OS_RELEASE_ID = alpine ]]; then
    PLATFORM=$OS_RELEASE_ID
fi

# 生成下载地址
SERVER_DOWNLOAD_URL="$DOWNLOAD_URL_TEMPLATE"
SERVER_DOWNLOAD_URL="${SERVER_DOWNLOAD_URL//\{quality\}/$DISTRO_QUALITY}"
SERVER_DOWNLOAD_URL="${SERVER_DOWNLOAD_URL//\{version\}/$DISTRO_VERSION}"
SERVER_DOWNLOAD_URL="${SERVER_DOWNLOAD_URL//\{commit\}/$DISTRO_COMMIT}"
SERVER_DOWNLOAD_URL="${SERVER_DOWNLOAD_URL//\{os\}/$PLATFORM}"
SERVER_DOWNLOAD_URL="${SERVER_DOWNLOAD_URL//\{arch\}/$SERVER_ARCH}"
SERVER_DOWNLOAD_URL="${SERVER_DOWNLOAD_URL//\{release\}/$DISTRO_VSCODIUM_RELEASE}"

# 输出下载地址
echo "SERVER_DOWNLOAD_URL: $SERVER_DOWNLOAD_URL"

# 检查 server 是否已安装
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

    if command -v wget >/dev/null 2>&1; then
        wget --tries=3 --timeout=10 --continue --no-verbose -O vscode-server.tar.gz "$SERVER_DOWNLOAD_URL"
    elif command -v curl >/dev/null 2>&1; then
        curl --retry 3 --connect-timeout 10 --location --show-error --silent --output vscode-server.tar.gz "$SERVER_DOWNLOAD_URL"
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

# 检查 server 是否已运行
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
    # 生成唯一 token
    if command -v uuidgen >/dev/null 2>&1; then
      SERVER_CONNECTION_TOKEN=$(uuidgen)
    else
      SERVER_CONNECTION_TOKEN=$(date +%s%N)
    fi
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

# 完成安装，输出结果
print_install_results_and_exit 0 ""

if($SERVER_ID) {
    while($True) {
        if(!(gps -Id $SERVER_ID)) {
            "server died, exit"
            exit 0
        }

        sleep 30
    }
}