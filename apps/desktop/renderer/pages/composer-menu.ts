import {defineComponent,h,ref,nextTick,onMounted,onBeforeUnmount,watch,type PropType} from 'vue';
import {getCommands} from './composer-commands';
type Entry={name:string;isDir:boolean;size?:number};
const icon=(d:string)=>h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},[h('path',{d})]);
let sequence=0;
// 斜杠命令卡片图标：与命令语义一对一，放在组件外避免每次渲染重建。
const COMMAND_ICONS:Record<string,string>={
  help:'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.4-.9 1-.9 1.7M12 17h.01',
  review:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M16 16l5 5M8 11l2.5 2.5L16 8',
  compress:'M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5',
  init:'M13 2 3 14h7l-1 8 10-12h-7z',
  clear:'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
};
export const AddButton=defineComponent({
  name:'SaCodeComposerMenu',
  props:{disabled:Boolean,goalAvailable:Boolean,planAvailable:Boolean,workspaceConfigured:Boolean,listFiles:Function as PropType<(path:string)=>Promise<{files:Entry[]}>>,listTools:Function as PropType<()=>Promise<{tools?:{name:string;description:string;needsApproval:boolean}[]}>>,slashTrigger:Number},
  emits:['add','goal','plan','reference','extensions','command'],
  setup(props,{emit}){
    const id='composer-menu-'+(++sequence),root=ref<HTMLElement|null>(null),trigger=ref<HTMLButtonElement|null>(null),input=ref<HTMLInputElement|null>(null);
    const open=ref(false),section=ref(''),query=ref(''),path=ref(''),rows=ref<Entry[]>([]),busy=ref(false),error=ref(''),position=ref({left:'0px',bottom:'0px'});
    // 技能清单：宿主 extension/list 的真实注册表（toolsList 通道已在 IPC 面内，不新增通道）。
    const tools=ref<{name:string;description:string;needsApproval:boolean}[]|null>(null);
    let serial=0,disposed=false;
    const close=(focus=false)=>{open.value=false;section.value='';++serial;busy.value=false;if(focus)trigger.value?.focus();};
    const place=()=>{const r=trigger.value?.getBoundingClientRect();if(!r)return;const width=Math.min(section.value?480:328,innerWidth-24);position.value={left:Math.max(12,Math.min(r.left,innerWidth-width-12))+'px',bottom:Math.max(12,innerHeight-r.top+8)+'px'};};
    const show=async()=>{if(props.disabled)return;if(open.value){close();return;}open.value=true;place();await nextTick();root.value?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();};
    watch(()=>props.slashTrigger,()=>{if(props.slashTrigger&&props.slashTrigger>0){section.value='commands';if(!open.value)void show();}});
    async function load(directory:string){
      const ticket=++serial;path.value=directory;rows.value=[];query.value='';error.value='';busy.value=true;
      try{if(!props.listFiles)throw Error('目录读取接口未接入');const result=await props.listFiles(directory);if(!disposed&&open.value&&ticket===serial)rows.value=result.files||[];}
      catch(e){if(!disposed&&open.value&&ticket===serial)error.value=String((e as Error).message||e);}
      finally{if(!disposed&&ticket===serial)busy.value=false;}
    }
    const enter=(name:string)=>{section.value=name;place();if(name==='files')void load('');if(name==='skills')void loadTools();nextTick(()=>root.value?.querySelector<HTMLInputElement>('.composer-menu-search')?.focus());};
    async function loadTools(){
      const ticket=++serial;tools.value=null;query.value='';error.value='';busy.value=true;
      try{
        if(!props.listTools)throw Error('工具清单接口未接入');
        const result=await props.listTools();
        if(!disposed&&open.value&&ticket===serial)tools.value=Array.isArray(result?.tools)?result.tools:[];
      }catch(e){if(!disposed&&open.value&&ticket===serial){tools.value=[];error.value=String((e as Error).message||e);}}
      finally{if(!disposed&&ticket===serial)busy.value=false;}
    }
    const outside=(e:PointerEvent)=>{if(open.value&&!root.value?.contains(e.target as Node))close();};
    const resize=()=>{if(open.value)close(true);};
    onMounted(()=>{document.addEventListener('pointerdown',outside);window.addEventListener('resize',resize);});
    onBeforeUnmount(()=>{disposed=true;++serial;document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resize);});
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&open.value){event.preventDefault();event.stopPropagation();close(true);return;}
      if(!open.value||!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||(event.target as HTMLElement).tagName==='INPUT')return;
      const buttons=Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')||[]);if(!buttons.length)return;
      const current=buttons.indexOf(document.activeElement as HTMLButtonElement),offset=event.key==='ArrowUp'?-1:1;
      const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+offset+buttons.length)%buttons.length;
      event.preventDefault();buttons[index].focus();
    };
    const item=(label:string,d:string,action:()=>void,disabled=false,detail='')=>h('button',{type:'button',role:'menuitem',class:'composer-menu-item',disabled,title:detail||undefined,onClick:action},[icon(d),h('span',{},label),detail?h('small',{},detail):null]);
    // 卡片式入口：图标瓷片 + 标题 + 说明，点击即用——选择型交互不该让用户把选项再手打一遍。
    const card=(label:string,d:string,action:()=>void,detail='',disabled=false)=>h('button',{type:'button',role:'menuitem',class:'composer-menu-card',disabled,title:detail||undefined,onClick:action},[h('span',{class:'composer-card-icon','aria-hidden':'true'},icon(d)),h('span',{class:'composer-card-text'},[h('strong',{},label),detail?h('small',{},detail):null])]);
    return()=>h('div',{class:'attachments-picker composer-menu-root',ref:root,onKeydown:key},[
      h('button',{ref:trigger,type:'button',class:'attachments-add','aria-label':'添加内容','aria-haspopup':'menu','aria-expanded':open.value,'aria-controls':id,disabled:props.disabled,onClick:()=>void show()},icon('M12 5v14M5 12h14')),
      h('input',{ref:input,type:'file',multiple:true,hidden:true,disabled:props.disabled,'aria-label':'选择附件',onChange:(e:Event)=>{const node=e.target as HTMLInputElement;if(!props.disabled&&node.files?.length)emit('add',Array.from(node.files),new Set<File>());node.value='';}}),
      open.value?h('div',{id,class:'composer-menu-popover',style:position.value},[
        h('div',{class:'composer-menu-primary',role:'menu','aria-label':'添加内容'},[
          card('上传附件','M12 16V3M7 8l5-5 5 5M4 15v6h16v-6',()=>{close();input.value?.click();},'选择本地文件'),
          card('工作区文件','M3 5h7l2 3h9v12H3z',()=>enter('files'),props.workspaceConfigured?'插入路径引用':'未配置工作区',!props.workspaceConfigured),
          card('技能','M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z',()=>enter('skills'),'可引用的技能'),
          card('MCP','M8 3v5H3v8h5v5h8v-5h5V8h-5V3z',()=>enter('mcp'),'外部工具服务'),
          card('设置目标','M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',()=>{close();emit('goal');},props.goalAvailable?'跨轮持续目标':'需先进入会话',!props.goalAvailable),
          card('创建计划','M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',()=>{close();emit('plan');},props.planAvailable?'进入计划模式，生成计划并审阅':'需先进入会话',!props.planAvailable),
        ]),
        section.value?h('section',{class:'composer-menu-secondary','aria-label':section.value==='files'?'工作区文件选择':section.value==='commands'?'命令列表':'扩展选择'},[
          h('header',{},section.value==='files'?'工作区文件':section.value==='commands'?'可用命令':section.value==='skills'?'技能':'MCP'),
          section.value==='files'?[
            h('input',{class:'composer-menu-search',type:'search',placeholder:'搜索当前目录','aria-label':'搜索当前目录',value:query.value,onInput:(e:Event)=>query.value=(e.target as HTMLInputElement).value}),
            h('div',{class:'composer-menu-path'},[path.value?h('button',{type:'button',onClick:()=>void load(path.value.split('/').slice(0,-1).join('/'))},'← 上级'):null,h('span',{},path.value||'工作区根目录')]),
            busy.value?h('p',{role:'status'},'读取中…'):error.value?h('div',{},[h('p',{role:'alert'},error.value),h('button',{type:'button',onClick:()=>void load(path.value)},'重试')]):
            h('div',{class:'composer-menu-files'},[
              ...rows.value.filter(e=>e.name.toLowerCase().includes(query.value.toLowerCase())).map(entry=>item(entry.name,entry.isDir?'M3 5h7l2 3h9v12H3z':'M6 3h8l4 4v14H6zM14 3v5h4',()=>{const selected=[path.value,entry.name].filter(Boolean).join('/');if(entry.isDir)void load(selected);else{close(true);emit('reference',selected);}},false,entry.isDir?'目录':'插入路径')),
              !rows.value.filter(e=>e.name.toLowerCase().includes(query.value.toLowerCase())).length?h('p',{},'暂无匹配文件'):null,
            ]),
            h('small',{class:'composer-menu-hint'},'选择后插入草稿路径，不上传文件内容。'),
          ]:section.value==='commands'?[
            ...getCommands().map(cmd=>card(cmd.label,COMMAND_ICONS[cmd.name]||'M5 12h14',()=>{emit('command',cmd.name);close(true);},cmd.help)),
          ]:section.value==='skills'?[
            h('input',{class:'composer-menu-search',type:'search',placeholder:'搜索工具','aria-label':'搜索工具',value:query.value,onInput:(e:Event)=>query.value=(e.target as HTMLInputElement).value}),
            busy.value?h('p',{role:'status'},'读取中…'):error.value?h('div',{},[h('p',{role:'alert'},error.value),h('button',{type:'button',onClick:()=>void loadTools()},'重试')]):
            h('div',{class:'composer-menu-tools'},[
              ...(tools.value||[]).filter(t=>(t.name+' '+(t.description||'')).toLowerCase().includes(query.value.toLowerCase())).map(t=>h('button',{type:'button',class:'composer-tool-row',title:t.description||undefined,onClick:()=>{close(true);emit('reference','@'+t.name);}},[
                h('span',{class:'composer-tool-icon','aria-hidden':'true'},'⌘'),
                h('span',{class:'composer-tool-body'},[h('strong',{},t.name),h('small',{},t.description||'暂无说明')]),
                t.needsApproval?h('small',{class:'composer-tool-flag'},'需审批'):null,
              ])),
              !(tools.value||[]).length?h('p',{},'当前没有可引用的内置工具。'):null,
            ]),
            h('small',{class:'composer-menu-hint'},'点击插入 @工具名；是否实际执行以核心审批为准。'),
          ]:[h('p',{},'MCP 服务在「连接」页登记；后端连接能力尚未接入。'),h('button',{type:'button',onClick:()=>{close();emit('extensions');}},'打开扩展管理')],
        ]):null,
      ]):null,
    ]);
  },
});
