import {defineComponent,h} from 'vue';
import {ExecutionTask} from './execution-task';

export const BuildTestPage=defineComponent({
  name:'SaCodeBuildTestPage',
  props:{active:Boolean,sessionId:String,api:Object},
  setup(props){
    return()=>h('section',{class:'side-section build-test-page','aria-label':'构建与测试'},[
      h('h2',{},'构建与测试'),
      h('p',{class:'note'},'本页复用持久任务的提案、一次性审批、启动、取消和输出分页。支持 cjpm build、cjpm test 与 node --test；测试需匹配非空摘要。命令按提案名称分类，不校验可执行文件签名或安装身份。'),
      h(ExecutionTask,{active:props.active,sessionId:props.sessionId,api:props.api,showTestReport:true}),
    ]);
  },
});