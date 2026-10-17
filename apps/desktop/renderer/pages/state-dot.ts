// 冻结上游 StateDot 的 Vue 实现；MIT 许可证见 renderer/assets/dsh-ui-LICENSE.txt。
import {defineComponent,h,nextTick,type PropType} from 'vue';
export type State='done'|'warning'|'ongoing'|'error'|'idle';
export const StateDot=defineComponent({name:'SaCodeStateDot',props:{state:{type:String as PropType<State>,required:true},size:Number,appearance:{type:String as PropType<'dot'|'step'>,default:'dot'}},setup(props){
  const sync=(node:any)=>{if(node instanceof SVGSVGElement)void nextTick(()=>{if(node.isConnected)for(const animation of node.getAnimations({subtree:true}))animation.startTime=0;});};
  return()=>{const edge=props.size??(props.state==='ongoing'?14:10);
    if(props.state==='ongoing')return h('svg',{ref:sync,class:'state-dot-spinner','data-state':'ongoing',width:edge,height:edge,viewBox:'0 0 24 24','aria-hidden':true},[
      h('g',{class:'state-dot-motion'},[h('circle',{class:'state-dot-track',cx:12,cy:12,r:9.5}),h('circle',{class:'state-dot-arc',cx:12,cy:12,r:9.5})]),
    ]);
    return h('span',{class:props.appearance==='step'?'state-dot-step':'state-dot-solid','data-state':props.state,style:{width:edge+'px',height:edge+'px'},'aria-hidden':true},props.appearance==='step'&&props.state==='done'?[
      h('svg',{viewBox:'0 0 24 24',width:edge-2,height:edge-2,fill:'none',stroke:'currentColor','stroke-width':1.5},[h('path',{d:'M4 12l5 5L20 6'})]),
    ]:[]);
  };
}});
