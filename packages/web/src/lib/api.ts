const API_BASE = "/api";
const DEFAULT_TIMEOUT = 30000; // 默认超时 30 秒

interface RequestOptions extends RequestInit {
  timeout?: number; // 超时时间（毫秒）
}

class ApiClient {
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    const token = localStorage.getItem("token");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * 创建带超时的 AbortController
   */
  private createTimeoutController(timeout: number): {
    controller: AbortController;
    timeoutId: ReturnType<typeof setTimeout>;
  } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error("请求超时"));
    }, timeout);

    return { controller, timeoutId };
  }

  /**
   * 处理响应错误
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "请求失败" }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const { controller, timeoutId } = this.createTimeoutController(timeout);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        method: "GET",
        headers: {
          ...this.getHeaders(),
          ...options?.headers,
        },
        signal: controller.signal,
      });

      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const { controller, timeoutId } = this.createTimeoutController(timeout);

    const fetchOptions: RequestInit = {
      ...options,
      method: "POST",
      headers: {
        ...this.getHeaders(),
        ...options?.headers,
      },
      signal: controller.signal,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, fetchOptions);
      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const { controller, timeoutId } = this.createTimeoutController(timeout);

    const fetchOptions: RequestInit = {
      ...options,
      method: "PUT",
      headers: {
        ...this.getHeaders(),
        ...options?.headers,
      },
      signal: controller.signal,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, fetchOptions);
      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const { controller, timeoutId } = this.createTimeoutController(timeout);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        method: "DELETE",
        headers: {
          ...this.getHeaders(),
          ...options?.headers,
        },
        signal: controller.signal,
      });

      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    const { controller, timeoutId } = this.createTimeoutController(timeout);

    const fetchOptions: RequestInit = {
      ...options,
      method: "PATCH",
      headers: {
        ...this.getHeaders(),
        ...options?.headers,
      },
      signal: controller.signal,
    };

    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, fetchOptions);
      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export const api = new ApiClient();
