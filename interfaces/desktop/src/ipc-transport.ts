/** HttpTransport that routes daemon calls through Tauri shell (token stays in Rust). */
import type { HttpRequest, HttpResponse } from '@cherishron/sacode-client-core';
import { daemonProxy } from './tauri-bridge.ts';

function extractPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    const idx = url.indexOf('/', url.indexOf('://') + 3);
    return idx >= 0 ? url.slice(idx) : url;
  }
}

export function createTauriTransport(): (request: HttpRequest) => Promise<HttpResponse> {
  return async (request) => {
    const path = extractPath(request.url);
    const res = await daemonProxy(
      request.method,
      path,
      request.body,
    );
    return {
      status: res.status,
      statusText: res.ok ? 'OK' : 'ERR',
      ok: res.ok,
      text: async () => res.body,
      json: async () => JSON.parse(res.body) as unknown,
    };
  };
}
