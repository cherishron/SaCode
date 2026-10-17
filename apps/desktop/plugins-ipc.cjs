// 插件管理：9 条通道逐条落地，逐字段校验。
// 缺通道的适配器保持 unconnected，不冒充本地状态。

function registerPluginsIpc(ipcMain, request, pluginsGuard, isStr) {
  ipcMain.handle("sacode:pluginsDescribe", async () => request("plugin/describe"));

  ipcMain.handle("sacode:pluginsSetEnabled", async (_e, args) => {
    const name = pluginsGuard.sanitizeName(args && args.name);
    const enabled = pluginsGuard.sanitizeEnabled(args && args.enabled);
    const expectedRevision = pluginsGuard.sanitizeRevision(args ? args.expectedRevision : undefined);
    return request("plugin/set-enabled", { name, enabled, expectedRevision });
  });

  ipcMain.handle("sacode:pluginsSetRowEnabled", async (_e, args) => {
    const entryId = pluginsGuard.sanitizeEntryId(args && args.entryId);
    const enabled = pluginsGuard.sanitizeEnabled(args && args.enabled);
    const expectedRevision = pluginsGuard.sanitizeRevision(args ? args.expectedRevision : undefined);
    return request("plugin/entry/set-enabled", { entryId, enabled, expectedRevision });
  });

  ipcMain.handle("sacode:pluginsUninstall", async (_e, args) => {
    const name = pluginsGuard.sanitizeName(args && args.name);
    return request("plugin/uninstall", { name, expectedRevision: pluginsGuard.sanitizeRevision(args ? args.expectedRevision : undefined) });
  });

  ipcMain.handle("sacode:pluginsRegistries", async () => request("plugin/registries"));

  ipcMain.handle("sacode:pluginsInspect", async (_e, args) => {
    const spec = pluginsGuard.sanitizeSpec(args && args.spec);
    const registry = pluginsGuard.sanitizeRegistry(args ? args.registry : undefined);
    return request("plugin/install/inspect", { spec, registry });
  });

  ipcMain.handle("sacode:pluginsInstall", async (_e, args) => {
    const spec = pluginsGuard.sanitizeSpec(args && args.spec);
    const registry = pluginsGuard.sanitizeRegistry(args ? args.registry : undefined);
    const requestId = pluginsGuard.sanitizeEntryId(args && args.requestId);
    const approvedBuilds = args && args.approvedBuilds;
    if (!Array.isArray(approvedBuilds) || approvedBuilds.length > 100) throw Error('bad-approved-builds');
    const builds = approvedBuilds.map(pluginsGuard.sanitizeName);
    if (builds.length) throw Error('plugin-build-approval-not-wired');
    return request("plugin/install/start", { spec, registry, requestId, approvedBuilds: builds });
  });

  ipcMain.handle("sacode:pluginsInstallPoll", async (_e, args) => {
    const requestId = pluginsGuard.sanitizeEntryId(args && args.requestId);
    return request("plugin/install/progress", { requestId });
  });

  ipcMain.handle("sacode:pluginsInstallCancel", async (_e, args) => {
    pluginsGuard.sanitizeEntryId(args && args.requestId);
    throw Error('plugin-install-cancel-not-wired');
  });
}

module.exports = { registerPluginsIpc };
