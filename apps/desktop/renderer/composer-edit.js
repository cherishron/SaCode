// Electron/Chromium 编辑事务：模型替换必须进入输入框自己的撤销栈。
// 直接写 value 会清空原生历史，后续输入后的 Ctrl+Z 无法按顺序恢复。
(function(global){
  'use strict';
  function replace(node,text){
    if(!node||node.value===text)return !!node;
    node.focus();node.setSelectionRange(0,node.value.length);
    const ok=document.execCommand('insertText',false,text);
    return ok&&node.value===text;
  }
  function undo(node,expected){
    if(!node)return false;
    node.focus();
    return document.execCommand('undo')&&node.value===expected;
  }
  global.SaCodeComposerEdit={replace,undo};
})(window);
