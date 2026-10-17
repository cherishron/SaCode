// esbuild 输出依赖区分模块表达式与 TextMate 规则中的 import(?=...) 文本。
export function assertStaticRendererBundle(code,metafile) {
  if(/new Function\(|\beval\(/.test(code))throw new Error('渲染产物含运行时求值');
  if(!metafile?.outputs || !Object.keys(metafile.outputs).length)throw new Error('缺少渲染产物依赖证据');
  const imports=Object.values(metafile.outputs).flatMap(output=>output.imports);
  if(imports.some(item=>item.kind==='dynamic-import' || item.external))throw new Error('渲染产物残留运行时模块加载');
}
