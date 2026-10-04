// 冻结 DSH CodeToolbar / CodeBlock 的 Vue runtime 适配，图形沿用其 MIT 授权。
"use strict";
window.SaCodeCodeBlock = (function () {
  const {h,ref,onBeforeUnmount}=window.Vue;
  const paths={
    copy:[['rect',{x:'1.52075',y:'4.07373',width:'10.3932',height:'10.3932',rx:'2',stroke:'currentColor'}],['path',{d:'M11.9792 1.53296C13.36 1.53296 14.4792 2.65225 14.4792 4.03296V9.42847C14.4792 10.3756 13.9521 11.1987 13.1755 11.6228V10.3298C13.3652 10.0787 13.4792 9.7674 13.4792 9.42847V4.03296C13.4792 3.20453 12.8077 2.53296 11.9792 2.53296H6.58374C6.27966 2.53301 5.99684 2.6235 5.7605 2.77905H4.42358C4.85652 2.03463 5.66056 1.53304 6.58374 1.53296H11.9792Z',fill:'currentColor'}]],
    check:[['path',{d:'M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4',stroke:'currentColor'}]],
    nowrap:[['path',{d:'M2 15H1V1H2V15Z M15 15H14V1H15V15Z',fill:'currentColor'}],['path',{d:'M12.3535 7.64645C12.5487 7.84171 12.5487 8.15829 12.3535 8.35355L9.85352 10.8535L9.14648 10.1465L10.793 8.5H3.5V7.5H10.793L9.14648 5.85352L9.85352 5.14648L12.3535 7.64645Z',fill:'currentColor'}]],
    wrap:[['path',{d:'M2 15H1V1H2V15Z M15 15H14V1H15V15Z',fill:'currentColor'}],['path',{d:'M10.9999 8C10.9999 6.89543 10.1046 6 9 6H4.5V5H9C10.6568 5 11.9999 6.34315 11.9999 8C11.9999 9.65685 10.6568 11 9 11H6.20703L6.85351 11.6465L6.14648 12.3535L4.64652 10.8536C4.45126 10.6583 4.45126 10.3417 4.64652 10.1464L6.14648 8.64648L6.85351 9.35352L6.20703 10H9C10.1046 10 10.9999 9.10457 10.9999 8Z',fill:'currentColor'}]],
  };
  const icon=name=>h('svg',{width:14,height:14,viewBox:'0 0 16 16',fill:'none','stroke-width':1,'aria-hidden':'true'},paths[name].map(([tag,props])=>h(tag,props)));
  async function writeClipboard(text) {
    if(window.navigator.clipboard?.writeText){try{await window.navigator.clipboard.writeText(text);return true;}catch{return false;}}
    const doc=window.document;
    if(typeof doc?.execCommand!=='function')return false;
    const previous=doc.activeElement,selection=doc.getSelection(),ranges=[];
    for(let i=0;i<(selection?.rangeCount||0);i++)ranges.push(selection.getRangeAt(i).cloneRange());
    const node=doc.createElement('textarea');node.value=text;node.readOnly=true;node.className='code-copy-fallback';doc.body.append(node);node.select();
    try{return doc.execCommand('copy');}catch{return false;}finally{
      node.remove();previous?.focus({preventScroll:true});
      if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}
    }
  }
  const Component={
    props:{code:{type:String,default:''},lang:{type:String,default:''}},
    setup(props){
      const wrapped=ref(true),copied=ref(false),busy=ref(false),error=ref('');let timer,alive=true;
      onBeforeUnmount(()=>{alive=false;window.clearTimeout(timer);});
      const copy=async()=>{
        if(busy.value||copied.value)return;
        busy.value=true;error.value='';
        const ok=await writeClipboard(props.code);
        if(!alive)return;
        busy.value=false;
        if(!ok){error.value='复制失败，请重试';return;}
        copied.value=true;timer=window.setTimeout(()=>{copied.value=false;},1000);
      };
      return ()=>{
        const lines=window.SaCodeCodeHighlighter.highlight(props.code,props.lang);
        const children=lines?lines.flatMap((line,index)=>[...(index?['\n']:[]),h('span',{class:'code-line'},line.map(span=>h('span',{style:span.style},span.text)))]):props.code;
        const wrapLabel=wrapped.value?'取消自动换行':'自动换行',copyLabel=copied.value?'已复制':'复制代码';
        return h('div',{class:'markdown-code-card','data-code-wrap':String(wrapped.value)},[
          h('div',{class:'code-toolbar','data-code-block-banner':''},[
            h('span',{class:'code-language'},window.SaCodeCodeHighlighter.grammarForHint(props.lang)?props.lang:'代码'),
            h('div',{class:'code-actions'},[
              window.SaCodeTooltip.wrap(h('button',{type:'button',class:'code-action code-wrap','aria-label':'自动换行','aria-pressed':wrapped.value,onClick:()=>{wrapped.value=!wrapped.value;}},[icon(wrapped.value?'nowrap':'wrap')]),{label:wrapLabel,side:'top'}),
              window.SaCodeTooltip.wrap(h('button',{type:'button',class:'code-action code-copy','aria-label':copyLabel,disabled:busy.value,onClick:copy},[icon(copied.value?'check':'copy')]),{label:copyLabel,side:'top'}),
            ]),
          ]),
          h('div',{class:'code-content','data-code-block-content':''},[h('pre',{class:lines?'shiki':'code-plain',tabindex:0,'data-code-language':props.lang},[h('code',{},children)])]),
          error.value?h('span',{class:'code-copy-error',role:'alert'},error.value):null,
          h('span',{class:'code-copy-status',role:'status','aria-live':'polite'},copied.value?'已复制':''),
        ]);
      };
    },
  };
  return {Component,writeClipboard};
})();
