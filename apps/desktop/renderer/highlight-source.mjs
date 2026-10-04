// 冻结 DSH 639ed015 的语言映射与 CSS 变量主题；只在构建期折叠。
// file:// 下不加载模块、不使用 WASM，不输出 HTML。MIT 见 assets/dsh-ui-LICENSE.txt。
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core';
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript';
import lang0 from 'shiki/langs/typescript.mjs';
import lang1 from 'shiki/langs/shellscript.mjs';
import lang2 from 'shiki/langs/json.mjs';
import lang3 from 'shiki/langs/python.mjs';
import lang4 from 'shiki/langs/ruby.mjs';
import lang5 from 'shiki/langs/go.mjs';
import lang6 from 'shiki/langs/rust.mjs';
import lang7 from 'shiki/langs/java.mjs';
import lang8 from 'shiki/langs/c.mjs';
import lang9 from 'shiki/langs/cpp.mjs';
import lang10 from 'shiki/langs/csharp.mjs';
import lang11 from 'shiki/langs/kotlin.mjs';
import lang12 from 'shiki/langs/swift.mjs';
import lang13 from 'shiki/langs/php.mjs';
import lang14 from 'shiki/langs/yaml.mjs';
import lang15 from 'shiki/langs/toml.mjs';
import lang16 from 'shiki/langs/ini.mjs';
import lang17 from 'shiki/langs/markdown.mjs';
import lang18 from 'shiki/langs/mdx.mjs';
import lang19 from 'shiki/langs/html.mjs';
import lang20 from 'shiki/langs/css.mjs';
import lang21 from 'shiki/langs/scss.mjs';
import lang22 from 'shiki/langs/less.mjs';
import lang23 from 'shiki/langs/sql.mjs';
import lang24 from 'shiki/langs/xml.mjs';
import lang25 from 'shiki/langs/lua.mjs';
import lang26 from 'shiki/langs/bat.mjs';
import lang27 from 'shiki/langs/powershell.mjs';
import lang28 from 'shiki/langs/fish.mjs';
import lang29 from 'shiki/langs/dotenv.mjs';
import lang30 from 'shiki/langs/log.mjs';
import lang31 from 'shiki/langs/csv.mjs';
import lang32 from 'shiki/langs/diff.mjs';
import lang33 from 'shiki/langs/http.mjs';
import lang34 from 'shiki/langs/rst.mjs';
import lang35 from 'shiki/langs/latex.mjs';
import lang36 from 'shiki/langs/bibtex.mjs';
import lang37 from 'shiki/langs/asciidoc.mjs';
import lang38 from 'shiki/langs/r.mjs';
import lang39 from 'shiki/langs/julia.mjs';
import lang40 from 'shiki/langs/dart.mjs';
import lang41 from 'shiki/langs/scala.mjs';
import lang42 from 'shiki/langs/clojure.mjs';
import lang43 from 'shiki/langs/erlang.mjs';
import lang44 from 'shiki/langs/elixir.mjs';
import lang45 from 'shiki/langs/haskell.mjs';
import lang46 from 'shiki/langs/fsharp.mjs';
import lang47 from 'shiki/langs/vb.mjs';
import lang48 from 'shiki/langs/perl.mjs';
import lang49 from 'shiki/langs/verilog.mjs';
import lang50 from 'shiki/langs/system-verilog.mjs';
import lang51 from 'shiki/langs/graphql.mjs';
import lang52 from 'shiki/langs/proto.mjs';
import lang53 from 'shiki/langs/hcl.mjs';
import lang54 from 'shiki/langs/nix.mjs';
import lang55 from 'shiki/langs/vue.mjs';
import lang56 from 'shiki/langs/svelte.mjs';
import lang57 from 'shiki/langs/make.mjs';
import lang58 from 'shiki/langs/cmake.mjs';
import lang59 from 'shiki/langs/groovy.mjs';
const aliases=new Map([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['jsx', 'typescript'],
  ['shellscript', 'shellscript'],
  ['bash', 'shellscript'],
  ['sh', 'shellscript'],
  ['shell', 'shellscript'],
  ['zsh', 'shellscript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['py', 'python'],
  ['python', 'python'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['csharp', 'csharp'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['php', 'php'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['ini', 'ini'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdx', 'mdx'],
  ['html', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['lua', 'lua'],
  ['bat', 'bat'],
  ['batch', 'bat'],
  ['powershell', 'powershell'],
  ['ps1', 'powershell'],
  ['ps', 'powershell'],
  ['fish', 'fish'],
  ['properties', 'ini'],
  ['dotenv', 'dotenv'],
  ['env', 'dotenv'],
  ['log', 'log'],
  ['csv', 'csv'],
  ['diff', 'diff'],
  ['patch', 'diff'],
  ['http', 'http'],
  ['rst', 'rst'],
  ['latex', 'latex'],
  ['tex', 'latex'],
  ['bibtex', 'bibtex'],
  ['bib', 'bibtex'],
  ['asciidoc', 'asciidoc'],
  ['adoc', 'asciidoc'],
  ['r', 'r'],
  ['julia', 'julia'],
  ['jl', 'julia'],
  ['dart', 'dart'],
  ['scala', 'scala'],
  ['clojure', 'clojure'],
  ['clj', 'clojure'],
  ['erlang', 'erlang'],
  ['erl', 'erlang'],
  ['elixir', 'elixir'],
  ['ex', 'elixir'],
  ['exs', 'elixir'],
  ['haskell', 'haskell'],
  ['hs', 'haskell'],
  ['fsharp', 'fsharp'],
  ['fs', 'fsharp'],
  ['fsi', 'fsharp'],
  ['fsx', 'fsharp'],
  ['vb', 'vb'],
  ['vbnet', 'vb'],
  ['perl', 'perl'],
  ['pl', 'perl'],
  ['pm', 'perl'],
  ['verilog', 'verilog'],
  // Shiki's own `v` grammar is the V language; the fence label and the `.v`
  // extension both name Verilog here, so a future V registration needs a
  // different alias.
  ['v', 'verilog'],
  ['system-verilog', 'system-verilog'],
  ['systemverilog', 'system-verilog'],
  ['sv', 'system-verilog'],
  ['svh', 'system-verilog'],
  ['graphql', 'graphql'],
  ['gql', 'graphql'],
  ['proto', 'proto'],
  ['protobuf', 'proto'],
  ['hcl', 'hcl'],
  ['tf', 'hcl'],
  ['tfvars', 'hcl'],
  ['nix', 'nix'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['make', 'make'],
  ['makefile', 'make'],
  ['mk', 'make'],
  ['cmake', 'cmake'],
  ['groovy', 'groovy'],
  ['gradle', 'groovy'],
]);
const grammars=new Map([['typescript',lang0],['shellscript',lang1],['json',lang2],['python',lang3],['ruby',lang4],['go',lang5],['rust',lang6],['java',lang7],['c',lang8],['cpp',lang9],['csharp',lang10],['kotlin',lang11],['swift',lang12],['php',lang13],['yaml',lang14],['toml',lang15],['ini',lang16],['markdown',lang17],['mdx',lang18],['html',lang19],['css',lang20],['scss',lang21],['less',lang22],['sql',lang23],['xml',lang24],['lua',lang25],['bat',lang26],['powershell',lang27],['fish',lang28],['dotenv',lang29],['log',lang30],['csv',lang31],['diff',lang32],['http',lang33],['rst',lang34],['latex',lang35],['bibtex',lang36],['asciidoc',lang37],['r',lang38],['julia',lang39],['dart',lang40],['scala',lang41],['clojure',lang42],['erlang',lang43],['elixir',lang44],['haskell',lang45],['fsharp',lang46],['vb',lang47],['perl',lang48],['verilog',lang49],['system-verilog',lang50],['graphql',lang51],['proto',lang52],['hcl',lang53],['nix',lang54],['vue',lang55],['svelte',lang56],['make',lang57],['cmake',lang58],['groovy',lang59]]);
let instance;
const cache=new Map();
export function grammarForHint(hint) { return typeof hint==='string'?aliases.get(hint.toLowerCase()):undefined; }
function highlighter() {
  if(!instance) {
    instance=createHighlighterCoreSync({
      themes:[createCssVariablesTheme({name:'css-variables',variablePrefix:'--shiki-',fontStyle:true})],
      langs:[grammars.get('typescript'),grammars.get('shellscript'),grammars.get('json')],
      engine:createJavaScriptRegexEngine({forgiving:true,regexConstructor:pattern=>defaultJavaScriptRegexConstructor(pattern,{lazyCompileLength:Infinity})}),
    });
    for(const [lang,code] of [['typescript','const answer: number = 42'],['shellscript','printf "%s" "$HOME"'],['json','{"ready":true}']]) instance.codeToTokens(code,{lang,theme:'css-variables',tokenizeTimeLimit:0});
  }
  return instance;
}
export function highlight(code,hint) {
  const lang=grammarForHint(hint);
  if(!lang) return undefined;
  const key=lang+'\0'+code;
  if(cache.has(key)) return cache.get(key);
  const core=highlighter();
  if(!core.getLoadedLanguages().includes(lang)) core.loadLanguageSync(grammars.get(lang));
  const lines=core.codeToTokens(code,{lang,theme:'css-variables'}).tokens.map(line=>line.map(token=>{
    const style={color:token.color};
    const bits=token.fontStyle||0;
    if(bits&1) style.fontStyle='italic';
    if(bits&2) style.fontWeight='bold';
    const decoration=[];if(bits&4)decoration.push('underline');if(bits&8)decoration.push('line-through');
    if(decoration.length)style.textDecoration=decoration.join(' ');
    return {text:token.content,style};
  }));
  // 仅缓存有界的派生 token；大内容不占缓存，不持有会话事实。
  if(code.length<=100000){cache.set(key,lines);while(cache.size>8)cache.delete(cache.keys().next().value);}
  return lines;
}
export const supportedHints=Object.freeze([...aliases.keys()]);
export default {highlight,grammarForHint,supportedHints};
