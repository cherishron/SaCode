// TUI 入口：只做三件事——确认在交互终端里、拉起宿主、把 Ink 应用挂上去。
// 非 TTY 一律拒绝，避免管道/CI 里出现半截全屏画面。
import React from "react";
import { render } from "ink";
import { pathToFileURL } from "node:url";
import { App } from "./app.mjs";
import { HostClient } from "./host-client.mjs";
import { resolveHostPath } from "./host-path.mjs";

const VERSION = typeof __SACODE_VERSION__ === "undefined" ? "dev" : __SACODE_VERSION__;

export async function main({ cwd = process.cwd(), env = process.env, version = VERSION } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("sacode: TUI 需要交互终端（stdin 与 stdout 都必须是 TTY）。\n");
    return 64;
  }

  let hostPath;
  try {
    hostPath = resolveHostPath({ env });
  } catch (failure) {
    process.stderr.write(`sacode: ${failure.message}\n`);
    return 69;
  }

  const client = new HostClient(hostPath, { cwd, env });
  try {
    await client.start();
  } catch (failure) {
    process.stderr.write(`sacode: 无法启动宿主 ${hostPath}：${failure.message}\n`);
    return 69;
  }

  const instance = render(React.createElement(App, { client, hostPath, version }), {
    exitOnCtrlC: false,
    patchConsole: false,
  });

  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    try {
      await client.stop();
    } finally {
      process.exit(code);
    }
  };
  const onSignal = () => {
    void stop(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("exit", () => client.killNow());

  try {
    await instance.waitUntilExit();
  } catch (failure) {
    process.stderr.write(`sacode: TUI 运行失败：${failure?.message || failure}\n`);
    await stop(1);
    return 1;
  }

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  await client.stop();
  return 0;
}

// 允许直接 `node src/index.mjs` 做开发调试；被打进 bin/cli.js 时由调用方 import。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((failure) => {
      process.stderr.write(`sacode: ${failure?.stack || failure}\n`);
      process.exit(1);
    });
}
