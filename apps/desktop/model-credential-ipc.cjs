function registerModelCredentialIpc(ipcMain, request, guard) {
  ipcMain.handle('sacode:modelsSaveCredential', async (_event, args) => {
    if (!args || typeof args.providerId !== 'string' || !args.providerId.length || args.providerId.length > 64 || Object.keys(args).some(k => !['providerId', 'key', 'expectedRevision'].includes(k))) throw Error('bad-model-provider');
    const key = guard.sanitizeKey(args.key);
    if (!key) throw Error('bad-model-key');
    const expectedRevision = guard.sanitizeRevision(args.expectedRevision);
    return request('model/registry/save-credential', { providerId: args.providerId, key, expectedRevision });
  });
}
module.exports = { registerModelCredentialIpc };