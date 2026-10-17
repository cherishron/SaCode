// 项目选择只提供原生打开文件夹和核心回放的最近目录；没有路径输入框和默认项目。
import {defineComponent,h,ref,watch,nextTick,onMounted,onBeforeUnmount,type PropType} from 'vue';
interface RecentProject {id:string;directory:string;available:boolean}
interface Workspace {directory:string;configured:boolean;available:boolean}
export const ProjectPicker=defineComponent({
  name:'SaCodeProjectPicker',
  props:{open:Boolean,busy:Boolean,loading:Boolean,note:String,workspace:Object as PropType<Workspace|null>,recent:Array as PropType<RecentProject[]>},
  emits:['close','browse','select'],
  setup(props,{emit}){
    const panel=ref<HTMLDivElement|null>(null);
    let anchor:HTMLElement|null=null,disposed=false;
    const place=()=>{if(!props.open||!panel.value||!anchor)return;const a=anchor.getBoundingClientRect(),p=panel.value.getBoundingClientRect();
      const below=innerHeight-a.bottom-12,above=a.top-12,up=below<p.height&&above>below;
      panel.value.style.maxHeight=Math.max(120,Math.min(innerHeight-24,up?above:below))+'px';
      panel.value.style.left=Math.max(12,Math.min(a.left,innerWidth-p.width-12))+'px';
      panel.value.style.top=Math.max(12,Math.min(up?a.top-Math.min(p.height,above)-6:a.bottom+6,innerHeight-p.height-12))+'px';};
    const close=()=>{emit('close');void nextTick(()=>anchor?.focus({preventScroll:true}));};
    const outside=(event:PointerEvent)=>{if(props.open&&event.target instanceof Node&&!panel.value?.contains(event.target)&&!anchor?.contains(event.target)&&!props.busy)emit('close');};
    const key=(event:KeyboardEvent)=>{if(!props.open)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!props.busy)close();return;}
      if(!['ArrowDown','ArrowUp'].includes(event.key))return;const rows=[...panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]];if(!rows.length)return;
      event.preventDefault();const i=rows.indexOf(document.activeElement as HTMLButtonElement);rows[(i+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length].focus();};
    watch(()=>props.open,async open=>{if(open)anchor=document.activeElement as HTMLElement;await nextTick();if(disposed||!panel.value)return;
      if(open){if(!panel.value.matches(':popover-open'))panel.value.showPopover();place();panel.value.querySelector<HTMLButtonElement>('button')?.focus();}
      else if(panel.value.matches(':popover-open'))panel.value.hidePopover();},{flush:'pre'});
    watch(()=>[props.recent,props.note,props.loading],()=>void nextTick(place),{flush:'post'});
    onMounted(()=>{document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);window.addEventListener('resize',place);});
    onBeforeUnmount(()=>{disposed=true;document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',place);if(panel.value?.matches(':popover-open'))panel.value.hidePopover();});
    const name=(path:string)=>path.split(/[\\/]/).filter(Boolean).at(-1)||path;
    return()=>h('div',{ref:panel,id:'project-picker',class:'project-picker',popover:'manual',role:'dialog','aria-label':'选择项目文件夹','aria-busy':props.busy},[
      h('button',{type:'button',id:'choose-workspace',class:'project-picker-browse',disabled:props.busy,onClick:()=>emit('browse')},'打开文件夹…'),
      props.workspace?.configured?h('div',{},[h('p',{class:'project-picker-current',id:'workspace-directory'},'当前：'+props.workspace.directory),
        !props.workspace.available?h('p',{class:'note',id:'workspace-description'},'该项目目录不可用，请恢复该目录或重新打开文件夹。'):null]):h('p',{class:'note',id:'workspace-description'},'尚未选择项目。应用的数据目录不是你的项目目录。'),
      h('h3',{class:'project-picker-heading'},'最近项目'),
      props.loading?h('p',{class:'note',role:'status'},'正在读取最近项目…'):null,
      ...(props.recent||[]).map(item=>h('button',{type:'button',class:'project-picker-recent','data-recent-workspace':item.id,
        disabled:props.busy||!item.available,title:item.directory,onClick:()=>emit('select',item.id)},[
          h('span',{class:'project-picker-name'},name(item.directory)),
          h('span',{class:'project-picker-path'},item.directory),
          !item.available?h('span',{class:'note'},'目录不可用'):null,
        ])),
      !props.loading&&!props.recent?.length?h('p',{class:'note'},'暂无最近项目，请直接打开文件夹。'):null,
      props.note?h('p',{id:'workspace-note',class:'note',role:'status','aria-live':'polite'},props.note):null,
    ]);
  },
});
