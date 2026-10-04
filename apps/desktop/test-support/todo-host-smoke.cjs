// 真实会话日志 -> 仓颉 Host -> 有限 IPC -> 产品 Todo 面板，非控制式 Vue 夹具。
module.exports=async function({win,bridge,waitFor,check}) {
  const js=code=>win.webContents.executeJavaScript(code,true);
  const current=await js("document.querySelector('[data-sidebar-session][aria-current=page]').dataset.sidebarSession");
  const other=await js(`[...document.querySelectorAll('[data-sidebar-session]')].find(n=>n.dataset.sidebarSession!==${JSON.stringify(current)}).dataset.sidebarSession`);
  async function reload() {
    for (const id of [other,current]) {
      await js(`document.querySelector('[data-sidebar-session="'+${JSON.stringify(id)}+'"]').click()`);
      await waitFor(`document.querySelector('[data-sidebar-session][aria-current=page]')?.dataset.sidebarSession===${JSON.stringify(id)} && !document.querySelector('#sidebar-new-session').disabled`);
    }
  }
  await bridge.request('session/append',{eventType:'todo/write',data:JSON.stringify({todos:[{content:'真实仓颉任务',status:'in_progress'},{content:'后端已回放',status:'completed'}]})});
  await reload();
  await waitFor("!!document.querySelector('.composer [data-todo-panel]')");
  await js("document.querySelector('.composer [data-todo-panel] button').click()");
  await check('真实 Host 任务投影显示在产品输入区',"(()=>{const panel=document.querySelector('.composer [data-todo-panel]');return {contents:panel.textContent.includes('真实仓颉任务')&&panel.textContent.includes('后端已回放'),counts:panel.querySelector('.todo-progress').textContent==='1 已完成 · 1 进行中',readonly:panel.querySelectorAll('button').length===1}})()");
  await bridge.request('session/append',{eventType:'turn/start',data:''});
  await reload();
  await check('真实 Host 新轮次清空产品任务面板',"({cleared:!document.querySelector('.composer [data-todo-panel]')})");
};
