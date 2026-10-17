import {defineComponent,h,type PropType} from 'vue';
import {createFileEditor,draftDiff} from './file-editor-state';
export {createFileEditor} from './file-editor-state';
export const FileEditor=defineComponent({props:{editor:{type:Object as PropType<ReturnType<typeof createFileEditor>>,required:true},revision:Number,diffOnly:Boolean},setup(props){return()=>{
  void props.revision;const e=props.editor,s=e.state,diff=draftDiff(s.original,s.draft);
  const review=h('div',{class:'editor-diff',role:'region','aria-label':'保存前差异'},[
    h('div',{class:'editor-diff-summary'},[`移除 ${diff.removed} 行 · 添加 ${diff.added} 行`,h('span',{class:'note'},'当前读取版本与本地草稿；不是 Git 差异')]),
    ...diff.rows.map((r,i)=>h('div',{class:['editor-diff-line','editor-diff-'+r.kind],key:i},[h('span',{class:'editor-line-number'},String(r.old??'')),h('span',{class:'editor-line-number'},String(r.next??'')),h('code',{},(r.kind==='add'?'+':r.kind==='remove'?'-':' ')+r.text)])),
    diff.limited?h('p',{class:'note'},'变更区间过大，只展示前 200 行。'):null,
  ]);
  return h('section',{class:'file-editor','aria-label':props.diffOnly?'保存前差异':'代码编辑'},[
    h('h2',{},props.diffOnly?'保存前差异':'代码编辑'),
    !s.path?h('div',{class:'empty-card'},[h('strong',{},'先打开文件'),h('p',{class:'note'},'在文件预览中点击编辑文件。')]):[
      h('div',{class:'editor-heading'},[h('code',{title:s.path},s.path),h('span',{class:['editor-status',e.dirty()?'is-dirty':'']},s.busy?'处理中':e.dirty()?'未保存':'已读取')]),
      s.error?h('p',{class:'editor-error',role:'alert'},s.error):null,s.notice?h('p',{class:'note',role:'status'},s.notice):null,
      s.loaded?(props.diffOnly||s.review?review:h('textarea',{class:'editor-textarea',spellcheck:false,'aria-label':'文件内容',value:s.draft,disabled:s.busy,onInput:(event:Event)=>e.edit((event.target as HTMLTextAreaElement).value),onKeydown:(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();e.review();}}})):null,
      s.loaded?h('div',{class:'editor-actions'},s.review?[
        h('p',{class:'note'},'仅授权本次写入 '+s.path+'。保存前检查外部修改，保存后回读核对。'),
        h('button',{class:'btn',disabled:s.busy,onClick:e.cancelReview},'返回编辑'),h('button',{class:'btn btn-primary',disabled:s.busy,onClick:e.save},s.busy?'正在保存…':'允许一次并保存'),
      ]:[h('button',{class:'btn',disabled:s.busy||!e.dirty(),onClick:e.discard},'放弃修改'),h('button',{class:'btn',disabled:s.busy||e.dirty(),onClick:()=>e.open(s.path)},'重新读取'),h('button',{class:'btn btn-primary',disabled:s.busy||!e.dirty(),onClick:e.review},'审查并保存')]):null,
      h('p',{class:'note'},'本地草稿不会自动保存；暂存、提交和推送尚未接入。'),
    ],
  ]);
};}});
