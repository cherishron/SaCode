declare interface BunSpawnOptions {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: "pipe";
  stdout?: "pipe";
  stderr?: "pipe";
}

declare interface BunSubprocess {
  pid: number;
  stdin?: WritableStream<Uint8Array>;
  stdout?: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
  exited: Promise<number | null>;
  kill(): void;
}

declare const Bun: {
  spawn(options: BunSpawnOptions): BunSubprocess;
  pathToFileURL(path: string): URL;
};
