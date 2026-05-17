declare interface BunSpawnResult {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

declare const Bun: {
  spawn(
    cmd: string[],
    options?: {
      stdout?: "pipe";
      stderr?: "pipe";
      timeout?: number;
    }
  ): BunSpawnResult;
};
