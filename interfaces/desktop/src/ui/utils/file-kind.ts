/** 文件树排序、后缀分类与预览语言映射（纯函数，便于测试）。 */

export type TreeEntryLike = {
  name: string;
  isDir: boolean;
};

/** 文件夹优先，再按名称（不区分大小写）。 */
export function sortTreeEntries<T extends TreeEntryLike>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' });
  });
}

export type FileKind =
  | 'folder'
  | 'markdown'
  | 'code'
  | 'style'
  | 'data'
  | 'config'
  | 'image'
  | 'doc'
  | 'binary'
  | 'text';

const EXT_KIND: Record<string, FileKind> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  rs: 'code',
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  mts: 'code',
  cts: 'code',
  py: 'code',
  go: 'code',
  java: 'code',
  kt: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  cc: 'code',
  hpp: 'code',
  cs: 'code',
  php: 'code',
  rb: 'code',
  swift: 'code',
  scala: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  ps1: 'code',
  sql: 'code',
  html: 'code',
  htm: 'code',
  xml: 'code',
  vue: 'code',
  svelte: 'code',
  css: 'style',
  scss: 'style',
  less: 'style',
  json: 'data',
  jsonc: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'config',
  ini: 'config',
  cfg: 'config',
  conf: 'config',
  env: 'config',
  lock: 'config',
  gitignore: 'config',
  dockerfile: 'config',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  ico: 'image',
  bmp: 'image',
  pdf: 'doc',
  doc: 'doc',
  docx: 'doc',
  txt: 'text',
  log: 'text',
  csv: 'text',
};

export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const lower = base.toLowerCase();
  if (lower === 'dockerfile' || lower === 'makefile' || lower === 'license') return lower;
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? lower.slice(dot + 1) : '';
}

export function fileKind(name: string, isDir = false): FileKind {
  if (isDir) return 'folder';
  const ext = fileExtension(name);
  return EXT_KIND[ext] ?? 'text';
}

/** 预览模式：markdown / code / text */
export function previewMode(name: string): 'markdown' | 'code' | 'text' {
  const kind = fileKind(name);
  if (kind === 'markdown') return 'markdown';
  if (kind === 'image' || kind === 'binary' || kind === 'doc') return 'text';
  return 'code';
}

/** highlight.js 语言 id（未知则 null，按纯文本展示） */
export function highlightLanguage(name: string): string | null {
  const ext = fileExtension(name);
  switch (ext) {
    case 'rs':
      return 'rust';
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'less':
      return 'less';
    case 'html':
    case 'htm':
    case 'xml':
    case 'vue':
    case 'svelte':
      return 'xml';
    case 'md':
    case 'markdown':
    case 'mdx':
      return 'markdown';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    case 'kt':
      return 'kotlin';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'hpp':
      return 'cpp';
    case 'cs':
      return 'csharp';
    case 'php':
      return 'php';
    case 'rb':
      return 'ruby';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'bash';
    case 'ps1':
      return 'powershell';
    case 'sql':
      return 'sql';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'toml':
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'env':
      return 'ini';
    case 'dockerfile':
      return 'dockerfile';
    default:
      return null;
  }
}

/** 图标着色 token：folder / 各类扩展 */
export function iconTone(name: string, isDir = false): string {
  if (isDir) return 'folder';
  const ext = fileExtension(name);
  switch (ext) {
    case 'rs':
      return 'rust';
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
    case 'xml':
      return 'html';
    case 'md':
    case 'markdown':
    case 'mdx':
      return 'markdown';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'java':
    case 'kt':
      return 'java';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'toml':
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'env':
    case 'lock':
      return 'config';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'ico':
    case 'bmp':
      return 'image';
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
      return 'shell';
    default:
      return 'text';
  }
}
