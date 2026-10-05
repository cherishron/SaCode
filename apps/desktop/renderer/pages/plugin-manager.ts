// 插件安装管理视图；安装任务、取消确认、启用状态均由仓颉适配器提供。
import {defineComponent,h,ref,onMounted,onBeforeUnmount,type PropType,type Component} from 'vue';
import {RegistryPicker,validRegistry} from './registry-picker';
import {builtinDescription} from './plugin-descriptions';
export interface Row {id:string;moduleName?:string;entryId?:string;name:string;description?:string;descriptionZhCN?:string;enabled:boolean;phase:string|null;readOnlyReason?:string}
export interface Package {name:string;title:string;description?:string;descriptionZhCN?:string;version?:string;installed:boolean;enabled:boolean;optional:boolean;readOnlyReason?:string;error?:string;rows:Row[]}
export type Phase='idle'|'checking'|'starting'|'running'|'cancelling'|'applying'|'unconfirmed'|'unknown'|'done'|'failed';
export interface Install {open:boolean;spec:string;phase:Phase;registry:string;registries:{name:string;url:string}[];subject?:{name:string;description?:string;version?:string;host?:string};inputError?:string;failure?:{reason:string;code?:string;pendingBuilds?:string[];failedAt?:'registry'|'spec-host';kind?:string;uncertainty?:'result'|'cancellation'|'acceptance';incompatible?:{name:string;version:string;runtimeVersion:string;peers:Record<string,string>}[]};attempts?:{registries:string[];total:number};approvedBuilds?:string[];runs:{jobId:string;command:string;cwd:string;output:string;exitCode?:number|null}[];installed?:string;restartRequired?:boolean;enabling?:boolean}
export interface Snapshot {available:boolean;packages:Package[];install:Install;notice?:string;busy:string[];confirm?:string;highlight?:string}
export type Command={kind:'refresh'|'open-install'|'close-install'|'run-install'|'cancel-install'|'reconcile-install'|'enable-installed'|'approve-builds'|'confirm-uninstall'|'cancel-confirm'|'edit-install'|'dismiss-notice'|'change-registry'|'use-github-mirror'}
 |{kind:'edit-spec';text:string}|{kind:'choose-registry';url:string}|{kind:'enable-package';name:string;enabled:boolean}|{kind:'enable-row';entryId:string;enabled:boolean}|{kind:'uninstall';name:string};
