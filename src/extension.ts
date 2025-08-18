import * as vscode from 'vscode';
import Log from './common/logger';
import { RemoteSSHResolver, REMOTE_SSH_AUTHORITY } from './authResolver';
import { openSSHConfigFile, promptOpenRemoteSSHWindow } from './commands';
import { HostTreeDataProvider } from './hostTreeView';
import { getRemoteWorkspaceLocationData, RemoteLocationHistory } from './remoteLocationHistory';

// 监听 glibc 相关配置变更，变更后记录标志，重启后自动触发 server 重新安装
function isGlibcConfigChanged(e: vscode.ConfigurationChangeEvent): boolean {
  // 检查是否影响了 remote.SSH 相关的 glibc 配置
  const glibcConfigs = [
    'remote.SSH.enableCustomGlibc',
    'remote.SSH.customGlibcUrl',
    'remote.SSH.customGccUrl',
    'remote.SSH.customPatchelfUrl'
  ];
  
  // 只有当确实影响了这些配置时才返回 true
  return glibcConfigs.some(config => e.affectsConfiguration(config));
}

// 添加调试日志，帮助排查配置变更问题
function logConfigurationChange(e: vscode.ConfigurationChangeEvent, logger: Log) {
  const glibcConfigs = [
    'remote.SSH.enableCustomGlibc',
    'remote.SSH.customGlibcUrl',
    'remote.SSH.customGccUrl',
    'remote.SSH.customPatchelfUrl'
  ];
  
  const affectedConfigs = glibcConfigs.filter(config => e.affectsConfiguration(config));
  if (affectedConfigs.length > 0) {
    logger.info(`检测到 GLIBC 相关配置变更: ${affectedConfigs.join(', ')}`);
  }
}

// 获取当前 GLIBC 相关配置的快照
function getCurrentGlibcConfig() {
  const config = vscode.workspace.getConfiguration('remote.SSH');
  return {
    enableCustomGlibc: config.get('enableCustomGlibc'),
    customGlibcUrl: config.get('customGlibcUrl'),
    customGccUrl: config.get('customGccUrl'),
    customPatchelfUrl: config.get('customPatchelfUrl'),
    serverDownloadUrl: config.get('serverDownloadUrl'),
  };
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

    // 监听 GLIBC 相关配置变更，变更后记录标志，重启后自动触发 server 重新安装
    vscode.workspace.onDidChangeConfiguration(async e => {
      // 添加调试日志
      logConfigurationChange(e, logger);
      
      if (isGlibcConfigChanged(e)) {
        const lastConfig = context.globalState.get<any>('openRemoteSsh.lastGlibcConfig');
        const currentConfig = getCurrentGlibcConfig();
        if (!lastConfig || JSON.stringify(lastConfig) !== JSON.stringify(currentConfig)) {
          await context.globalState.update('openRemoteSsh.needReinstallServer', true);
          await context.globalState.update('openRemoteSsh.lastGlibcConfig', currentConfig);
          vscode.window.showInformationMessage('GLIBC 相关配置已变更，重启 VSCode 后将自动重新安装 server。');
        } else {
          logger.info('GLIBC 配置变更事件触发，但配置值未发生实际变化。');
        }
      }
    });
}

export function deactivate() {
}
