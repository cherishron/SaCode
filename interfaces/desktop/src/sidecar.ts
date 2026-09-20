/**
 * Desktop sidecar ready-file handshake (Compose desktop-sidecar T1).
 * Contract mirrors runtime/src/daemon/sidecar.rs DaemonReadyInfo.
 */

export interface DaemonReadyInfo {
  schema_version: number;
  host: string;
  port: number;
  pid?: number;
  version?: string;
  protocol_version?: number;
  base_url?: string;
  nonce?: string;
  auth_required?: boolean;
}

export class ReadyFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadyFileError';
  }
}

export function parseReadyInfo(raw: string, expectNonce?: string): DaemonReadyInfo {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    throw new ReadyFileError(`ready-file is not valid JSON: ${e}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReadyFileError('ready-file must be a JSON object');
  }
  const r = value as Record<string, unknown>;
  if (r.schema_version !== 1) {
    throw new ReadyFileError(`unsupported ready schema_version: ${String(r.schema_version)}`);
  }
  const host = typeof r.host === 'string' ? r.host.trim() : '';
  if (!host) throw new ReadyFileError('ready-file missing host');
  const port = typeof r.port === 'number' && Number.isInteger(r.port) && r.port > 0 ? r.port : 0;
  if (!port) throw new ReadyFileError('ready-file missing valid port');
  if (expectNonce !== undefined) {
    const nonce = typeof r.nonce === 'string' ? r.nonce : '';
    if (nonce !== expectNonce) {
      throw new ReadyFileError('ready-file nonce mismatch');
    }
  }
  const base_url =
    typeof r.base_url === 'string' && r.base_url.trim()
      ? r.base_url.trim()
      : `http://${host}:${port}`;
  // Security: token must never appear in ready-file
  const rawLower = raw.toLowerCase();
  if (rawLower.includes('"token"') || rawLower.includes('"secret"')) {
    throw new ReadyFileError('ready-file must not contain token/secret fields');
  }
  return {
    schema_version: 1,
    host,
    port,
    pid: typeof r.pid === 'number' ? r.pid : undefined,
    version: typeof r.version === 'string' ? r.version : undefined,
    protocol_version: typeof r.protocol_version === 'number' ? r.protocol_version : undefined,
    base_url,
    nonce: typeof r.nonce === 'string' ? r.nonce : undefined,
    auth_required: r.auth_required === true,
  };
}

export function readyBaseUrl(info: DaemonReadyInfo): string {
  return info.base_url ?? `http://${info.host}:${info.port}`;
}

export interface HealthResult {
  ok: boolean;
  status?: string;
  version?: string;
  detail?: string;
}

export async function checkHealth(
  baseUrl: string,
  token?: string,
  timeoutMs = 3000,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/health`, {
      headers,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as Record<string, unknown>;
    const status = typeof body.status === 'string' ? body.status : '';
    return {
      ok: status === 'healthy',
      status,
      version: typeof body.version === 'string' ? body.version : undefined,
    };
  } catch (e) {
    return { ok: false, detail: String(e) };
  } finally {
    clearTimeout(t);
  }
}

export async function waitForHealthy(
  baseUrl: string,
  token?: string,
  timeoutMs = 20000,
  intervalMs = 200,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResult> {
  const deadline = Date.now() + timeoutMs;
  let last: HealthResult = { ok: false, detail: 'not started' };
  while (Date.now() < deadline) {
    last = await checkHealth(baseUrl, token, Math.min(3000, timeoutMs), fetchImpl);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
