import {defineComponent,h,ref,nextTick,onMounted,onBeforeUnmount} from 'vue';

export const PermissionMenu=defineComponent({setup(){
  const open=ref(false),root=ref<HTMLElement|null>(null),current=ref('build');
  const modes=[['plan','规划与只读分析'],['build','在工作区内实施'],['auto','自动审查授权请求'],['yolo','自动执行模式']];
  const cycle=()=>{const i=modes.findIndex(m=>m[0]===current.value);current.value=modes[(i+1)%4][0];window.sacode.approvalSetMode(current.value);};
  const outside=(e:PointerEvent)=>{if(!root.value?.contains(e.target as Node))open.value=false;};
  onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',e=>{if(e.key==='Tab'&&e.shiftKey&&open.value){e.preventDefault();cycle();}});window.sacode.approvalGetMode().then(m=>{if(m)current.value=m;});});
  onBeforeUnmount(()=>document.removeEventListener('pointerdown',outside));
  return()=>h('div',{ref:root,class:'permission-menu-root',onKeydown:(e:KeyboardEvent)=>{if(e.key==='Escape'&&open.value){e.stopPropagation();open.value=false;nextTick(()=>root.value?.querySelector<HTMLButtonElement>('.permission-trigger')?.focus());}}},[
    h('button',{class:'permission-trigger',type:'button','aria-label':'权限模式，当前'+current.value,'aria-expanded':open.value,'aria-controls':'permission-options',onClick:()=>{open.value=!open.value;if(open.value)nextTick(()=>root.value?.querySelector<HTMLElement>('.permission-popover')?.focus());}},[
      h('span',{},'工具审批'),h('svg',{width:12,height:12,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':'true'},h('path',{d:'m6 9 6 6 6-6'})),
    ]),
    open.value?h('section',{id:'permission-options',class:'permission-popover',tabindex:-1,'aria-label':'权限模式'},[
      h('strong',{},'权限模式'),h('p',{class:'note'},'当前：'+current.value),
      ...modes.map(([name,detail])=>h('button',{type:'button',class:current.value===name?'active':'',onClick:()=>{current.value=name;window.sacode.approvalSetMode(name);open.value=false;}},[h('span',{},[h('strong',{},name),h('small',{},detail)])])),
    ]):null,
  ]);
}});

