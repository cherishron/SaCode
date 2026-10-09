import {defineComponent,h,ref,watch,onBeforeUnmount,type PropType} from 'vue';
import {createWorkspaceSearch,type FileEntry} from './workspace-search-state';
const icon=(d:string)=>h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':'true'},h('path',{d}));
export const WorkspaceSearch=defineComponent({
  props:{configured:Boolean,active:Boolean,directory:String,listFiles:{type:Function as PropType<(path:string)=>Promise<{files:FileEntry[]}>>,required:true}},emits:['open','choose'],
  setup(props,{emit}){
    const revision=ref(0),query=ref('');
    const search=createWorkspaceSearch(path=>props.listFiles(path),()=>revision.value++);
    watch(()=>props.active,active=>{if(!active)search.cancel();});
    watch(()=>props.directory,()=>{search.reset();query.value='';});
    onBeforeUnmount(()=>search.dispose());
    return()=>{void revision.value;const s=search.state;return h('section',{class:'workspace-search','aria-label':'工作区文件搜索'},[
      h('h2',{},'文件搜索'),h('p',{class:'note'},'按文件名或相对路径查找；不搜索文件内容。'),
      !props.configured?h('div',{class:'empty-card'},[h('strong',{},'先选择工作区'),h('p',{class:'note'},'搜索范围限定为当前工作区。'),h('button',{type:'button',class:'btn',onClick:()=>emit('choose')},'选择工作区')]):[
        h('form',{class:'workspace-search-form',onSubmit:(e:Event)=>{e.preventDefault();if(query.value.trim()&&!s.busy)void search.search(query.value);}},[
          h('label',{class:'sr-only',for:'workspace-search-query'},'文件名或路径'),
          h('input',{id:'workspace-search-query',type:'search',value:query.value,placeholder:'例如 composer 或 src/',disabled:s.busy,onInput:(e:Event)=>query.value=(e.target as HTMLInputElement).value}),
          h('button',{type:s.busy?'button':'submit',class:'btn',disabled:!s.busy&&!query.value.trim(),onClick:()=>{if(s.busy)search.cancel();}},s.busy?'停止':'搜索'),
        ]),
        h('p',{class:'note',role:'status','aria-live':'polite'},s.status==='idle'?'输入关键字开始查找。':s.status==='searching'?`正在查找 · 已扫描 ${s.directories} 个目录`:(s.status==='cancelled'?'已停止 · ':s.status==='partial'?'部分目录读取失败 · ':s.status==='limited'?'已达到扫描上限 · ':'')+`找到 ${s.results.length} 个文件`),
        h('div',{class:'workspace-search-results'},s.results.map(result=>h('button',{type:'button',class:'workspace-search-result',key:result.path,title:result.path,onClick:()=>emit('open',result.path)},[icon('M6 3h8l4 4v14H6zM14 3v5h4'),h('span',{},result.path)]))),
        s.errors.length?h('details',{class:'workspace-search-errors'},[h('summary',{},`${s.errors.length} 个读取错误`),...s.errors.map(error=>h('p',{class:'note',role:'alert'},error))]):null,
        h('p',{class:'note workspace-search-limits'},'最多扫描 128 个目录、4096 个条目、6 层目录，显示 200 条结果。跳过 .git、node_modules、target 和 dist；停止后保留已找到的结果。'),
      ],
    ]);};
  },
});
