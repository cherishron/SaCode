import {defineComponent,h,ref,onMounted,onBeforeUnmount,type PropType} from 'vue';

type Scope='user'|'project';
type Kind='ssh'|'database'|'mcp';
type Definition={id:string;title:string;kind:Kind;enabled:boolean;spec:Record<string,unknown>};
type View={scope:Scope;workspace:string;revision:number;definitions:Definition[]};

const engines:[string,string][]=[['postgresql','PostgreSQL'],['mysql','MySQL'],['dm','达梦']];
const kinds:[Kind,string][]=[['ssh','SSH 服务器'],['database','数据库'],['mcp','MCP 服务']];

function errorText(error:unknown):string{
  const reason=String((error as Error)?.message||error);
  if(reason.includes('connection-revision-conflict'))return '配置已被其他操作更新。草稿仍保留，请刷新清单后核对再保存。';
  if(reason.includes('connection-bad-definition'))return '配置未通过校验。请检查主机、端口、凭据引用和必填项。';
  if(reason.includes('connection-tls-required'))return '数据库连接必须使用 TLS verify-full，不能关闭校验。';
  if(reason.includes('connection-bad-credential-ref'))return '凭据引用名称非法。只允许字母、数字和下划线，且不以数字开头。';
  if(reason.includes('connection-bad-host'))return '主机名包含非法字符。';
  if(reason.includes('connection-bad-port'))return '端口必须在 1–65535 范围内。';
  if(reason.includes('connection-bad-environment'))return 'MCP 环境变量名非法或重复。';
  if(reason.includes('connection-capacity'))return '已达到连接定义上限（100 条）。';
  if(reason.includes('connection-persistence-failed'))return '持久化失败。请重试或检查磁盘空间。';
  if(reason.includes('host-gone'))return 'SaCode Host 连接已断开；草稿保留，可连接恢复后重试。';
  return '操作失败：'+reason;
}

function checkView(value:any,scope:Scope):View{
  if(!value||value.scope!==scope||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.definitions))throw Error('连接服务回执格式错误');
  const definitions=value.definitions.map((d:any)=>{
    if(!d||typeof d.id!=='string'||typeof d.title!=='string'||typeof d.kind!=='string'||typeof d.enabled!=='boolean'||!d.spec||typeof d.spec!=='object')throw Error('连接定义回执格式错误');
    return d as Definition;
  });
  return {...value,definitions} as View;
}

