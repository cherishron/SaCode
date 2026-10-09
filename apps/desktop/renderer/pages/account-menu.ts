import {defineComponent,h,ref,nextTick,onMounted,onBeforeUnmount} from 'vue';

const icon=(path:string)=>h('svg',{viewBox:'0 0 24 24',width:17,height:17,fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':'true'},h('path',{d:path}));
// 快捷菜单只转交既有设置动作，不维护第二份用户配置。
export const AccountMenu=defineComponent({
  props:['theme','busy','note'],emits:['settings','theme'],
  setup(props,{emit}){
    const open=ref(false),root=ref<HTMLElement|null>(null);
    const close=(focus=false)=>{open.value=false;if(focus)nextTick(()=>root.value?.querySelector<HTMLButtonElement>('.account-trigger')?.focus());};
    const outside=(e:PointerEvent)=>{if(!root.value?.contains(e.target as Node))close();};
    onMounted(()=>document.addEventListener('pointerdown',outside));
    onBeforeUnmount(()=>document.removeEventListener('pointerdown',outside));
    const settings=(id:string)=>{close(true);nextTick(()=>emit('settings',id));};
    return()=>h('div',{ref:root,class:'account-menu-root',onKeydown:(e:KeyboardEvent)=>{
      if(e.key==='Escape'&&open.value){e.stopPropagation();close(true);}
      if(open.value&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
        e.preventDefault();const buttons=[...root.value!.querySelectorAll<HTMLButtonElement>('.account-popover button:not(:disabled)')];
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;
        buttons[next]?.focus();
      }
    }},[
      h('button',{type:'button',class:'account-trigger','aria-label':'本地用户快捷设置','aria-expanded':open.value,'aria-controls':'account-quick-settings',onClick:()=>{open.value=!open.value;if(open.value)nextTick(()=>root.value?.querySelector<HTMLButtonElement>('.account-popover button')?.focus());}},[
        h('span',{class:'account-avatar','aria-hidden':'true'},icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 8 0 0 1 16 0v2')),
        h('span',{class:'account-label'},[h('strong',{},'本地用户'),h('small',{},'无需官方账号')]),
        icon('m8 10 4 4 4-4'),
      ]),
      open.value?h('section',{id:'account-quick-settings',class:'account-popover','aria-label':'用户快捷设置'},[
        h('button',{type:'button',onClick:()=>settings('profile')},[icon('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 8 0 0 1 16 0v2'),h('span',{},'个人资料')]),
        h('div',{class:'account-theme'},[h('span',{},'外观'),h('div',{},[['light','浅色','M12 3v2M12 19v2M3 12h2M19 12h2M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0'],['dark','深色','M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11'],['system','跟随系统','M3 4h18v13H3zM8 21h8M12 17v4']].map(([id,label,path])=>h('button',{type:'button','aria-label':label,'aria-pressed':props.theme===id,disabled:props.busy||!props.theme,onClick:()=>emit('theme',id)},icon(path))))]),
        props.note?h('p',{class:'note',role:'status','aria-live':'polite'},props.note):null,
        h('button',{type:'button',disabled:true,title:'尚无系统启动项宿主接口'},[icon('M12 3v9M6 6a9 9 0 1 0 12 0'),h('span',{},'开机自启'),h('small',{},'待接入')]),
        h('button',{type:'button',onClick:()=>settings('general')},[icon('M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6'),h('span',{},'设置')]),
      ]):null,
    ]);
  },
});
