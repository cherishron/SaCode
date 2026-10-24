// 配置只通过 Host 保存。此层不写文件、不联网、不记录密钥和原始异常。
export async function configurationStatus(client) {
  const view = await client.request("model/registry/describe", {}, 15000);
  const provider = view.providers?.find((item) => item.id === view.defaultProviderId);
  if (provider && view.defaultModel) return {
    configured: true, label: `${provider.name || provider.id}/${view.defaultModel}${provider.keyConfigured ? ' · 已存凭据，连通未验' : ' · 凭据未确认，连通未验'}`,
    credentialConfigured: provider.keyConfigured === true,
  };
  const legacy = await client.request("model/get", {}, 15000);
  const customs = await client.request("custom/describe", {}, 15000);
  const hasCustom = customs.models?.some((item) => item.enabled && item.bindings?.some((binding) => binding.enabled));
  return { configured: !!legacy.baseUrl || !!hasCustom,
    label: legacy.baseUrl ? legacy.model || "单路模型配置" : hasCustom ? "请用 /model 选择已配置模型" : "未配置 · /auth", credentialConfigured: legacy.keyLoaded === true };
}

export function validateProviderField(key, value, values = {}, view = {}) {
  if (typeof value !== 'string') throw new Error('字段值必须是文本');
  if (/[\x00-\x1f\x7f-\x9f]/.test(value)) throw new Error('此项不能含换行或控制字符');
  if (key === 'id') {
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(value)) throw new Error('供应商 ID 仅允许小写字母开头，最长48个字母、数字、下划线或短横线');
    if (view.providers?.some((item) => item.id === value)) throw new Error('该 ID 已存在；新建表单不会覆盖旧供应商');
  } else if (key === 'baseUrl') {
    if (value !== value.trim() || value.length > 2048) throw new Error('地址不能含首尾空白且最长2048字符');
    let url;
    try { url = new URL(value); } catch { throw new Error('请输入有效的 Base URL'); }
    if (url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#')) throw new Error('地址不能包含凭据、查询参数或片段');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('仅允许 HTTPS 或本机 loopback HTTP');
  } else if (key === 'model') {
    if (!value.trim() || value !== value.trim() || value.length > 256) throw new Error('模型 ID 不能为空、含首尾空白或超过256字符');
  } else if (key === 'key') {
    if (value.length > 8192 || value !== value.trim()) throw new Error('密钥格式无效：不能有首尾空白且最长8192字符');
    if (!value) {
      let local = false;
      try { local = ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(values.baseUrl).hostname); } catch { /* 地址字段先校验。 */ }
      if (!local) throw new Error('外部供应商需要填写密钥；仅本机无需认证服务可留空');
    }
  }
}

export function validateProviderDraft(values) {
  for (const key of ['id', 'baseUrl', 'model', 'key']) validateProviderField(key, values[key] ?? '', values);
  return { id: values.id, name: values.id, baseUrl: values.baseUrl, protocol: "openai-completions",
    models: [{ id: values.model.trim(), name: values.model.trim(), contextWindow: "", maxTokens: "", image: false, availability: "available", outputModalities: ["text"] }] };
}

export async function saveProviderConfiguration(client, values, expectedRevision) {
  const draft = validateProviderDraft(values);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('配置修订号无效，请退出后重新打开 /auth');
  let stage = "保存前检查";
  let writing = false;
  try {
    const before = await client.request('model/registry/describe', {}, 15000);
    if (!Array.isArray(before.providers) || before.writable !== true || before.revision !== expectedRevision
      || before.providers.some((item) => item.id === draft.id)) {
      throw new Error('preflight-conflict');
    }
    stage = "供应商配置";
    writing = true;
    const view = await client.request("model/registry/update", { draft, expectedRevision }, 15000);
    const provider = view.providers?.find((item) => item.id === draft.id);
    if (typeof provider?.credentialRef !== 'string' || !provider.credentialRef || provider.baseUrl !== draft.baseUrl || provider.protocol !== draft.protocol
      || !provider.models?.some((model) => model.id === draft.models[0].id) || !Number.isSafeInteger(view.revision) || view.revision < 0) throw new Error("unconfirmed");
    if (values.key) {
      stage = "凭据";
      const receipt = await client.request("credential/set", { ref: provider.credentialRef, value: values.key }, 15000);
      if (receipt?.configured !== true || receipt.ref !== provider.credentialRef) throw new Error("unconfirmed");
    }
    stage = "默认模型";
    const final = await client.request("model/registry/set-default", {
      providerId: provider.id, model: draft.models[0].id, expectedRevision: view.revision,
    }, 15000);
    if (final.defaultProviderId !== provider.id || final.defaultModel !== draft.models[0].id) throw new Error("unconfirmed");
    stage = '保存后回读';
    const checked = await client.request('model/registry/describe', {}, 15000);
    const saved = checked.providers?.find((item) => item.id === provider.id);
    if (checked.defaultProviderId !== provider.id || checked.defaultModel !== draft.models[0].id
      || saved?.baseUrl !== draft.baseUrl || saved.protocol !== draft.protocol || saved.credentialRef !== provider.credentialRef
      || !saved.models?.some((model) => model.id === draft.models[0].id)
      || (values.key && saved.keyConfigured !== true)) throw new Error('readback-unconfirmed');
    return { label: `${provider.name || provider.id}/${final.defaultModel} · 已保存，连通未验` };
  } catch {
    // 可能部分保存，禁止假装事务回滚或重发；秘密绝不拼入失败信息。
    throw new Error(writing ? `${stage}未确认；可能已部分生效。请退出后重新打开 /auth 核对，不自动重试。`
      : '保存前检查未通过；配置可能已被修改或不可写。本次未发出写操作，请退出后重新打开 /auth。');
  }
}