export const ConnectionPage=defineComponent({
  name:'SaCodeConnectionPage',
  props:{api:{type:Object as PropType<Record<string,any>>,required:true},sessionId:{type:String,required:true},directory:String},
  emits:['back'],
  setup(props,{emit}){
    const scope=ref<Scope>('user'),definitions=ref<Definition[]>([]),revision=ref(0),busy=ref(false),error=ref(''),notice=ref(''),editing=ref(false),dirty=ref(false),editId=ref('');
    const kind=ref<Kind>('database'),title=ref(''),host=ref(''),port=ref(5432),database=ref(''),user=ref(''),credentialRef=ref(''),engine=ref('postgresql'),tlsMode=ref('verify-full');
    let epoch=0,disposed=false;
    const load=async()=>{
      const ticket=++epoch,requestedScope=scope.value,requestedSession=props.sessionId;
      busy.value=true;error.value='';notice.value='';
      try{const result=checkView(await props.api.connectionList(requestedSession,requestedScope),requestedScope);if(!disposed&&ticket===epoch&&requestedSession===props.sessionId){definitions.value=result.definitions;revision.value=result.revision;}}
      catch(e){if(!disposed&&ticket===epoch)error.value=errorText(e);}
      finally{if(!disposed&&ticket===epoch)busy.value=false;}
    };
    const resetForm=()=>{editing.value=false;dirty.value=false;editId.value='';title.value='';host.value='';port.value=5432;database.value='';user.value='';credentialRef.value='';engine.value='postgresql';tlsMode.value='verify-full';kind.value='database';};
    const begin=(def?:Definition)=>{
      revision.value=revision.value;editId.value=def?.id||globalThis.crypto.randomUUID();title.value=def?.title||'';kind.value=def?.kind||'database';dirty.value=false;editing.value=true;error.value='';notice.value='';
      if(def?.spec){const s=def.spec;host.value=String(s.host||'');port.value=Number(s.port)||5432;database.value=String(s.database||'');user.value=String(s.user||'');credentialRef.value=String(s.credentialRef||'');engine.value=String(s.engine||'postgresql');tlsMode.value=String(s.tlsMode||'verify-full');}
      else{host.value='';port.value=kind.value==='ssh'?22:5432;database.value='';user.value='';credentialRef.value='';}
    };
    const accept=(raw:any)=>{const result=checkView(raw,scope.value);definitions.value=result.definitions;revision.value=result.revision;};
    const save=async()=>{
      if(busy.value||!editing.value)return;
      const def:Definition={id:editId.value,title:title.value,kind:kind.value,enabled:definitions.value.find(d=>d.id===editId.value)?.enabled??false,
        spec:kind.value==='ssh'?{host:host.value,port:port.value,user:user.value,credentialRef:credentialRef.value}:
          kind.value==='database'?{engine:engine.value,host:host.value,port:port.value,database:database.value,user:user.value,credentialRef:credentialRef.value,tlsMode:'verify-full'}:
          {transport:'stdio',command:'',args:[],envRefs:[]}};
      busy.value=true;error.value='';notice.value='';
      try{const result=await props.api.connectionSave(props.sessionId,scope.value,revision.value,def);accept(result);resetForm();notice.value='连接定义已保存。保存不等于启动连接；连接检查与执行需各自独立审批。';}
      catch(e){if(!disposed)error.value=errorText(e);}
      finally{if(!disposed)busy.value=false;}
    };
    const control=async(id:string,action:'enable'|'disable'|'remove')=>{
      if(busy.value)return;
      busy.value=true;error.value='';notice.value='';
      try{const result=await props.api.connectionControl(props.sessionId,scope.value,revision.value,id,action);accept(result);if(action==='remove')notice.value='连接定义已删除。删除定义不删除远端内容。';else notice.value=action==='enable'?'连接定义已启用。启用不等于启动连接。':'连接定义已禁用。';}
      catch(e){if(!disposed)error.value=errorText(e);}
      finally{if(!disposed)busy.value=false;}
    };
    onMounted(()=>{void load();});
    onBeforeUnmount(()=>{disposed=true;});
    const switchScope=(s:Scope)=>{if(scope.value===s||busy.value)return;scope.value=s;void load();};
    const field=(label:string,node:unknown,hint?:string)=>h('label',{class:'cp-field'},[h('span',{},label),node,hint?h('small',{},hint):null]);
    const input=(label:string,value:{value:string},placeholder='',attrs={})=>h('input',{'aria-label':label,value:value.value,placeholder,onInput:(e:Event)=>value.value=(e.target as HTMLInputElement).value,...attrs});
    const select=(label:string,value:{value:string},items:[string,string][])=>h('select',{'aria-label':label,value:value.value,onChange:(e:Event)=>value.value=(e.target as HTMLSelectElement).value},items.map(([id,text])=>h('option',{value:id},text)));
    const button=(label:string,click:()=>void,extra={})=>h('button',{type:'button',class:'cp-button',onClick:click,...extra},label);
    return()=>h('main',{class:'connection-page'},[
      h('header',{class:'cp-header'},[h('h1',{},'连接管理'),button('返回对话',()=>emit('back'),{id:'back-to-chat'})]),
      h('nav',{class:'cp-scope','aria-label':'连接作用域'},[
        button('用户连接',()=>switchScope('user'),{'aria-pressed':scope.value==='user'}),
        button('项目连接',()=>switchScope('project'),{'aria-pressed':scope.value==='project'}),
      ]),
      h('div',{class:'cp-actions'},[button(editing.value?'收起表单':'添加连接',()=>editing.value?resetForm():begin(),{'aria-expanded':editing.value})]),
      error.value?h('p',{class:'cp-error',role:'alert'},error.value):null,
      notice.value?h('p',{class:'cp-notice',role:'status'},notice.value):null,
      h('section',{class:'cp-list','aria-label':'连接定义清单'},definitions.value.length===0?
        h('p',{class:'cp-empty'},busy.value?'正在读取…':'暂无连接。保存连接定义不等于启动连接；连接检查与执行需各自独立审批。'):
        h('ul',{},definitions.value.map(def=>h('li',{class:'cp-item','data-id':def.id},[
          h('div',{class:'cp-item-head'},[h('strong',{},def.title),h('span',{class:'cp-kind'},kinds.find(([k])=>k===def.kind)?.[1]||def.kind),h('span',{class:'cp-state', 'aria-label':'连接状态'},def.enabled?'已启用':'已禁用')]),
          h('div',{class:'cp-item-spec'},[h('code',{},def.kind==='ssh'?`${def.spec.host}:${def.spec.port}`:def.kind==='database'?`${def.spec.engine} ${def.spec.host}:${def.spec.port}/${def.spec.database}`:'MCP stdio')]),
          h('div',{class:'cp-item-actions'},[
            button('编辑',()=>begin(def)),
            button(def.enabled?'禁用':'启用',()=>control(def.id,def.enabled?'disable':'enable'),{disabled:busy.value}),
            button('删除',()=>control(def.id,'remove'),{disabled:busy.value}),
          ]),
        ]))),
      ),
      editing.value?h('section',{class:'cp-editor','aria-label':'连接配置表单'},[
        h('div',{class:'cp-form'},[
          field('名称',input('名称',title,'输入名称',{maxlength:200})),
          field('连接类型',select('连接类型',kind,kinds)),
          kind.value==='database'?field('数据库类型',select('数据库类型',engine,engines)):null,
          kind.value!=='mcp'?[
            field(kind.value==='ssh'?'服务器地址':'数据库地址',input('连接地址',host,kind.value==='ssh'?'example.com':'127.0.0.1')),
            field('端口',input('端口',port,'',{type:'number',min:1,max:65535})),
            field('用户名',input('用户名',user)),
          ]:null,
          kind.value==='database'?field('数据库',input('数据库',database)):null,
          field('凭据引用',input('凭据引用',credentialRef,'环境变量名'),'凭据以环境变量注入，不在界面采集密码或密钥。'),
        ]),
        h('footer',{class:'cp-form-actions'},[
          button('取消',()=>resetForm()),
          button('保存',()=>void save(),{disabled:busy.value||!title.value.trim()||!host.value.trim()}),
        ]),
      ]):null,
    ]);
  }
});
