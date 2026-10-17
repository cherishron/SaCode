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
  // owner 是按行 id 索引的子 owner 映射：busy-send 行读 .value/.change/.busy/.note/.error/.retry，
  // transcript-view/composer-enter/session-log 行只读 .value/.change。缺键回落到整份 owner，
  // 只读行不读 owner 字段，回落对它们无害——旧的单 owner 调用方仍能跑。
  const Host=defineComponent({props:['owner'],setup:props=>()=>h('div',{class:'general-plugin-rows'},
    slots.dispatch(host.entry,'settings.general.row',props.owner).filter(({entry})=>!Array.isArray(props.owner?.visibleRows)||props.owner.visibleRows.includes(entry.options.id)).map(({entry})=>h(entry.component as any,{key:entry.sequence,owner:(props.owner&&props.owner[entry.options.id])||props.owner})))});
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
    // 使用提醒开关：值只能是核心的三态（未读取 / 显示 / 隐藏），界面不自持一份偏好。
    row.register({name:'settings.general.row',id:'tips',order:85,label:'使用提醒'},defineComponent({
      name:'SaCodeTipsSetting',props:['owner'],setup:props=>()=>{
        const owner=props.owner;
        const value=owner.value===true?'hidden':(owner.value===false?'shown':'');
        return h('section',{class:'tips-settings','aria-busy':owner.busy},[
          h('div',{class:'tips-settings-copy'},[h('label',{for:'tips-preference'},'使用提醒'),h('p',{class:'note'},'启动时的功能提示与回复后的上下文容量提醒；关掉后桌面与命令行一起停')]),
          h('select',{id:'tips-preference',value,disabled:owner.busy||owner.value===null,'aria-label':'使用提醒',onChange:(e:Event)=>owner.change((e.target as HTMLSelectElement).value==='hidden')},[
            value===''?h('option',{value:''},'尚未读取'):null,h('option',{value:'shown'},'显示'),h('option',{value:'hidden'},'隐藏')]),
          h('p',{class:'note tips-settings-note',role:'status','aria-live':'polite'},owner.note),
          owner.error?h('button',{type:'button',onClick:owner.retry},'重新读取'):null,
        ]);
      },
    }));
  }));
  // —— 11 个缺失行（上游 DSH 12 行，当前仅 busy-send）——
  install('ui-settings-extra',child=>{
    child.inject('settings.general.row',row=>{
      row.register({name:'settings.general.row',id:'permission',order:10,label:'权限'},defineComponent({
        name:'SaCodePermissionSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'权限'),h('p',{class:'note read-only-value'},'已禁用')]),
      }));
      row.register({name:'settings.general.row',id:'language',order:20,label:'语言'},defineComponent({
        name:'SaCodeLanguageSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'语言'),h('p',{class:'note read-only-value'},'简体中文')]),
      }));
      row.register({name:'settings.general.row',id:'appearance',order:30,label:'外观'},defineComponent({
        name:'SaCodeAppearanceSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'外观'),h('p',{class:'note read-only-value'},'跟随系统')]),
      }));
      row.register({name:'settings.general.row',id:'font-size',order:40,label:'字体大小'},defineComponent({
        name:'SaCodeFontSizeSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'字体大小'),h('p',{class:'note read-only-value'},'14px')]),
      }));
      row.register({name:'settings.general.row',id:'transcript-view',order:50,label:'对话记录视图'},defineComponent({
        name:'SaCodeTranscriptViewSetting',props:['owner'],setup:props=>()=>{
          const owner=props.owner;
          return h('section',{class:'busy-send-settings'},[
            h('div',{class:'busy-send-copy'},[h('label',null,'对话记录视图'),h('p',{class:'note'},'控制对话记录的显示密度')]),
            h('select',{value:owner.value??'',disabled:owner.busy||!owner.value,'aria-label':'对话记录视图',onChange:(e:Event)=>owner.change((e.target as HTMLSelectElement).value)},[
              !owner.value?h('option',{value:''},'尚未读取'):null,h('option',{value:'default'},'默认'),h('option',{value:'compact'},'紧凑'),h('option',{value:'expanded'},'展开'),
            ]),
          ]);
        },
      }));
      row.register({name:'settings.general.row',id:'dev-tools',order:60,label:'开发者工具'},defineComponent({
        name:'SaCodeDevToolsSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'开发者工具'),h('p',{class:'note read-only-value'},'已关闭')]),
      }));
      row.register({name:'settings.general.row',id:'shortcuts',order:70,label:'快捷键'},defineComponent({
        name:'SaCodeShortcutsSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'快捷键'),h('p',{class:'note read-only-value'},'Ctrl+, 打开设置  |  Ctrl+K 命令面板')]),
      }));
      row.register({name:'settings.general.row',id:'link-opening',order:90,label:'链接打开'},defineComponent({
        name:'SaCodeLinkOpeningSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'链接打开'),h('p',{class:'note read-only-value'},'在浏览器中打开')]),
      }));
      row.register({name:'settings.general.row',id:'composer-enter',order:95,label:'编辑器 Enter'},defineComponent({
        name:'SaCodeComposerEnterSetting',props:['owner'],setup:props=>()=>{
          const owner=props.owner;
          return h('section',{class:'busy-send-settings'},[
            h('div',{class:'busy-send-copy'},[h('label',null,'编辑器 Enter'),h('p',{class:'note'},'Enter 键行为')]),
            h('select',{value:owner.value??'',disabled:owner.busy||!owner.value,'aria-label':'编辑器 Enter',onChange:(e:Event)=>owner.change((e.target as HTMLSelectElement).value)},[
              !owner.value?h('option',{value:''},'尚未读取'):null,h('option',{value:'send'},'Enter 发送'),h('option',{value:'newline'},'Enter 换行'),
            ]),
          ]);
        },
      }));
      row.register({name:'settings.general.row',id:'performance',order:98,label:'性能与用量'},defineComponent({
        name:'SaCodePerformanceSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'性能与用量'),h('p',{class:'note read-only-value'},'用量统计由模型中心管理')]),
      }));
      row.register({name:'settings.general.row',id:'session-log',order:99,label:'Session Log'},defineComponent({
        name:'SaCodeSessionLogSetting',props:['owner'],setup:props=>()=>{
          const owner=props.owner;
          return h('section',{class:'busy-send-settings'},[
            h('div',{class:'busy-send-copy'},[h('label',null,'Session Log 上传'),h('p',{class:'note'},'是否上传会话日志用于改进')]),
            h('select',{value:owner.value??'',disabled:owner.busy||!owner.value,'aria-label':'Session Log',onChange:(e:Event)=>owner.change((e.target as HTMLSelectElement).value)},[
              !owner.value?h('option',{value:''},'尚未读取'):null,h('option',{value:'off'},'关闭'),h('option',{value:'on'},'开启'),
            ]),
          ]);
        },
      }));
      row.register({name:'settings.general.row',id:'version',order:100,label:'当前版本'},defineComponent({
        name:'SaCodeVersionSetting',props:['owner'],setup:props=>()=>h('section',{class:'read-only-setting'},[h('label',null,'当前版本'),h('p',{class:'note read-only-value'},'0.1.0')]),
      }));
    });
  });
  const Outlet=defineComponent({props:{owner:{type:Object as PropType<OwnerProps>,required:true}},setup:props=>{
    const revision=ref(slots.getRevision()),off=slots.subscribeMutations(()=>revision.value=slots.getRevision());onBeforeUnmount(off);
    return ()=>{void revision.value;return slots.dispatch(null,'root',props.owner).map(({entry})=>h(entry.component as any,{key:entry.sequence,owner:props.owner}));};
  }});
  function unload(name:string){const scope=scopes.get(name);scopes.delete(name);scope?.dispose();}
  return Object.freeze({slots,Outlet,install,unload,dispose:()=>{if(disposed)return;disposed=true;for(const name of [...scopes.keys()].reverse())unload(name);}});
}