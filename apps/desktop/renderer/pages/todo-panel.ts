// 对照冻结上游 TodoPanel；任务来自核心投影，面板仅管理折叠状态。
// MIT 许可证见 renderer/assets/dsh-ui-LICENSE.txt。
import {defineComponent,h,ref,type PropType} from 'vue';
import {StateDot,type State} from './state-dot';
export {StateDot} from './state-dot';
export type Todo={content:string;status:'pending'|'in_progress'|'completed'};
export function progressLabel(todos:readonly Todo[]){const done=todos.filter(t=>t.status==='completed').length,active=todos.filter(t=>t.status==='in_progress').length,pending=todos.filter(t=>t.status==='pending').length;return [done?`${done} 已完成`:null,active?`${active} 进行中`:null,pending?`${pending} 待处理`:null].filter(Boolean).join('\u2002·\u2002');}
const labels={completed:'已完成',in_progress:'进行中',pending:'待处理'};
const states:Record<Todo['status'],State>={completed:'done',in_progress:'ongoing',pending:'idle'};
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'todo-'+cls,...props},children);
const icon=(path:string)=>h('svg',{viewBox:'0 0 24 24',width:16,height:16,fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':true},[h('path',{d:path})]);
let instance=0;
export const TodoPanel=defineComponent({name:'SaCodeTodoPanel',props:{todos:{type:Array as PropType<readonly Todo[]>,default:()=>[]}},setup(props){const collapsed=ref(true),listId='sacode-todos-'+(++instance);
  return()=>props.todos.length?el('section','root',[el('div','body',[
    el('button','header',[icon('M9 6h12M9 12h12M9 18h12M3 6l1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2'),el('span','title','任务'),el('span','progress',progressLabel(props.todos)),icon(collapsed.value?'M6 15l6-6 6 6':'M6 9l6 6 6-6')],{type:'button','aria-expanded':!collapsed.value,'aria-controls':listId,onClick:()=>collapsed.value=!collapsed.value}),
    !collapsed.value?el('ul','list',props.todos.map((item,index)=>el('li','item',[
      el('span','glyph',[h(StateDot,{state:states[item.status]})],{role:'img','aria-label':labels[item.status]}),el('span','content',item.content),
    ],{key:index+':'+item.content,'data-status':item.status})),{id:listId}):null,
  ])],{'data-todo-panel':'','aria-label':'任务'}):null;
}});
