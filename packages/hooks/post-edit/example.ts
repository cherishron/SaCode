/**
 * 示例钩子：文件编辑日志
 *
 * 在文件编辑后记录日志
 */

import type { HookContext, HookResult } from "@sacode/core";

export default async function logFileEdit(
  context: HookContext
): Promise<HookResult> {
  const { filePath, content } = context.data as {
    filePath: string;
    content: string;
  };

  console.log(`[HOOK] File edited: ${filePath}`);
  console.log(`[HOOK] Content length: ${content.length} characters`);

  return { proceed: true };
}
