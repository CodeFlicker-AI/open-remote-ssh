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
    logger.info(`检测到 GLIBC 相关配置变更事件: ${affectedConfigs.join(', ')}`);
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

// 深度比较两个配置对象，忽略 undefined 和 null 的差异
function isGlibcConfigActuallyChanged(oldConfig: any, newConfig: any): boolean {
  if (!oldConfig || !newConfig) {
    return oldConfig !== newConfig;
  }

  const keys = ['enableCustomGlibc', 'customGlibcUrl', 'customGccUrl', 'customPatchelfUrl', 'serverDownloadUrl'];
  
  for (const key of keys) {
    const oldValue = oldConfig[key];
    const newValue = newConfig[key];
    
    // 处理 undefined 和 null 的情况
    if (oldValue === undefined && newValue === undefined) continue;
    if (oldValue === null && newValue === null) continue;
    if (oldValue === undefined && newValue === null) continue;
    if (oldValue === null && newValue === undefined) continue;
    
    // 如果其中一个值是 undefined 或 null，另一个不是，则认为发生了变化
    if ((oldValue === undefined || oldValue === null) !== (newValue === undefined || newValue === null)) {
      return true;
    }
    
    // 比较实际值
    if (oldValue !== newValue) {
      return true;
    }
  }
  
  return false;
}

// 记录配置变更的详细信息
function logConfigChangeDetails(oldConfig: any, newConfig: any, logger: Log) {
  const keys = ['enableCustomGlibc', 'customGlibcUrl', 'customGccUrl', 'customPatchelfUrl', 'serverDownloadUrl'];
  const changes: string[] = [];
  
  for (const key of keys) {
    const oldValue = oldConfig?.[key];
    const newValue = newConfig?.[key];
    
    if (oldValue !== newValue) {
      changes.push(`${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
    }
  }
  
  if (changes.length > 0) {
    logger.info(`GLIBC 配置发生实际变更:\n${changes.join('\n')}`);
  } else {
    logger.info('GLIBC 配置变更事件触发，但配置值未发生实际变化。');
  }
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
      
      if (isGlibcConfigChanged(e) && (vscode as any).versionType !== 'External') {
        const lastConfig = context.globalState.get<any>('openRemoteSsh.lastGlibcConfig');
        const currentConfig = getCurrentGlibcConfig();
        
        // 使用精确的配置比较函数
        if (isGlibcConfigActuallyChanged(lastConfig, currentConfig)) {
          // 记录配置变更的详细信息
          logConfigChangeDetails(lastConfig, currentConfig, logger);
          
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