export interface Adapter {read():Promise<Snapshot>;dispatch(command:Command):Promise<void>;subscribe?(invalidate:()=>void):()=>void}
// 本地 Vue 贡献只描述界面；配置读写由贡献自己的有限适配器完成，不接收服务端可执行代码。
export type Subject={kind:'item';id:string}|{kind:'bundle';name:string}|{kind:'row';name:string;rowId:string};
export interface Contribution {id:string;order:number;slot:'configuration'|'actions'|'badge'|'section';subject:Subject;component:Component;props?:Record<string,unknown>}
const subjectKey=(s:Subject)=>s.kind==='item'?JSON.stringify(['item',s.id]):s.kind==='bundle'?JSON.stringify(['bundle',s.name]):JSON.stringify(['row',s.name,s.rowId]);
const failureLabels:Record<string,string>={'pnpm-missing':'没有找到 pnpm，无法安装',timeout:'安装超时','not-found':'未找到相关插件','no-matching-version':'没有匹配的版本',network:'网络连接失败','disk-full':'磁盘空间不足，安装已停止',permission:'没有写入权限，无法安装','build-blocked':'有依赖的安装脚本需要你允许后才能继续',integrity:'下载的安装包校验失败'};
export function failureText(i:Install):string {
  const f=i.failure;if(!f)return '安装过程中出错，原因见安装详情';
  if(f.code==='incompatible-version')return (f.incompatible?.length?f.incompatible.map(p=>`${p.name}@${p.version} 与 SaCode ${p.runtimeVersion} 不兼容（要求 ${Object.entries(p.peers).map(([name,range])=>name+' '+range).join(', ')}）。`).join(''):'这个插件与当前 SaCode 版本不兼容。')+'请安装与当前 SaCode 兼容的插件版本。';
  if(f.kind==='build-blocked'&&!f.pendingBuilds?.length)return '有依赖的安装脚本被阻止；请在当前配置的 pnpm-workspace.yaml 中明确允许这些包后重试。';
  if(f.failedAt==='spec-host'&&i.subject?.host)return `无法连接 ${i.subject.host}。Git 仓库和压缩包直链不经过 npm 安装源；请检查网络或代理，或改填已发布的 npm 包名。`;
  if(f.failedAt==='registry'&&['network','timeout'].includes(f.kind||'')&&(i.attempts?.registries.length||0)>1)return `所有安装源都无法连接（已尝试：${i.attempts!.registries.map(url=>registryName(i,url)).join('、')}）。请检查网络或代理设置，或更换安装源后重试。`;
  return failureLabels[f.kind||'']||f.reason||'安装过程中出错，原因见安装详情';
}
const registryName=(i:Install,url:string)=>i.registries.find(r=>r.url===url)?.name||url||'默认安装源';
export function githubRecovery(i:Install):boolean {
  if(i.phase!=='failed'||i.failure?.failedAt!=='spec-host'||!['network','timeout'].includes(i.failure.kind||''))return false;
  const host=i.subject?.host?.toLowerCase().split(':')[0];if(host!=='github.com'&&!host?.endsWith('.github.com'))return false;
  return i.registries.some(r=>{try{return new URL(r.url).hostname==='registry.npmmirror.com';}catch{return false;}});
}
const el=(tag:string,cls:string,children:any,props:any={})=>h(tag,{class:'plugin-manager-'+cls,...props},children);
const title:Record<Phase,string>={idle:'添加插件',checking:'正在检查…',starting:'正在启动安装',running:'插件安装中…',cancelling:'正在取消安装',applying:'正在应用插件',unconfirmed:'安装状态尚未确认',unknown:'未能获取安装结果',done:'已安装',failed:'插件安装失败'};
const phaseText:Record<string,string>={pending:'等待依赖',loading:'加载中',active:'运行中',failed:'异常',unloading:'卸载中'};
const packageDescription=(pkg:Package)=>builtinDescription(pkg.name,pkg.description,pkg.descriptionZhCN);
const rowDescription=(row:Row)=>builtinDescription(row.moduleName||row.id,row.description,row.descriptionZhCN);
const initialInstall=():Install=>({open:false,spec:'',phase:'idle',registry:'',registries:[],runs:[]});
export const Page=defineComponent({name:'SaCodePluginManager',props:{adapter:Object as PropType<Adapter>,contributions:Array as PropType<Contribution[]>},setup(props){
  const snapshot=ref<Snapshot>({available:false,packages:[],busy:[],install:initialInstall()}),status=ref<'unconnected'|'loading'|'ready'|'error'>(props.adapter?'loading':'unconnected');
  const selected=ref<string|null>(null),rowFilter=ref(''),actionError=ref(''),sending=ref(false),registryOpen=ref(false),customRegistry=ref(''),guideOpen=ref(false),detailsOpen=ref(false),expandedRuns=ref<string[]>([]);
  const selectedRow=ref<string|null>(null);
  const hasSnapshot=ref(false),refreshFailed=ref(false);
  let generation=0,disposed=false,off:(()=>void)|undefined,composing=false,compositionUntil=0;
  const read=async()=>{if(!props.adapter)return;const token=++generation;try{const result=await props.adapter.read();if(!disposed&&token===generation){snapshot.value=result;hasSnapshot.value=true;refreshFailed.value=false;status.value='ready';if(!['idle','checking'].includes(result.install.phase))registryOpen.value=false;}}catch{if(!disposed&&token===generation){if(hasSnapshot.value)refreshFailed.value=true;else status.value='error';}}};
  const send=async(command:Command)=>{if(!props.adapter)return;actionError.value='';try{await props.adapter.dispatch(command);await read();}catch{if(!disposed)actionError.value='操作未得到确认，请刷新或核对状态后重试。';}};
  const mutation=async(command:Command)=>{if(sending.value)return;sending.value=true;try{await send(command);}finally{if(!disposed)sending.value=false;}};
  onMounted(()=>{off=props.adapter?.subscribe?.(()=>{void read();});void read();});onBeforeUnmount(()=>{disposed=true;generation++;off?.();});
  const button=(text:string,onClick:()=>void,extra:any={})=>el('button','button',text,{type:'button',onClick,...extra});
  const busy=(pkg:Package)=>sending.value||snapshot.value.busy.includes(pkg.name);
  const switcher=(label:string,checked:boolean,disabled:boolean,onChange:()=>void)=>el('label','switch',[el('span','label',label),h('input',{type:'checkbox',role:'switch','aria-label':label,checked,disabled,onChange})]);
  const openPackage=(pkg:Package)=>{selected.value=pkg.name;selectedRow.value=null;rowFilter.value='';};
  const matching=(slot:Contribution['slot'],subject:Subject)=>(props.contributions||[]).filter(c=>c.slot===slot&&subjectKey(c.subject)===subjectKey(subject)).slice().sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
  const contributed=(slot:Contribution['slot'],subject:Subject)=>matching(slot,subject).map(c=>h(c.component,{...c.props,subject,key:subjectKey(subject)+':'+slot+':'+c.id}));
  const packageCard=(pkg:Package)=>el('article','card',[
    button(pkg.title,()=>openPackage(pkg),{class:'plugin-manager-cardHead','aria-label':'查看 '+pkg.title}),
    pkg.version?el('span','tag','v'+pkg.version):null,el('p','description',packageDescription(pkg)||pkg.name),
    el('p','status',pkg.error?'异常':!pkg.enabled?'已停用':pkg.rows.some(r=>r.phase==='failed')?'异常':pkg.rows.some(r=>r.phase==='active')?'运行中':'未运行'),
    switcher('启用 '+pkg.title,pkg.enabled,!!pkg.readOnlyReason||busy(pkg),()=>void mutation({kind:'enable-package',name:pkg.name,enabled:!pkg.enabled})),
    pkg.readOnlyReason?el('p','note',pkg.readOnlyReason):null,
  ],{key:pkg.name,'data-package-name':pkg.name,'data-highlighted':snapshot.value.highlight===pkg.name});
  const official=()=>el('section','group',[el('h2','groupTitle','官方'),el('div','cards',[...((window as any).SaCodeConfiguration.definitions as {namespace:string;title:string;description:string}[]).map(d=>el('article','card',[button(d.title,()=>selected.value='config:'+d.namespace,{class:'plugin-manager-cardHead'}),el('p','description',d.description)],{key:d.namespace})),...snapshot.value.packages.filter(p=>!p.installed&&p.optional).map(packageCard)]),el('p','note','内置插件列表及运行状态可在「设置 → 内置插件」中查看。')]);
  const packageDetail=(pkg:Package)=>{
    const query=rowFilter.value.trim().toLocaleLowerCase(),rows=pkg.rows.filter(r=>[r.name,r.description,rowDescription(r),r.entryId].some(v=>v?.toLocaleLowerCase().includes(query)));
    const subject:Subject={kind:'bundle',name:pkg.name};
    return el('div','detail',[button('返回插件列表',()=>selected.value=null),el('header','detailHead',[el('div','detailTitle',[el('h1','title',pkg.title),el('p','description',packageDescription(pkg)||pkg.name)]),pkg.installed?button('卸载',()=>void mutation({kind:'uninstall',name:pkg.name}),{disabled:busy(pkg)||!!pkg.readOnlyReason}):null]),
      el('div','actions',contributed('actions',subject)),el('div','badges',contributed('badge',subject)),
      el('code','identity',pkg.name+(pkg.version?'@'+pkg.version:'')),switcher('启用 '+pkg.title,pkg.enabled,busy(pkg)||!!pkg.readOnlyReason,()=>void mutation({kind:'enable-package',name:pkg.name,enabled:!pkg.enabled})),
      pkg.error?el('p','error',pkg.error,{role:'alert'}):null,pkg.readOnlyReason?el('p','note',pkg.readOnlyReason):null,
      el('section','configuration',contributed('configuration',subject),{'data-plugin-config':subjectKey(subject)}),
      el('h2','groupTitle','包含的组件'),el('p','note',`共 ${pkg.rows.length} 个 · ${pkg.rows.filter(r=>r.enabled&&r.phase==='active').length} 运行中 · ${pkg.rows.filter(r=>!r.enabled).length} 已停用 · ${pkg.rows.filter(r=>r.phase==='failed').length} 异常`),
      pkg.rows.length>=10?el('input','input',null,{type:'search','aria-label':'筛选组件',placeholder:'筛选组件',value:rowFilter.value,onInput:(e:Event)=>rowFilter.value=(e.target as HTMLInputElement).value}):null,
      !rows.length?el('p','note',query?'没有匹配的组件。':'这个插件包不包含任何组件。'):null,
      ...rows.map(r=>el('article','row',[el('div','rowText',[el('strong','label',r.name),el('p','description',rowDescription(r)||r.entryId||r.id),el('span','status',!r.enabled?'已关闭':phaseText[r.phase||'']||'未运行'),r.readOnlyReason?el('p','note',r.readOnlyReason):null]),el('div','actions',[matching('configuration',{kind:'row',name:pkg.name,rowId:r.id}).length?button('配置 '+r.name,()=>selectedRow.value=r.id):null,pkg.enabled?switcher('启用组件 '+r.name,r.enabled,busy(pkg)||snapshot.value.busy.includes(r.entryId||'')||!!r.readOnlyReason||!r.entryId,()=>void mutation({kind:'enable-row',entryId:r.entryId!,enabled:!r.enabled})):null])],{key:r.id})),
      ...contributed('section',subject),
    ],{key:subjectKey(subject)});
  };
  const rowDetail=(pkg:Package,row:Row)=>{const subject:Subject={kind:'row',name:pkg.name,rowId:row.id};return el('div','detail',[
    el('header','detailHead',[button('返回 '+pkg.title,()=>selectedRow.value=null),el('div','actions',contributed('actions',subject))]),
    el('div','titleRow',[el('h1','title',row.name),...contributed('badge',subject)]),row.name!==row.id?el('code','identity',row.id):null,
    row.moduleName?el('code','identity',row.moduleName):null,rowDescription(row)?el('p','description',rowDescription(row)):null,
    el('section','configuration',contributed('configuration',subject),{'data-plugin-config':subjectKey(subject)}),...contributed('section',subject),
  ],{key:subjectKey(subject),'data-plugin-row-detail':subjectKey(subject)});};
  const itemDetail=(id:string)=>{const subject:Subject={kind:'item',id},definition=((window as any).SaCodeConfiguration.definitions as {namespace:string;title:string}[]).find(d=>d.namespace===id),forms=contributed('configuration',subject);return el('div','detail',[
    el('header','detailHead',[button('返回插件列表',()=>selected.value=null),el('div','actions',contributed('actions',subject))]),
    el('div','titleRow',[el('h1','title',definition?.title||id),...contributed('badge',subject)]),
    el('section','configuration',forms.length?forms:id==='subagent'?h((window as any).SaCodeSubagent.Card):h((window as any).SaCodeConfiguration.Form,{definition}),{'data-plugin-config':subjectKey(subject)}),...contributed('section',subject),
  ],{key:subjectKey(subject),'data-plugin-item-detail':id});};
  const installView=()=>{const i=snapshot.value.install;if(!i.open)return null;const pending=['starting','running','cancelling','applying'].includes(i.phase),editable=i.phase==='idle'||i.phase==='checking',checking=i.phase==='checking';
    const registryInvalid=!!customRegistry.value&&!validRegistry(customRegistry.value);
    const run=()=>{if(!i.spec.trim()||checking||sending.value||registryInvalid)return;void mutation({kind:'run-install'});};
    return h((window as any).SaCodeDialog,{open:true,title:title[i.phase],class:'plugin-manager-install',onClose:()=>void send({kind:'close-install'})},()=>[
      githubRecovery(i)?el('div','recovery',[el('h2','groupTitle',i.failure?.kind==='timeout'?'连接 GitHub 超时':'无法访问 GitHub'),el('p','description','请尝试其他安装来源。'),el('p','note','改用 npm 安装源后，请填入这个插件实际发布的 npm 包名。'),button('试试其他安装来源',()=>{guideOpen.value=true;void mutation({kind:'use-github-mirror'});},{disabled:sending.value})]):editable?el('div','installForm',[
        el('p','description','输入插件的 npm 包名、Git 仓库地址或本地目录路径。'),
        el('input','input',null,{value:i.spec,disabled:checking,'aria-label':'包名或地址','aria-invalid':!!i.inputError,placeholder:'例如 @作者/插件名',onInput:(e:Event)=>void send({kind:'edit-spec',text:(e.target as HTMLInputElement).value}),onCompositionstart:()=>composing=true,onCompositionend:()=>{composing=false;compositionUntil=Date.now()+10;},onBlur:()=>{composing=false;compositionUntil=0;},onKeydown:(e:KeyboardEvent)=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229&&!composing&&Date.now()>=compositionUntil){e.preventDefault();run();}}}),
        i.inputError?el('p','error',i.inputError,{role:'alert'}):null,
        button(guideOpen.value?'收起引导':'插件安装引导和示例',()=>guideOpen.value=!guideOpen.value,{'aria-expanded':guideOpen.value}),guideOpen.value?el('div','guide',[el('h3','groupTitle','填入插件 npm 包名'),el('p','description','填写插件文档中 npm 包名、真实 Git 地址或本机插件目录。'),button('填入示例 @作者/插件名',()=>void send({kind:'edit-spec',text:'@author/sacode-plugin'})),el('p','note','请将示例替换为实际插件包名。')]):null,
        h(RegistryPicker,{open:registryOpen.value&&!checking,busy:checking,value:i.registry,custom:customRegistry.value,options:i.registries,onToggle:()=>registryOpen.value=!registryOpen.value,onClose:()=>registryOpen.value=false,onCustom:(text:string)=>customRegistry.value=text,onChoose:(url:string)=>void send({kind:'choose-registry',url})}),
        el('p','note','请确认插件来源可信。插件以你的权限运行，可能读取本机数据。暂不支持自动更新，升级时需卸载后重新安装。'),button(checking?'正在检查…':'安装',run,{disabled:checking||sending.value||!i.spec.trim()||registryInvalid}),
      ]):el('div','wizard',[
        i.subject?el('article','subject',[el('h3','groupTitle',i.subject.name),el('p','description',builtinDescription(i.subject.name,i.subject.description)),i.subject.version?el('p','note','版本 '+i.subject.version):null]):null,
        i.failure?el('p','error',failureText(i),{role:'alert'}):null,
        i.failure?.uncertainty?el('p','note',i.failure.uncertainty==='acceptance'?'正在等待后端接收安装任务，确认接收后才可确认取消。':i.failure.uncertainty==='cancellation'?(i.phase==='applying'?'取消请求未得到确认；安装已进入收尾阶段，请等待结果。':'尚未确认安装已停止，请重试取消或等待安装结果。'):'未收到安装结果，请核对安装状态。',{role:'status'}):null,
        pending&&(i.attempts?.registries.length||0)>1?el('p','note',`正在改用 ${registryName(i,i.attempts!.registries.at(-1)!)} 重试（第 ${i.attempts!.registries.length} 个源，共 ${i.attempts!.total} 个）`):null,
        i.phase==='unconfirmed'?el('p','note','未收到安装结果，请核对状态后再尝试。'):i.phase==='unknown'?el('p','note','后端当前没有此安装任务。请检查插件列表后再尝试安装。'):i.phase==='applying'?el('p','note','安装已进入收尾阶段，无法取消。'):null,
        i.restartRequired?el('p','note','更改将在下次启动生效'):null,
        i.phase==='done'&&!i.installed?el('p','note','安装完成，没有新增依赖。',{role:'status'}):null,
        i.phase==='done'&&i.approvedBuilds?.length?el('p','note','已允许运行安装脚本：'+i.approvedBuilds.join('、')):null,
        i.runs.length?button(detailsOpen.value?'收起安装详情':'查看安装详情',()=>detailsOpen.value=!detailsOpen.value,{'aria-expanded':detailsOpen.value}):null,
        detailsOpen.value?el('div','runs',i.runs.map(r=>{const lines=r.output.split('\n'),expanded=expandedRuns.value.includes(r.jobId),fold=lines.length>12&&!expanded;return el('section','run',[el('code','identity',r.command),el('p','note',r.cwd),el('pre','terminal',fold?[...lines.slice(0,6),'… '+(lines.length-12)+' 行已折叠 …',...lines.slice(-6)].join('\n'):r.output),lines.length>12?button(expanded?'收起输出':'展开全部输出',()=>expandedRuns.value=expanded?expandedRuns.value.filter(id=>id!==r.jobId):[...expandedRuns.value,r.jobId]):null,r.exitCode!==undefined?el('p','note',r.exitCode===null?'任务已结束，退出码未确认':'退出码 '+r.exitCode):null],{key:r.jobId});})):null,
        el('div','actions',[
          ['starting','running','unconfirmed'].includes(i.phase)?button('取消安装',()=>void send({kind:'cancel-install'}),{disabled:sending.value}):null,
          ['unconfirmed','unknown'].includes(i.phase)?button('核对安装状态',()=>void mutation({kind:'reconcile-install'})):null,
          i.phase==='failed'&&i.failure?.pendingBuilds?.length?el('div','approval',[el('p','note','以下插件安装脚本等待你的授权：'),el('ul','builds',i.failure.pendingBuilds.map(name=>h('li',{key:name},name))),el('p','note','允许后，脚本会以你的权限在本机运行。授权保存在当前配置，之后不再询问；只在信任这些包时允许。'),button('允许这些脚本并重试',()=>void mutation({kind:'approve-builds'}),{disabled:sending.value})]):null,
          i.phase==='failed'&&!i.failure?.pendingBuilds?.length&&i.failure?.failedAt==='registry'?button('更换安装源',()=>{registryOpen.value=true;void mutation({kind:'change-registry'});},{disabled:sending.value}):null,
          i.phase==='failed'&&!i.failure?.pendingBuilds?.length?button('重试',()=>void mutation({kind:'run-install'}),{disabled:sending.value}):null,
          ['failed','unknown'].includes(i.phase)?button('返回编辑',()=>void send({kind:'edit-install'})):null,
          i.phase==='done'&&i.installed?button('立即启用',()=>void mutation({kind:'enable-installed'}),{disabled:sending.value||i.enabling}):null,
          button(['starting','running','unconfirmed'].includes(i.phase)?'取消安装并关闭':pending?'关闭并在后台继续':'关闭',()=>void send({kind:'close-install'})),
        ]),
      ]),actionError.value?el('p','error',actionError.value,{role:'alert'}):null,
    ]);
  };
  return()=>{const pkg=snapshot.value.packages.find(p=>p.name===selected.value),config=selected.value?.startsWith('config:'),row=pkg?.rows.find(r=>r.id===selectedRow.value);return el('div','page',[
    config?itemDetail(selected.value!.slice(7)):pkg?(row?rowDetail(pkg,row):packageDetail(pkg)):[
      el('header','pageHead',[el('div','heading',[el('h1','title','插件'),el('p','description','安装、启用和配置插件')]),el('div','actions',[button('刷新',()=>void mutation({kind:'refresh'}),{disabled:!props.adapter||sending.value}),button('添加插件',()=>void mutation({kind:'open-install'}),{disabled:!snapshot.value.available||sending.value})])]),
      status.value==='unconnected'?el('p','note','仓颉插件安装管理接口尚未接入。以下为官方配置入口，不能据此判断已安装插件。',{role:'status'}):status.value==='loading'?el('p','note','正在读取插件…',{role:'status'}):status.value==='error'?el('div','error',['无法读取全部插件。',button('重试',()=>void read())],{role:'alert'}):!snapshot.value.available?el('p','note','本部署没有可管理的配置，无法安装或启停插件。'):null,
      official(),status.value==='ready'?el('section','group',[el('h2','groupTitle','已安装'),!snapshot.value.packages.some(p=>p.installed)?el('p','note','还没有安装任何插件。'):el('div','cards',snapshot.value.packages.filter(p=>p.installed).map(packageCard))]):null,
    ],refreshFailed.value?el('div','error',['刷新失败，保留上次读取的插件状态。',button('重试刷新',()=>void read())],{role:'alert'}):null,snapshot.value.notice?el('div','notice',[snapshot.value.notice,button('关闭提示',()=>void send({kind:'dismiss-notice'}))],{role:'status'}):null,
    actionError.value&&!snapshot.value.install.open?el('p','error',actionError.value,{role:'alert'}):null,
    snapshot.value.install.phase!=='idle'&&!snapshot.value.install.open?button('查看安装任务',()=>void send({kind:'open-install'})):null,
    installView(),snapshot.value.confirm?h((window as any).SaCodeDialog,{open:true,title:'卸载插件',onClose:()=>void send({kind:'cancel-confirm'})},()=>[el('p','description','确定卸载 '+snapshot.value.confirm+'？'),button('取消',()=>void send({kind:'cancel-confirm'})),button('卸载',()=>void mutation({kind:'confirm-uninstall'}),{disabled:sending.value})]):null,
  ],{'aria-busy':status.value==='loading','data-plugin-manager':''});};
}});
