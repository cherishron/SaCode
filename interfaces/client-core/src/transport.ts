/** Transport abstraction so Desktop can inject Tauri IPC while Node uses fetch. */

export interface HttpRequest {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}

export interface HttpResponse {
    status: number;
    statusText: string;
    ok: boolean;
    headers?: Record<string, string>;
    text(): Promise<string>;
    json(): Promise<unknown>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

/** Normalize fetch Headers into a plain record, lowercasing keys. */
function extractHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key.toLowerCase()] = value;
    });
    return result;
}

/** Default transport using global fetch (Node 18+ / browsers). */
export const fetchTransport: HttpTransport = async (request) => {
    const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: request.signal,
    });
    return {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: extractHeaders(response.headers),
        text: () => response.text(),
        json: () => response.json() as Promise<unknown>,
        arrayBuffer: () => response.arrayBuffer(),
    };
};
