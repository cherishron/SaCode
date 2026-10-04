// 冻结上游 user-text 的展示投影；MIT 许可证见 renderer/assets/dsh-ui-LICENSE.txt。
// 只装饰显示，不修改会话中给模型的原始文本。
import {h,type VNode} from 'vue';
type Range={start:number;end:number;label:string;kind:'session'|'plain';display?:string};
export function projectUserText(text:string,sessionLabels:readonly string[]=[],slashNames:readonly string[]=[],slashKind:'skill'|'command'='skill',references?:{openFile:(path:string)=>void;openSkill:(name:string)=>void}):VNode[] {
  const ranges:Range[]=[];
  for(const wire of text.matchAll(/@\[([^\]\n]+)\]\(dsh-session:[^)\s]+\)/gu))ranges.push({start:wire.index,end:wire.index+wire[0].length,label:wire[0],kind:'session',display:wire[1]});
  for(const label of [...new Set(sessionLabels)].sort((a,b)=>b.length-a.length)){const token='@'+label;for(let start=text.indexOf(token);start>=0;start=text.indexOf(token,start+token.length))ranges.push({start,end:start+token.length,label:token,kind:'session'});}
  for(const token of text.matchAll(/(^|\s)(\/[\w-]+(?=\s|$)|@"[^"\n]+"|@[^\s]+)/gu)){const raw=token[2],label=raw.startsWith('@"')?raw:raw.replace(/[.,;:!?，。；：！？]+$/u,'');if(label.length<=1||(label.startsWith('/')&&!slashNames.includes(label.slice(1))))continue;const start=token.index+token[1].length;ranges.push({start,end:start+label.length,label,kind:'plain'});}
  ranges.sort((a,b)=>a.start-b.start||(a.kind==='session'?0:1)-(b.kind==='session'?0:1)||b.end-a.end);
  const parts:VNode[]=[];let cursor=0;const plain=(from:number,to:number)=>parts.push(h('span',{class:'user-text-run',key:'text-'+from},text.slice(from,to)));
  for(const range of ranges){if(range.start<cursor)continue;if(range.start>cursor)plain(cursor,range.start);const {label}=range;
    const kind=range.kind==='session'?'session':label.startsWith('@')?(label.replace(/^@"|"$/gu,'').endsWith('/')?'folder':'file'):undefined;
    const display=range.display??(kind===undefined?label:kind==='session'?label.slice(1):label.slice(1).replace(/^"|"$/gu,'').split(/[\\/]/u).filter(Boolean).at(-1)??label.slice(1));
    const open=!references?undefined:kind==='file'?()=>references.openFile(label.slice(1).replace(/^"|"$/gu,'')):kind===undefined&&slashKind==='skill'?()=>references.openSkill(label.slice(1)):undefined;
    const iconPath=kind==='session'?'M4 4h16v12H9l-5 4z':kind==='folder'?'M3 5h7l2 3h9v12H3z':'M6 3h8l4 4v14H6zM14 3v5h4';
    parts.push(h(open?'button':'span',{key:range.start,class:'user-text-chip'+(kind===undefined?' user-text-slash':''),'data-ref-chip':kind??slashKind,title:label,...(open?{type:'button',onClick:(e:MouseEvent)=>{if(e.detail>1||(e.detail!==0&&document.getSelection()?.isCollapsed===false))return;open();}}:{})},[
      kind?h('svg',{viewBox:'0 0 24 24',width:16,height:16,fill:'none',stroke:'currentColor','stroke-width':1.5,'aria-hidden':true},[h('path',{d:iconPath})]):null,display,
    ]));cursor=range.end;
  }
  if(!parts.length)plain(0,text.length);else if(cursor<text.length)plain(cursor,text.length);return parts;
}
