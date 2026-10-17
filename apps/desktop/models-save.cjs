// 配置与凭据分步保存；配置落库后不把凭据失败伪装成整次失败。
async function saveModelConfiguration(request, draft, key, expectedRevision) {
  const view = await request('model/registry/update', { draft, expectedRevision });
  if (!key.length) return view;
  try {
    const saved = (view.providers || []).find(provider => provider.id === draft.id);
    if (!saved || !saved.credentialRef) throw Error('credential-ref-missing');
    await request('model/registry/save-credential', { providerId: saved.id, expectedRevision: view.revision, key });
    return view;
  } catch (_) {
    // 不转发底层错误，避免凭据或提供方消息穿过 IPC。
    return { ...view, saveStatus: { configuration: 'saved', credential: 'failed', reason: 'credential-save-failed' } };
  }
}
module.exports = { saveModelConfiguration };
