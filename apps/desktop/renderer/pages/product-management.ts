import {defineComponent,h,ref,computed,onMounted,onBeforeUnmount,type PropType} from 'vue';
type Page='knowledge'|'automation'|'connections';
const names:Record<Page,string>={knowledge:'知识库',automation:'自动化',connections:'连接'};
const icons:Record<Page,string>={knowledge:'M3 4h8l1 2 1-2h8v16h-8l-1 1-1-1H3zM12 6v15',automation:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l4 2',connections:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'};
const icon=(path:string)=>h('svg',{viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':'true'},h('path',{d:path}));
// 仅界面草稿；没有管理服务时不写入本地存储、不创建任务、不执行连接。
export const ProductManagementPage=defineComponent({
 name:'SaCodeProductManagement',props:{page:{type:String as PropType<Page>,required:true},draft:{type:Object as PropType<Record<string,any>>,default:()=>({})},directory:String,readRecent:Function,models:{type:Array as PropType<{id:string;name:string}[]>,default:()=>[]},recent:{type:Array as PropType<{id:string;directory:string;available:boolean}[]>,default:()=>[]}},emits:['back','models'],
 setup(props,{emit}){
  const scope=ref('user'),filter=ref('all'),type=ref('ssh'),editing=ref(false),query=ref('');
  // 未保存草稿仅由父级保留在本次应用内存，按会话/项目和子作用域隔离。
  const currentDraft=()=>{
    const key=props.page==='knowledge'?scope.value:props.page==='connections'?type.value:'task';
    return props.draft[key]||(props.draft[key]={});
  };
  const value=(key:string|(()=>string),initial:string|(()=>string)='')=>computed({get:()=>currentDraft()[typeof key==='function'?key():key]??(typeof initial==='function'?initial():initial),set:(next:string)=>currentDraft()[typeof key==='function'?key():key]=next});
  const title=value('title'),content=value('content'),directory=value('directory'),model=value('model'),cron=value('cron','0 9 * * 1-5'),timezone=value('timezone','Asia/Shanghai');
  const endpoint=value(()=>type.value==='mcp'?'endpoint-'+transport.value:'endpoint'),port=value('port',()=>type.value==='database'?'5432':'22'),username=value('username'),database=value('database'),transport=value('transport','stdio'),permission=value('permission','plan'),databaseType=value('databaseType','PostgreSQL');
  const recentOptions=ref(props.recent),recentBusy=ref(false),recentError=ref('');let disposed=false;
  const loadRecent=async()=>{if(!props.readRecent||recentBusy.value)return;recentBusy.value=true;recentError.value='';try{const result=await props.readRecent();if(!disposed){if(!Array.isArray(result?.entries)||!result.entries.every((entry:any)=>entry&&typeof entry.id==='string'&&typeof entry.directory==='string'&&entry.directory.trim().length>0&&typeof entry.available==='boolean'))throw Error('最近项目格式异常');recentOptions.value=result.entries;}}catch(e){if(!disposed){recentOptions.value=[];recentError.value='无法读取最近项目；可以填写目录路径。';}}finally{if(!disposed)recentBusy.value=false;}};
  onMounted(()=>{if(props.page==='automation')void loadRecent();});onBeforeUnmount(()=>{disposed=true;});
  const sourceKind=value('sourceKind','note'),sourceRef=value('sourceRef');
  const name=computed(()=>names[props.page]);
  const button=(label:string,click:()=>void,extra={})=>h('button',{type:'button',class:'management-button',onClick:click,...extra},label);
  const field=(label:string,node:unknown,hint?:string)=>h('label',{class:'management-field'},[h('span',{},label),node,hint?h('small',{},hint):null]);
  const input=(label:string,value:{value:string},placeholder='',attrs={})=>h('input',{'aria-label':label,value:value.value,placeholder,onInput:(e:Event)=>value.value=(e.target as HTMLInputElement).value,...attrs});
  const select=(label:string,value:{value:string},items:[string,string][])=>h('select',{'aria-label':label,value:value.value,onChange:(e:Event)=>value.value=(e.target as HTMLSelectElement).value},items.map(([id,text])=>h('option',{value:id},text)));
  const begin=()=>{editing.value=true;if(currentDraft().directory===undefined)directory.value=props.directory||'';};
  return()=>h('main',{class:'management-page',id:'management-'+props.page},[
   h('header',{class:'management-header'},[h('div',{class:'management-heading'},[icon(icons[props.page]),h('h1',{},name.value)]),button('返回对话',()=>emit('back'),{id:'back-to-chat'})]),
   h('div',{class:'management-body'},[
    h('div',{class:'management-intro'},[h('div',{},[h('h2',{},props.page==='knowledge'?'让项目知识随时可查':props.page==='automation'?'把重复工作交给自动化':'管理项目的外部连接'),h('p',{},props.page==='knowledge'?'按用户与项目管理文档、来源和索引。':props.page==='automation'?'指定工作目录、模型和触发时间；创建与运行分别授权。':'SSH、数据库和 MCP 各自管理连接、测试与启停。')]),button(editing.value?'收起表单':props.page==='knowledge'?'添加文档':props.page==='automation'?'创建自动化':'添加连接',()=>editing.value?editing.value=false:begin(),{'aria-expanded':editing.value})]),
    h('nav',{class:'management-scope','aria-label':props.page==='knowledge'?'知识作用域':props.page==='connections'?'连接类型':'自动化状态'},
     (props.page==='knowledge'?[['user','用户知识'],['project','项目知识']]:props.page==='connections'?[['ssh','SSH 服务器'],['database','数据库'],['mcp','MCP 服务']]:[['all','全部任务'],['active','运行中'],['paused','已暂停']]).map(([id,label])=>button(label,()=>{if(props.page==='connections'){type.value=id;}else if(props.page==='automation')filter.value=id;else scope.value=id;},{'aria-pressed':(props.page==='connections'?type.value:props.page==='automation'?filter.value:scope.value)===id}))),
    props.page==='knowledge'&&scope.value==='project'?h('p',{class:'management-project'},props.directory?'当前项目：'+props.directory:'尚未选择项目，请先从左侧选择项目文件夹。'):null,
    h('div',{class:'management-search'},[icon('M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6'),input('搜索'+name.value,query,'搜索'+name.value,{type:'search',disabled:true,title:'服务接通后可检索真实清单'})]),
    h('section',{class:'management-unavailable',role:'status'},[icon(icons[props.page]),h('h3',{},'尚未连接'+name.value+'服务'),h('p',{},'当前版本未提供管理接口，无法读取已有内容。这里不表示清单为空。'),h('small',{},'可以填写配置表单；保存、执行及测试连接暂不可用。')]),
    editing.value?h('section',{class:'management-editor','aria-label':name.value+'配置表单'},[
      h('div',{class:'management-editor-heading'},[h('h3',{},props.page==='knowledge'?'文档信息':props.page==='automation'?'任务配置':'连接配置'),h('span',{class:'management-draft'},'未保存 · 本次应用内保留')]),
      h('div',{class:'management-form'},[
       field(props.page==='knowledge'?'文档标题':'名称',input('名称',title,'输入名称',{maxlength:200})),
       props.page==='knowledge'?field('知识作用域',select('知识作用域',scope,[['user','用户知识'],['project','项目知识']])):null,
       props.page==='knowledge'?[
        field('文档来源',select('文档来源',sourceKind,[['note','文本笔记'],['file','项目文件']])),
        sourceKind.value==='file'?field('项目相对路径',input('知识来源路径',sourceRef,'例如 docs/architecture.md'),'保存与索引服务接通后核对文件及修订；当前不会读取或导入。'):null,
       ]:null,
       props.page==='automation'?[
        field('工作目录',h('div',{class:'management-directory'},[input('工作目录',directory,'绝对目录路径'),button('当前项目',()=>directory.value=props.directory||'',{disabled:!props.directory})]),'选择实际工作目录；此处不会切换当前会话的项目。'),
        field('最近项目',h('div',{class:'management-directory'},[h('select',{'aria-label':'最近项目',disabled:recentBusy.value,value:directory.value,onChange:(e:Event)=>directory.value=(e.target as HTMLSelectElement).value},[h('option',{value:''},recentBusy.value?'读取中…':'选择最近项目'),...recentOptions.value.map(p=>h('option',{value:p.directory,disabled:!p.available},p.directory+(p.available?'':'（目录不可用）')))]),button('刷新',()=>void loadRecent(),{disabled:recentBusy.value})]),recentError.value||'来自真实项目目录记录，不绑定或切换当前会话。'),
        field('模型',h('div',{class:'management-directory'},[select('自动化模型',model,[['','请选择模型'],...props.models.map(m=>[m.id,m.name||m.id] as [string,string])]),button('模型中心',()=>emit('models'))]),props.models.length?'来自当前模型中心的可用模型。':'没有可用模型，请先在模型中心配置。'),
        field('触发规则',input('Cron',cron,'0 9 * * 1-5'),'Cron 五段：分钟、小时、日期、月份、星期；规则由调度服务校验，当前未执行。'),
        field('时区',input('时区',timezone,'Asia/Shanghai')),
        field('执行权限',select('执行权限',permission,[['plan','Plan'],['build','Build'],['yolo','YOLO'],['auto-review','Auto Review']]),'保存配置不授予执行许可，首次执行仍需准入。'),
       ]:null,
       props.page==='connections'?[
        field('连接类型',select('连接类型',type,[['ssh','SSH 服务器'],['database','数据库'],['mcp','MCP 服务']])),
        type.value==='database'?field('数据库类型',select('数据库类型',databaseType,[['PostgreSQL','PostgreSQL'],['MySQL','MySQL'],['达梦','达梦']])):null,
        type.value==='mcp'?field('传输方式',select('MCP 传输',transport,[['stdio','标准输入输出'],['http','HTTP']])):null,
        field(type.value==='mcp'&&transport.value==='stdio'?'服务启动命令':'服务器地址',input('连接地址',endpoint,type.value==='ssh'?'example.com':type.value==='database'?'127.0.0.1':transport.value==='stdio'?'命令及参数':'https://example.com/mcp')),
        type.value!=='mcp'?field('端口',input('端口',port,'',{type:'number',min:1,max:65535})):null,
        type.value!=='mcp'?field('用户名',input('用户名',username)):null,
        type.value==='database'?field('数据库',input('数据库',database)):null,
        field('凭据',h('p',{class:'management-credential'},'保存服务接通后选择安全凭据；本表单不采集密码或密钥。')),
       ]:null,
       props.page!=='connections'&&(props.page!=='knowledge'||sourceKind.value==='note')?field(props.page==='knowledge'?'正文':'任务提示词',h('textarea',{'aria-label':props.page==='knowledge'?'正文':'任务提示词',value:content.value,rows:6,onInput:(e:Event)=>content.value=(e.target as HTMLTextAreaElement).value,placeholder:props.page==='knowledge'?'输入文档内容或项目约束':'描述要完成的任务与验收条件'})):null,
      ]),
      h('footer',{class:'management-form-actions'},[h('p',{},'仅保留在本次应用内存；尚未保存到服务，关闭应用后会丢失。'),button('取消',()=>editing.value=false),button('保存',()=>{},{disabled:true,title:'管理接口尚未接通'}),props.page==='connections'?button(type.value==='mcp'?'启动服务':'测试连接',()=>{},{disabled:true,title:'真实连接接口尚未接通'}):null]),
    ]):null,
   ]),
  ]);
 }
});
