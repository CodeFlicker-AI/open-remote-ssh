import * as vscode from 'vscode';
import Log from './common/logger';
import { RemoteSSHResolver, REMOTE_SSH_AUTHORITY } from './authResolver';
import { openSSHConfigFile, promptOpenRemoteSSHWindow } from './commands';
import { HostTreeDataProvider } from './hostTreeView';
import { getRemoteWorkspaceLocationData, RemoteLocationHistory } from './remoteLocationHistory';

// 监听 glibc 相关配置变更，变更后记录标志，重启后自动触发 server 重新安装
function isGlibcConfigChanged(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration('openRemoteSsh.enableCustomGlibc')
    || e.affectsConfiguration('openRemoteSsh.customGlibcLinkerPath')
    || e.affectsConfiguration('openRemoteSsh.customGlibcLibPath')
    || e.affectsConfiguration('openRemoteSsh.customPatchelfPath');
}

export async function activate(context: vscode.ExtensionContext) {
    const logger = new Log('Remote - SSH');
    context.subscriptions.push(logger);

    const remoteSSHResolver = new RemoteSSHResolver(context, logger);
    context.subscriptions.push(vscode.workspace.registerRemoteAuthorityResolver(REMOTE_SSH_AUTHORITY, remoteSSHResolver));
    context.subscriptions.push(remoteSSHResolver);

    const locationHistory = new RemoteLocationHistory(context);
    const locationData = getRemoteWorkspaceLocationData();
    if (locationData) {
        await locationHistory.addLocation(locationData[0], locationData[1]);
    }

    const hostTreeDataProvider = new HostTreeDataProvider(locationHistory);
    context.subscriptions.push(vscode.window.createTreeView('sshHosts', { treeDataProvider: hostTreeDataProvider }));
    context.subscriptions.push(hostTreeDataProvider);

    context.subscriptions.push(vscode.commands.registerCommand('openremotessh.openEmptyWindow', () => promptOpenRemoteSSHWindow(false)));
    context.subscriptions.push(vscode.commands.registerCommand('openremotessh.openEmptyWindowInCurrentWindow', () => promptOpenRemoteSSHWindow(true)));
    context.subscriptions.push(vscode.commands.registerCommand('openremotessh.openConfigFile', () => openSSHConfigFile()));
    context.subscriptions.push(vscode.commands.registerCommand('openremotessh.showLog', () => logger.show()));

    vscode.workspace.onDidChangeConfiguration(e => {
      if (isGlibcConfigChanged(e)) {
        context.globalState.update('openRemoteSsh.needReinstallServer', true);
        vscode.window.showInformationMessage('GLIBC 相关配置已变更，重启 VSCode 后将自动重新安装 server。');
      }
    });

    // 激活时检查是否需要重新安装
    if (context.globalState.get('openRemoteSsh.needReinstallServer')) {
      // 1. 获取最近一次连接的 SSH 主机信息
      const locationData = getRemoteWorkspaceLocationData();
      if (!locationData) {
        logger.error('未找到最近的远程 SSH 连接信息，无法自动重新安装 server。');
        vscode.window.showErrorMessage('未找到最近的远程 SSH 连接信息，无法自动重新安装 server。');
        context.globalState.update('openRemoteSsh.needReinstallServer', false);
        return;
      }
      const [host, _path] = locationData;
      // 2. 解析 SSH 配置，获取用户、端口、密钥等
      const SSHConfiguration = (await import('./ssh/sshConfig')).default;
      const SSHDestination = (await import('./ssh/sshDestination')).default;
      const { gatherIdentityFiles } = await import('./ssh/identityFiles');
      const sshConfig = await SSHConfiguration.loadFromFS();
      const sshHostConfig = sshConfig.getHostConfiguration(host);
      const sshHostName = sshHostConfig['HostName'] ? sshHostConfig['HostName'].replace('%h', host) : host;
      const sshUser = sshHostConfig['User'] || require('os').userInfo().username || '';
      const sshPort = sshHostConfig['Port'] ? parseInt(sshHostConfig['Port'], 10) : 22;
      const identityFiles = (sshHostConfig['IdentityFile'] as unknown as string[]) || [];
      const identitiesOnly = (sshHostConfig['IdentitiesOnly'] || 'no').toLowerCase() === 'yes';
      const loggerForSSH = logger;
      const identityKeys = await gatherIdentityFiles(identityFiles, process.env['SSH_AUTH_SOCK'], identitiesOnly, loggerForSSH);
      // 3. 构造 SSH 连接
      const SSHConnection = (await import('./ssh/sshConnection')).default;
      const conn = new SSHConnection({
        host: sshHostName,
        port: sshPort,
        username: sshUser,
        // 这里只用第一个密钥，实际可扩展为多密钥尝试
        privateKey: identityKeys[0]?.parsedKey ? undefined : undefined, // 这里可根据实际密钥类型调整
        // 其它参数可根据需要补充
      });
      try {
        await conn.connect();
        logger.info(`已连接到远程主机 ${sshUser}@${sshHostName}:${sshPort}`);
        // 4. 删除所有 server 相关目录
        const { deleteRemoteServerDirs, installCodeServer } = await import('./serverSetup');
        await deleteRemoteServerDirs(conn, logger);
        // 5. 重新安装 server
        vscode.window.showInformationMessage('正在重新安装远程 server 以应用 GLIBC 相关配置...');
        await installCodeServer(conn, undefined, [], [], undefined, false, logger);
        vscode.window.showInformationMessage('远程 server 重新安装完成。');
      } catch (e) {
        logger.error('远程 server 重新安装失败', e);
        vscode.window.showErrorMessage('远程 server 重新安装失败，请检查日志。');
      } finally {
        context.globalState.update('openRemoteSsh.needReinstallServer', false);
        try { await conn.close(); } catch {}
      }
    }
}

export function deactivate() {
}
