import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const localRequire=createRequire(import.meta.url);

// 在内存中编译真实页面及本地依赖；Vue仅从桌面依赖目录取一份。
// 不删import、不用data URL解析相对模块，也不向源码外临时目录遗留裸vue导入。
export function loadPageModule(entry,{vue,globals}={}){
  const code=buildSync({entryPoints:[fileURLToPath(entry)],bundle:true,write:false,format:'cjs',external:['vue'],platform:'node',target:'node22',logLevel:'silent'}).outputFiles[0].text;
  const module={exports:{}};
  // globals 用于补齐渲染层依赖的宿主全局（如 index.html 在页面之前加载的 SaCodeDialog）。
  const context={module,exports:module.exports,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,structuredClone,crypto:globalThis.crypto,performance,
    require:name=>{if(name!=='vue')throw Error('页面测试未声明外部依赖：'+name);return vue??localRequire('vue');},...globals};
  vm.runInNewContext(code,context,{filename:fileURLToPath(entry)});
  return module.exports;
}
