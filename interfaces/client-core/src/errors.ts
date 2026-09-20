/** Shared error types for client-core. */

export class ProtocolCompatibilityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProtocolCompatibilityError';
    }
}

export class DaemonClientError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number) {
        super(message);
        this.name = 'DaemonClientError';
        this.status = status;
    }
}

export async function responseError(response: HttpResponseLike, action: string): Promise<Error> {
    let detail = '';
    try {
        const body = await response.text();
        if (body) {
            try {
                const parsed: unknown = JSON.parse(body);
                detail = errorText(parsed) || body;
            } catch {
                detail = body;
            }
        }
    } catch {
        // status-only fallback
    }
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    return new DaemonClientError(`${action} failed (${status})${detail ? `: ${detail}` : ''}`, response.status);
}

interface HttpResponseLike {
    status: number;
    statusText: string;
    text(): Promise<string>;
}

export function errorText(value: unknown): string {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return '';
    const record = value as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
    return '';
}
