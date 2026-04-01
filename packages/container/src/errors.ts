/**
 * SaClaw Container Module - 错误类
 */

/**
 * 容器错误基类
 */
export class ContainerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ContainerError";
  }
}

/**
 * 容器未找到错误
 */
export class ContainerNotFoundError extends ContainerError {
  constructor(containerId: string) {
    super(`容器 ${containerId} 未找到`, "CONTAINER_NOT_FOUND", { containerId });
    this.name = "ContainerNotFoundError";
  }
}

/**
 * 容器运行时错误
 */
export class ContainerRuntimeError extends ContainerError {
  constructor(message: string, details?: unknown) {
    super(message, "RUNTIME_ERROR", details);
    this.name = "ContainerRuntimeError";
  }
}

/**
 * 容器超时错误
 */
export class ContainerTimeoutError extends ContainerError {
  constructor(containerId: string, timeout: number) {
    super(`容器 ${containerId} 执行超时 (${timeout}ms)`, "TIMEOUT", {
      containerId,
      timeout,
    });
    this.name = "ContainerTimeoutError";
  }
}
