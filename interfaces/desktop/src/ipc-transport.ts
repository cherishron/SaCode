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
      arrayBuffer: async () => {
        // Tauri IPC returns strings; binary data arrives as base64 when
        // Content-Type is non-text. Fall back to Latin-1 encoding for
        // responses that arrive as raw strings.
        try {
          if (res.body.startsWith('base64:')) {
            const b64 = res.body.slice(7);
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes.buffer as ArrayBuffer;
          }
        } catch {
          // fall through
        }
        return new TextEncoder().encode(res.body).buffer as ArrayBuffer;
      },
    };
  };
}
