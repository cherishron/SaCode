import {defineComponent,h,ref,watch,nextTick,onMounted,onBeforeUnmount} from 'vue';
type Resource={id:string;label:string;icon:string;available:boolean};
export const resources:Resource[]=[
  {id:'files',label:'文件结构',icon:'M3 5h7l2 3h9v12H3z',available:true},
  {id:'search',label:'文件搜索',icon:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',available:true},
  {id:'preview',label:'文件预览',icon:'M6 3h8l4 4v14H6zM14 3v5h4',available:true},
  {id:'editor',label:'代码编辑',icon:'M4 20h4L20 8l-4-4L4 16zM13 7l4 4',available:true},
  {id:'diff',label:'保存前差异',icon:'M8 3v18M4 8h8M16 3v18M12 16h8',available:true},
  {id:'git',label:'Git 变更',icon:'M6 3v12a4 4 0 0 0 4 4h7M6 3a2 2 0 1 0 0 4M17 17a2 2 0 1 0 0 4M17 5v8M15 7l2-2 2 2',available:true},
  {id:'inspect',label:'工具与审批',icon:'M8 3h8v5h5v8h-5v5H8v-5H3V8h5z',available:true},
  {id:'trace',label:'会话轨迹',icon:'M5 5h14M5 12h14M5 19h14',available:true},
  {id:'guide',label:'使用指南',icon:'M3 4h8l1 2 1-2h8v16h-8l-1 1-1-1H3zM12 6v15',available:true},
  {id:'terminal',label:'终端',icon:'M4 5l6 7-6 7M13 19h7',available:true},
  {id:'agents',label:'智能体团队',icon:'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',available:true},
  {id:'tests',label:'构建测试',icon:'M9 3h6M10 3v7l-6 9h16l-6-9V3M8 15h8',available:false},
  {id:'scan',label:'安全扫描',icon:'M12 3l8 4v6c0 5-8 8-8 8s-8-3-8-8V7zM8 12l3 3 5-6',available:false},
  {id:'deploy',label:'部署',icon:'M12 16V3M7 8l5-5 5 5M4 14v7h16v-7',available:false},
  {id:'memory',label:'记忆',icon:'M5 4h14v16l-7-4-7 4z',available:false},
  {id:'services',label:'技能与 MCP',icon:'M8 3v5M16 3v5M6 8h12v5a6 6 0 0 1-12 0zM12 19v3',available:false},
  {id:'sources',label:'来源',icon:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',available:false},
  {id:'artifacts',label:'产物',icon:'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',available:false},
];
const glyph=(path:string)=>h('svg',{width:15,height:15,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':'true'},[h('path',{d:path})]);
export const WorkbenchTabs=defineComponent({
  name:'SaCodeWorkbenchTabs',props:{active:String,pendingApproval:Boolean,expanded:Boolean,split:Boolean},emits:['select','close','expand','split','closePanel'],
  setup(props,{emit}){
    const ids=ref(['files','diff']),picker=ref(false),query=ref(''),dragging=ref(''),root=ref<HTMLElement|null>(null);
    let disposed=false;
    const focus=(selector:string)=>nextTick(()=>{if(disposed)return;const button=root.value?.querySelector<HTMLButtonElement>(selector);(button?.closest('.workbench-tab')||button)?.scrollIntoView?.({block:'nearest',inline:'nearest'});button?.focus();});
    const outside=(event:PointerEvent)=>{if(picker.value&&!root.value?.contains(event.target as Node))picker.value=false;};
    onMounted(()=>document.addEventListener('pointerdown',outside));
    onBeforeUnmount(()=>{disposed=true;document.removeEventListener('pointerdown',outside);});
    const available=(id:string)=>resources.find(r=>r.id===id)?.available;
    watch(()=>props.active,id=>{if(!id||!available(id))return;if(!ids.value.includes(id))ids.value=[...ids.value,id];nextTick(()=>{if(disposed)return;root.value?.querySelector('#side-tab-'+id)?.closest('.workbench-tab')?.scrollIntoView?.({block:'nearest',inline:'nearest'});});},{immediate:true});
    const choose=(id:string)=>{if(!available(id))return;if(!ids.value.includes(id))ids.value=[...ids.value,id];emit('select',id);picker.value=false;focus('#side-tab-'+id);};
    const close=(id:string)=>{const index=ids.value.indexOf(id);ids.value=ids.value.filter(v=>v!==id);emit('close',id);const next=props.active===id?(ids.value[Math.min(index,ids.value.length-1)]||''):props.active;if(props.active===id)emit('select',next);focus(next?'#side-tab-'+next:'#add-resource');};
    const reorder=(from:string,to:string)=>{const a=ids.value.indexOf(from),b=ids.value.indexOf(to);if(a<0||b<0||a===b)return;const next=[...ids.value];next.splice(a,1);next.splice(b,0,from);ids.value=next;};
    return()=>h('div',{ref:root,class:'workbench-tab-shell',onKeydown:(event:KeyboardEvent)=>{if(event.key==='Escape'&&picker.value){event.stopPropagation();picker.value=false;focus('#add-resource');}}},[
      h('header',{class:'side-toolbar'},[h('strong',{},'工作台'),h('div',{class:'workbench-header-actions'},[
        h('button',{id:'add-resource',type:'button',class:'frame-icon','aria-label':'添加资源标签','aria-expanded':picker.value,onClick:()=>{picker.value=!picker.value;query.value='';if(picker.value)nextTick(()=>{if(!disposed&&picker.value)root.value?.querySelector<HTMLInputElement>('.workbench-resource-search')?.focus();});}},glyph('M12 5v14M5 12h14')),
        h('button',{id:'expand-workbench',type:'button',class:'frame-icon','aria-label':props.expanded?'缩小工作台':'全屏工作台',onClick:()=>emit('expand')},glyph(props.expanded?'M9 3v6H3M15 21v-6h6M3 9l6-6M21 15l-6 6':'M9 3H3v6M15 21h6v-6M3 3l6 6M21 21l-6-6')),
        h('button',{id:'split-side',type:'button',class:'frame-icon','aria-label':props.split?'合并窗格':'上下拆分','aria-pressed':props.split,onClick:()=>emit('split')},glyph('M4 4h16v16H4zM4 12h16')),
        h('button',{id:'close-side',type:'button',class:'frame-icon','aria-label':'关闭侧栏',onClick:()=>{picker.value=false;emit('closePanel');}},glyph('M6 6l12 12M18 6L6 18')),
      ])]),
      h('div',{class:'side-tabs',role:'tablist','aria-label':'工作台资源'},ids.value.map((id,index)=>{
        const item=resources.find(r=>r.id===id)!;
        return h('div',{class:'workbench-tab',key:id,draggable:true,onDragstart:(e:DragEvent)=>{dragging.value=id;e.dataTransfer?.setData('text/plain',id);},onDragend:()=>dragging.value='',onDragover:(e:DragEvent)=>{if(dragging.value)e.preventDefault();},onDrop:(e:DragEvent)=>{e.preventDefault();reorder(dragging.value,id);dragging.value='';}},[
          h('button',{type:'button',class:'side-tab',id:'side-tab-'+id,role:'tab','aria-selected':props.active===id,'aria-controls':'side-page-'+id,tabindex:props.active===id?0:-1,onClick:()=>choose(id),onKeydown:(e:KeyboardEvent)=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
            const next=e.key==='Home'?0:e.key==='End'?ids.value.length-1:(index+(e.key==='ArrowLeft'?-1:1)+ids.value.length)%ids.value.length;
            if(e.altKey&&e.shiftKey)reorder(id,ids.value[next]);else choose(ids.value[next]);
          }},[glyph(item.icon),h('span',{},item.label),id==='inspect'&&props.pendingApproval?h('span',{class:'pending-dot','aria-label':'待审批'}):null]),
          h('button',{type:'button',class:'workbench-tab-close','aria-label':'关闭'+item.label,onClick:()=>close(id)},glyph('M6 6l12 12M18 6L6 18')),
        ]);
      })),
      picker.value?h('section',{class:'workbench-resource-picker','aria-label':'添加资源标签',onKeydown:(event:KeyboardEvent)=>{
        if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
        if((event.key==='Home'||event.key==='End')&&(event.target as HTMLElement).tagName==='INPUT')return;
        const buttons=Array.from(root.value?.querySelectorAll<HTMLButtonElement>('.workbench-resource-list button:not(:disabled)')||[]);
        if(!buttons.length)return;event.preventDefault();const index=buttons.indexOf(event.target as HTMLButtonElement);
        const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:index<0?(event.key==='ArrowUp'?buttons.length-1:0):(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;
        buttons[next].focus();
      }},[
        h('input',{type:'search',class:'workbench-resource-search',placeholder:'搜索资源类型','aria-label':'搜索资源类型',value:query.value,onInput:(e:Event)=>query.value=(e.target as HTMLInputElement).value}),
        h('div',{class:'workbench-resource-list'},resources.filter(r=>(r.label+' '+r.id).toLowerCase().includes(query.value.toLowerCase())).map(item=>h('button',{type:'button',disabled:!item.available,title:!item.available?'该资源的真实宿主入口尚未接入':undefined,onClick:()=>choose(item.id)},[glyph(item.icon),h('span',{},item.label),h('small',{},item.available?(ids.value.includes(item.id)?'已打开':''):'待接入')]))),
        !resources.some(r=>(r.label+' '+r.id).toLowerCase().includes(query.value.toLowerCase()))?h('p',{},'没有匹配的资源'):null,
      ]):null,
    ]);
  },
});
