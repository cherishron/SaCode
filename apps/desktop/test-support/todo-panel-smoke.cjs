// Todo 展示按核心投影更新；控制式清单不证明真实工具已经接入。
module.exports=async function({win,check,waitFor,outDir}){
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  await check('未接入任务投影时真实输入区不显示示例清单',"({absent:!document.querySelector('.composer [data-todo-panel]')})");
  await js(`const root=document.createElement('div');root.id='todo-fixture';Object.assign(root.style,{position:'fixed',bottom:'140px',left:'430px',width:'580px',zIndex:30,background:'var(--panel-surface)'});document.body.append(root);window.todoFixture={root,items:Vue.ref([]),dots:Vue.ref(false)};const f=todoFixture;f.app=Vue.createApp({setup:()=>()=>[Vue.h(SaCodeTodo.TodoPanel,{todos:f.items.value}),f.dots.value?Vue.h('div',{id:'state-dot-fixture'},['done','warning','error','idle'].map(state=>Vue.h(SaCodeTodo.StateDot,{state,appearance:'step',size:18}))):null]});f.app.mount(root);`);
  await check('空任务投影不显示面板',"({empty:!document.querySelector('#todo-fixture [data-todo-panel]')})");
  await js(`todoFixture.items.value=[{content:'已完成源码核对',status:'completed'},{content:'正在复刻前端',status:'in_progress'},{content:'等待接入后端',status:'pending'}]`);
  await check('任务默认折叠且按三态统计',"({collapsed:document.querySelector('#todo-fixture button').getAttribute('aria-expanded')==='false',noList:!document.querySelector('#todo-fixture ul'),summary:document.querySelector('.todo-progress').textContent==='1 已完成 · 1 进行中 · 1 待处理'})");
  await js(`document.querySelector('#todo-fixture button').focus();document.querySelector('#todo-fixture button').click()`);
  await check('任务展开后状态可读且标记语义正确',"({rows:document.querySelectorAll('.todo-item').length===3,done:document.querySelector('[data-status=completed] [data-state=done]')!==null,ongoing:document.querySelector('[data-status=in_progress] svg[data-state=ongoing]')!==null,idle:document.querySelector('[data-status=pending] [data-state=idle]')!==null,label:document.querySelector('[data-status=pending] [role=img]').getAttribute('aria-label')==='待处理',focus:document.activeElement===document.querySelector('#todo-fixture button')})");
  await js(`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await check('进行中标记同步到文档时间而非各自启动时刻',"({synchronized:[...document.querySelector('[data-state=ongoing]').getAnimations({subtree:true})].every(a=>a.startTime===0),animated:document.querySelector('[data-state=ongoing]').getAnimations({subtree:true}).length===2})");
  await js(`todoFixture.items.value=Array.from({length:14},(_,i)=>({content:i===0?'很长的任务内容'.repeat(35):'并行处理步骤 '+i,status:i<2?'in_progress':'pending'}))`);
  await check('长任务截断且列表高度有限，支持多个进行中',"({summary:document.querySelector('.todo-progress').textContent==='2 进行中 · 12 待处理',overflow:document.querySelector('.todo-list').scrollHeight>document.querySelector('.todo-list').clientHeight,bounded:document.querySelector('.todo-list').getBoundingClientRect().height<=180,ellipsis:getComputedStyle(document.querySelector('.todo-content')).textOverflow==='ellipsis',singleLine:getComputedStyle(document.querySelector('.todo-content')).whiteSpace==='nowrap'})");
  await js(`todoFixture.items.value=[{content:'第一项',status:'completed'},{content:'第二项',status:'completed'}];todoFixture.dots.value=true`);
  await check('宿主任务更新沿用展开状态且省略零计数',"({expanded:document.querySelector('#todo-fixture button').getAttribute('aria-expanded')==='true',summary:document.querySelector('.todo-progress').textContent==='2 已完成',updated:[...document.querySelectorAll('.todo-content')].map(n=>n.textContent).join('|')==='第一项|第二项',readonly:document.querySelectorAll('#todo-fixture button').length===1})");
  await check('共享步骤标记使用已完成勾选与未开始空心圆',"({done:!!document.querySelector('#state-dot-fixture [data-state=done] svg'),idle:!document.querySelector('#state-dot-fixture [data-state=idle] svg'),size:document.querySelector('#state-dot-fixture [data-state=idle]').style.width==='18px'})");
  await js(`await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  require('node:fs').writeFileSync(require('node:path').join(outDir,'todo-panel-fixture.png'),(await win.webContents.capturePage()).toPNG());
  await js(`todoFixture.items.value=[]`);
  await check('任务清空后面板退出',"({empty:!document.querySelector('#todo-fixture [data-todo-panel]')})");
  await js(`todoFixture.app.unmount();todoFixture.root.remove();delete window.todoFixture`);
  await check('任务卸载不残留动画节点',"({removed:!document.querySelector('#todo-fixture')})");
};
