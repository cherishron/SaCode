import {defineComponent,h,ref,onBeforeUnmount,type PropType} from 'vue';
import {ClientScope,SlotCore,type OwnerProps} from './slot-core';

// 通用设置贡献随插件作用域注册和卸载；偏好事实与保存动作由 Host 适配层传入。
export function createGeneralSettingsAssembly() {
  const slots=new SlotCore(),scopes=new Map<string,ClientScope>();
  let disposed=false;
  function install(name:string,setup:(scope:ClientScope)=>void) {
    if(disposed)throw Error('settings-assembly-disposed');
    if(scopes.has(name))throw Error('settings-plugin-duplicate');
    const scope=new ClientScope(name,slots);scopes.set(name,scope);
    try{scope.apply(setup);}catch(e){scopes.delete(name);throw e;}
  }
  const Host=defineComponent({props:['owner'],setup:props=>()=>h('div',{class:'general-plugin-rows'},
    slots.dispatch(host.entry,'settings.general.row',props.owner).map(({entry})=>h(entry.component as any,{key:entry.sequence,owner:props.owner})))});
  const scope=new ClientScope('ui-settings-general',slots);scopes.set('ui-settings-general',scope);
  const host=scope.register({name:'root',children:{'settings.general.row':{kind:'list',scope:'root'}}},Host);
  install('ui-conversation-preferences',child=>child.inject('settings.general.row',row=>{
    row.register({name:'settings.general.row',id:'busy-send',order:80,label:'繁忙时的发送行为'},defineComponent({
      name:'SaCodeBusySendSetting',props:['owner'],setup:props=>()=>{
        const owner=props.owner;
        return h('section',{class:'busy-send-settings','aria-busy':owner.busy},[
          h('div',{class:'busy-send-copy'},[h('label',{for:'busy-send-preference'},'繁忙时的发送行为'),h('p',{class:'note'},'智能体运行时 Enter 和发送按钮的行为；Ctrl/Cmd+Enter 使用另一行为')]),
          h('select',{id:'busy-send-preference',value:owner.value??'',disabled:owner.busy||!owner.value,'aria-label':'繁忙时的发送行为',onChange:(e:Event)=>owner.change((e.target as HTMLSelectElement).value)},[
            !owner.value?h('option',{value:''},'尚未读取'):null,h('option',{value:'queue'},'排队发送'),h('option',{value:'steer'},'插话发送')]),
          h('p',{class:'note busy-send-note',role:'status','aria-live':'polite'},owner.note),
          owner.error?h('button',{type:'button',onClick:owner.retry},'重新读取'):null,
        ]);
      },
    }));
  }));
  const Outlet=defineComponent({props:{owner:{type:Object as PropType<OwnerProps>,required:true}},setup:props=>{
    const revision=ref(slots.getRevision()),off=slots.subscribeMutations(()=>revision.value=slots.getRevision());onBeforeUnmount(off);
    return ()=>{void revision.value;return slots.dispatch(null,'root',props.owner).map(({entry})=>h(entry.component as any,{key:entry.sequence,owner:props.owner}));};
  }});
  function unload(name:string){const scope=scopes.get(name);scopes.delete(name);scope?.dispose();}
  return Object.freeze({slots,Outlet,install,unload,dispose:()=>{if(disposed)return;disposed=true;for(const name of [...scopes.keys()].reverse())unload(name);}});
}
