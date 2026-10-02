/**
 * Local Mode UI 状态推断 — 账号页模式横幅 / 云能力置灰共用。
 * 纯函数，便于单测。状态暂由 account 数据推断；
 * TODO(Agent4): GET /account/status 返回 mode + cloud_available 后改读真实 mode。
 */

export type LocalMode = 'local' | 'online' | 'cloud_degraded';

export interface LocalModeInput {
  /** 账号状态；null = 尚未取到或未登录 */
  account?: { logged_in: boolean; logged_in_at?: string | null } | null;
  /** 账号状态接口报错 */
  accountError?: string | null;
  /** 云服务（权益 / 同步模型等）接口报错 */
  cloudServiceError?: string | null;
  /** 曾成功登录（login_state completed 或 logged_in_at 有值） */
  everLoggedIn?: boolean;
}

/**
 * 由现有 account 数据推断本地模式（P1 默认本地 / P2 登录永非门槛）。
 * 未登录→local；登录成功→online；登录过但服务报错→cloud_degraded。
 */
export function inferLocalMode(input: LocalModeInput): LocalMode {
  const loggedIn = Boolean(input.account?.logged_in);
  const everLoggedIn = Boolean(input.everLoggedIn || input.account?.logged_in_at);
  const serviceError = Boolean(
    (input.accountError && input.accountError.trim()) ||
      (input.cloudServiceError && input.cloudServiceError.trim()),
  );
  // 从未登录时云侧报错不降级：本地模式本就不依赖云
  if (serviceError && (loggedIn || everLoggedIn)) return 'cloud_degraded';
  return loggedIn ? 'online' : 'local';
}

/** C1 模式横幅一行文案。 */
export function localModeBannerText(mode: LocalMode): string {
  switch (mode) {
    case 'online':
      return '云增强已连接';
    case 'cloud_degraded':
      return '云增强不可用';
    case 'local':
    default:
      return '本地模式 · 使用本地模型';
  }
}

/** C1 模式横幅补充说明（一行）。 */
export function localModeBannerHint(mode: LocalMode): string {
  switch (mode) {
    case 'online':
      return '可同步网关模型、查看权益';
    case 'cloud_degraded':
      return '本地能力不受影响';
    case 'local':
    default:
      return '本地模式已就绪，登录是可选增强';
  }
}

/** C4 云能力置灰原因；online 返回 null（可用）。 */
export function cloudFeatureDisableReason(mode: LocalMode): string | null {
  switch (mode) {
    case 'online':
      return null;
    case 'cloud_degraded':
      return '云增强不可用，本地能力不受影响';
    case 'local':
    default:
      return '未登录 · 云增强为可选能力';
  }
}

/** 向导「models 每行一个」→ 模型 ID 列表。 */
export function parseModelsText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 合法协议类型集合（与 daemon 校验口径一致）。 */
export const API_TYPES: readonly ApiType[] = ['openai_compatible', 'openai_responses', 'anthropic'] as const;

/** 协议类型校验：空值时回退默认 openai_compatible。 */
export function normalizeApiType(value: string | undefined | null): ApiType {
  return API_TYPES.includes(value as ApiType) ? (value as ApiType) : 'openai_compatible';
}

export interface LocalProviderForm {
  name: string;
  /**
   * 接口协议（3 种）：
   * - openai_compatible：OpenAI 兼容 /v1/chat/completions（Ollama、vLLM、DeepSeek 等）
   * - openai_responses：OpenAI 原生 /v1/responses（GPT-5 系列）
   * - anthropic：Claude / Anthropic Messages API
   */
  api_type: ApiType;
  base_url: string;
  api_key: string;
  /** 从远端模型列表勾选的模型 ID */
  selected_models: string[];
  thinking: boolean;
  reasoning_effort: string;
}

/** 协议类型取值（与 API_TYPE_OPTIONS.value 保持一致）。 */
export type ApiType = 'openai_compatible' | 'openai_responses' | 'anthropic';

export interface LocalProviderPayload {
  name: string;
  api_type: string;
  base_url: string;
  api_key: string;
  models: string[];
  thinking: boolean;
  reasoning_effort?: string;
}

/** 向导表单 → createLocalProvider 入参；缺必填时返回 null。 */
export function buildLocalProviderPayload(
  form: LocalProviderForm,
): LocalProviderPayload | null {
  const name = form.name.trim();
  const api_type = normalizeApiType(form.api_type);
  const base_url = form.base_url.trim();
  const api_key = form.api_key.trim();
  const models = [...new Set(form.selected_models.map((m) => m.trim()).filter(Boolean))];
  if (!name || !base_url || !models.length) return null;
  return {
    name,
    api_type,
    base_url,
    api_key,
    models,
    thinking: form.thinking,
    reasoning_effort: form.reasoning_effort || undefined,
  };
}

/** 校验失败时的可读原因（与 daemon validate_create_provider 对齐）。 */
export function validateLocalProviderForm(form: LocalProviderForm): string | null {
  const name = form.name.trim();
  if (!name) return '名称不能为空';
  if (name.length > 64) return '名称过长（最多 64 字符）';
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    return '名称只能包含字母、数字、- 和 _（不含中文与空格）';
  }
  if (!API_TYPES.includes(form.api_type)) {
    return `不支持的接口协议：${form.api_type}`;
  }
  const url = form.base_url.trim();
  if (!url) return '接口地址不能为空';
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return '接口地址需为 http(s) URL';
    }
    if (u.username || u.password) return '接口地址不能含用户名/密码';
    if (u.search || u.hash) return '接口地址不能含查询串或片段';
  } catch {
    return '接口地址无效：需为 http(s) URL';
  }
  const models = [...new Set(form.selected_models.map((m) => m.trim()).filter(Boolean))];
  if (!models.length) return '请先从远端拉取模型列表并勾选至少一个模型';
  if (models.length > 50) return '模型过多（最多勾选 50 个）';
  if (models.some((m) => m.length > 128)) return '模型 ID 过长（最多 128 字符）';
  return null;
}

/** C5 空状态引导文案。 */
export const LOCAL_PROVIDER_EMPTY_HINT =
  '3 分钟配通本地模型：选接口协议、填名称、接口地址、API Key，models 每行一个即可开跑。';

/** C5 向导表单默认值（reasoning_effort 默认 medium 档）。 */
export function emptyLocalProviderForm(): LocalProviderForm {
  return {
    name: '',
    api_type: 'openai_compatible',
    base_url: '',
    api_key: '',
    selected_models: [],
    thinking: false,
    reasoning_effort: 'medium',
  };
}

/** 协议类型选项（3 种：OpenAI ×2 + Claude ×1；yapi/自定义已移除）。 */
export const API_TYPE_OPTIONS: Array<{ value: ApiType; label: string; hint: string }> = [
  {
    value: 'openai_compatible',
    label: 'OpenAI 兼容',
    hint: 'OpenAI 兼容 /v1/chat/completions（Ollama、vLLM、DeepSeek 等）',
  },
  {
    value: 'openai_responses',
    label: 'OpenAI Responses',
    hint: 'OpenAI 原生 /v1/responses API（GPT-5 系列）',
  },
  {
    value: 'anthropic',
    label: 'Claude / Anthropic',
    hint: 'Anthropic Messages API（/v1/messages）',
  },
];
