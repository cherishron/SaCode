// SDK 可把动态库放在同名目录内；只收集真实库文件，目录不能作为载荷复制。
import { copyFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export function copyRuntimeLibraries(source, destination, { platform, exclude = () => false }) {
  let count = 0;
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const input = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(input);
        continue;
      }
      // 文件软链接（含版本别名）解引用后复制；不遍历目录软链接，避免循环及逃出 SDK。
      const file = entry.isFile() || (entry.isSymbolicLink() && statSync(input).isFile());
      const library = platform === 'win32' ? entry.name.endsWith('.dll') : /\.so(?:\.|$)|\.dylib$/.test(entry.name);
      if (!file || !library || exclude(entry.name)) continue;
      // 使用解析后的真实文件路径；只复制内容，避免目录/软链接被 cpSync 当成树。
      copyFileSync(realpathSync(input), join(destination, entry.name));
      count++;
    }
  };
  visit(source);
  return count;
}
