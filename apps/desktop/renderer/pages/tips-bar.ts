import {defineComponent,h,type PropType} from 'vue';

// 使用提醒条。它是对话之外的辅助位：正文不进消息投影，也不进会话日志。
// kind 只有两类——startup（启动时介绍能力）与 context（回复后的容量提醒）；
// reliable 为 false 时不显示任何比例，核心没给可靠读数就不会有 context 类提醒。
export type TipsEntry={text:string;kind:string;reliable:boolean}|null;
export const TipsBar=defineComponent({
  name:'SaCodeTipsBar',
  props:{
    entry:{type:Object as PropType<TipsEntry>,default:null},
    busy:Boolean,
    onDismiss:{type:Function as PropType<()=>void>,required:true}
  },
  setup(props){
    return()=>{
      const e=props.entry;
      if(!e||!e.text)return null;
      return h('div',{
        class:'tips-bar tips-bar-'+e.kind,
        role:'note','aria-live':'polite',
        'data-tips-kind':e.kind,'data-tips-reliable':String(e.reliable),
      },[
        h('span',{class:'tips-bar-mark','aria-hidden':'true'},e.kind==='context'?'!':'i'),
        h('span',{class:'tips-bar-text'},e.text),
        h('button',{
          class:'tips-bar-hide',type:'button',
          'aria-label':'不再显示使用提醒',
          disabled:props.busy,
          onClick:()=>props.onDismiss()
        },'不再提醒'),
      ]);
    };
  }
});
