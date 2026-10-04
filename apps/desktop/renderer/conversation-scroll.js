/* 会话阅读位置属于 UI：不写核心日志。按冻结官方 ui-chat 的阅读策略，
 * 首次打开跟随尾部、用户上翻停止跟随、自有输入恢复跟随、按消息锚点恢复会话。
 * 当前投影尚无分页/turn 导航，因此这里只管理已经加载的消息。 */
"use strict";
(function (root) {
  const owners = new WeakMap(), memory = new Map();
  const threshold = 25; // 官方 use-chat-reading：FOLLOW_THRESHOLD + 1。
  function attach(node, binding) {
    let session, lastUser, following = true, position = null, frame = 0, landed = 0;
    let value = binding, disposed = false;
    const metrics = () => ({top:node.scrollTop,floor:Math.max(0,node.scrollHeight-node.clientHeight)});
    const anchors = () => [...node.querySelectorAll('[data-msg-id]')];
    function publish() {
      node.dataset.followingTail = String(following);
      value.onChange?.(following);
    }
    function capture() {
      const top = node.getBoundingClientRect().top;
      const items = anchors(), anchor = items.find(e=>e.getBoundingClientRect().bottom>top) || items.at(-1);
      return {top:node.scrollTop,id:anchor?.dataset.msgId,offset:anchor ? anchor.getBoundingClientRect().top-top : 0};
    }
    function remember() { memory.set(session,following ? null : position); }
    function jump(top) {
      node.scrollTop = Math.max(0,Math.min(metrics().floor,top));
      landed = node.scrollTop;
    }
    function reconcile() {
      frame = 0;
      if(disposed || !node.clientHeight) return;
      if(following) jump(metrics().floor);
      else if(position) {
        const anchor=anchors().find(e=>e.dataset.msgId===position.id);
        jump(anchor ? node.scrollTop+anchor.getBoundingClientRect().top-node.getBoundingClientRect().top-position.offset : position.top);
        position=capture();
      }
      remember(); publish();
    }
    function schedule() { if(!frame) frame=requestAnimationFrame(reconcile); }
    function update(next) {
      value=next;
      if(session!==next.session) {
        session=next.session; lastUser=next.lastUser;
        position=memory.get(session) || null; following=position===null;
      } else if(next.lastUser!==lastUser) {
        lastUser=next.lastUser; following=true; position=null;
      }
      schedule();
    }
    function onScroll() {
      const m=metrics();
      // 布局补偿的 scroll 事件不算读者移动；底部扩容也不释放跟随意图。
      if(Math.abs(m.top-landed)<=.5) return;
      following=m.floor-m.top<=threshold;
      landed=m.top; position=following ? null : capture();
      remember(); publish();
    }
    // 滚轮先暂停待执行的尾部定位；没有实际位移时不改变跟随意图。
    function intent() { if(frame) {cancelAnimationFrame(frame);frame=0;} }
    node.addEventListener('scroll',onScroll,{passive:true});
    for(const type of ['wheel','touchstart','pointerdown','keydown']) node.addEventListener(type,intent,{passive:true});
    const observer=new ResizeObserver(schedule);
    observer.observe(node);
    for(const child of node.children) observer.observe(child);
    update(binding);
    const owner={update,toBottom(){following=true;position=null;remember();reconcile();},dispose(){
      disposed=true;cancelAnimationFrame(frame);observer.disconnect();
      node.removeEventListener('scroll',onScroll);
      for(const type of ['wheel','touchstart','pointerdown','keydown']) node.removeEventListener(type,intent);
      owners.delete(node);
    }};
    owners.set(node,owner);return owner;
  }
  root.SaCodeConversationScroll={attach,toBottom(node){owners.get(node)?.toBottom();},directive:{
    mounted(node,binding){attach(node,binding.value);},
    updated(node,binding){owners.get(node)?.update(binding.value);},
    beforeUnmount(node){owners.get(node)?.dispose();},
  }};
})(window);
