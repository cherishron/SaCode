import {defineComponent,h,ref,nextTick,onMounted,onBeforeUnmount,type PropType} from 'vue';
type Entry={name:string;isDir:boolean;size?:number};
const icon=(d:string)=>h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},[h('path',{d})]);
let sequence=0;
export const AddButton=defineComponent({
  name:'SaCodeComposerMenu',
  props:{disabled:Boolean,goalAvailable:Boolean,workspaceConfigured:Boolean,listFiles:Function as PropType<(path:string)=>Promise<{files:Entry[]}>>},
  emits:['add','goal','reference','extensions'],
  setup(props,{emit}){
    const id='composer-menu-'+(++sequence),root=ref<HTMLElement|null>(null),trigger=ref<HTMLButtonElement|null>(null),input=ref<HTMLInputElement|null>(null);
    const open=ref(false),section=ref(''),query=ref(''),path=ref(''),rows=ref<Entry[]>([]),busy=ref(false),error=ref(''),position=ref({left:'0px',bottom:'0px'});
    let serial=0,disposed=false;
    const close=(focus=false)=>{open.value=false;section.value='';++serial;busy.value=false;if(focus)trigger.value?.focus();};
    const place=()=>{const r=trigger.value?.getBoundingClientRect();if(!r)return;const width=Math.min(section.value?480:216,innerWidth-24);position.value={left:Math.max(12,Math.min(r.left,innerWidth-width-12))+'px',bottom:Math.max(12,innerHeight-r.top+8)+'px'};};
    const show=async()=>{if(props.disabled)return;if(open.value){close();return;}open.value=true;place();await nextTick();root.value?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();};
    async function load(directory:string){
      const ticket=++serial;path.value=directory;rows.value=[];query.value='';error.value='';busy.value=true;
      try{if(!props.listFiles)throw Error('目录读取接口未接入');const result=await props.listFiles(directory);if(!disposed&&open.value&&ticket===serial)rows.value=result.files||[];}
      catch(e){if(!disposed&&open.value&&ticket===serial)error.value=String((e as Error).message||e);}
      finally{if(!disposed&&ticket===serial)busy.value=false;}
    }
    const enter=(name:string)=>{section.value=name;place();if(name==='files')void load('');nextTick(()=>root.value?.querySelector<HTMLInputElement>('.composer-menu-search')?.focus());};
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
    return()=>h('div',{class:'attachments-picker composer-menu-root',ref:root,onKeydown:key},[
      h('button',{ref:trigger,type:'button',class:'attachments-add','aria-label':'添加内容','aria-haspopup':'menu','aria-expanded':open.value,'aria-controls':id,disabled:props.disabled,onClick:()=>void show()},icon('M12 5v14M5 12h14')),
      h('input',{ref:input,type:'file',multiple:true,hidden:true,disabled:props.disabled,'aria-label':'选择附件',onChange:(e:Event)=>{const node=e.target as HTMLInputElement;if(!props.disabled&&node.files?.length)emit('add',Array.from(node.files),new Set<File>());node.value='';}}),
      open.value?h('div',{id,class:'composer-menu-popover',style:position.value},[
        h('div',{class:'composer-menu-primary',role:'menu','aria-label':'添加内容'},[
          item('上传附件','M12 16V3M7 8l5-5 5 5M4 15v6h16v-6',()=>{close();input.value?.click();}),
          item('工作区文件','M3 5h7l2 3h9v12H3z',()=>enter('files'),!props.workspaceConfigured,'选择路径'),
          item('技能','M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z',()=>enter('skills')),
          item('MCP','M8 3v5H3v8h5v5h8v-5h5V8h-5V3z',()=>enter('mcp')),
          item('设置目标','M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8',()=>{close();emit('goal');},!props.goalAvailable),
          item('创建计划','M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',()=>{},true,'待接入'),
        ]),
        section.value?h('section',{class:'composer-menu-secondary','aria-label':section.value==='files'?'工作区文件选择':'扩展选择'},[
          h('header',{},section.value==='files'?'工作区文件':section.value==='skills'?'技能':'MCP'),
          section.value==='files'?[
            h('input',{class:'composer-menu-search',type:'search',placeholder:'搜索当前目录','aria-label':'搜索当前目录',value:query.value,onInput:(e:Event)=>query.value=(e.target as HTMLInputElement).value}),
            h('div',{class:'composer-menu-path'},[path.value?h('button',{type:'button',onClick:()=>void load(path.value.split('/').slice(0,-1).join('/'))},'← 上级'):null,h('span',{},path.value||'工作区根目录')]),
            busy.value?h('p',{role:'status'},'读取中…'):error.value?h('div',{},[h('p',{role:'alert'},error.value),h('button',{type:'button',onClick:()=>void load(path.value)},'重试')]):
            h('div',{class:'composer-menu-files'},[
              ...rows.value.filter(e=>e.name.toLowerCase().includes(query.value.toLowerCase())).map(entry=>item(entry.name,entry.isDir?'M3 5h7l2 3h9v12H3z':'M6 3h8l4 4v14H6zM14 3v5h4',()=>{const selected=[path.value,entry.name].filter(Boolean).join('/');if(entry.isDir)void load(selected);else{close(true);emit('reference',selected);}},false,entry.isDir?'目录':'插入路径')),
              !rows.value.filter(e=>e.name.toLowerCase().includes(query.value.toLowerCase())).length?h('p',{},'暂无匹配文件'):null,
            ]),
            h('small',{class:'composer-menu-hint'},'选择后插入草稿路径，不上传文件内容。'),
          ]:[h('p',{},'当前客户端尚未接入可引用的'+(section.value==='skills'?'技能':'MCP')+'清单。'),h('button',{type:'button',onClick:()=>{close();emit('extensions');}},'打开扩展管理')],
        ]):null,
      ]):null,
    ]);
  },
});
