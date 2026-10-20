// 合成提供方只决定工具调用；文件读取、修改与命令均交给生产Host，不由夹具代跑。
// shell 变体：'pwsh'（Windows PowerShell）或 'bash'（跨平台 shell）。
module.exports=async function createDevelopmentFixture({project,nodeExecutable,shell='pwsh'}){
  const {createServer}=require('node:http');
  const {writeFileSync}=require('node:fs');
  const {join}=require('node:path');
  const assert=require('node:assert/strict');
  const before='module.exports = (a, b) => a - b;\n';
  const after='module.exports = (a, b) => a + b;\n';
  writeFileSync(join(project,'sum.cjs'),before);
  writeFileSync(join(project,'sum.test.cjs'),"const {test}=require('node:test');const assert=require('node:assert/strict');const sum=require('./sum.cjs');test('相加',()=>assert.equal(sum(2,3),5));\n");
  // pwsh 用 & 调用 + 单引号包裹路径；bash 直接调用 + 转义空格。
  const command=shell==='bash'
    ?nodeExecutable.replaceAll(' ','\\ ')+" --test sum.test.cjs"
    :"& '"+nodeExecutable.replaceAll("'","''")+"' --test 'sum.test.cjs'";
  const edit={path:'sum.cjs',old_string:'a - b',new_string:'a + b'};
  let requests=0;const failures=[],results=[];
  const server=createServer(async(req,res)=>{
    try{
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);requests++;
      assert.ok(requests<=4,'开发任务不得无限重试');
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
      const call=(id,name,args)=>{assert.ok(body.tools.some(t=>t.function.name===name),'工具必须来自实际注册表');emit({choices:[{index:0,delta:{tool_calls:[{index:0,id,function:{name,arguments:JSON.stringify(args)}}]}}]});emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});};
      const result=id=>{const value=body.messages.find(m=>m.role==='tool'&&m.tool_call_id===id)?.content;assert.equal(typeof value,'string');results.push({id,result:value});return value;};
      if(requests===1)call('dev-read','read',{path:'sum.cjs'});
      else if(requests===2){assert.ok(result('dev-read').includes(before.trim()));call('dev-edit','edit',edit);}
      else if(requests===3){
        const editResult=result('dev-edit');
        if(/^ok:/.test(editResult))call('dev-test',shell,{command});
        else {
          // 拒绝、过期等真实结果也是任务结算，不能由夹具断言伪造供应商故障。
          emit({choices:[{index:0,delta:{content:'文件修改未成功执行，测试未运行。\n'+editResult}}]});
          emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
        }
      }
      else{
        const output=result('dev-test');
        const blocked=/SANDBOX_UNAVAILABLE|sandbox-unavailable/i.test(output);
        const failed=blocked||/"error"|io-error|shell-exit-code:[1-9]/.test(output);
        const message=blocked?'文件已修改；安全执行后端不可用，测试未运行。':failed?'文件已修改；测试命令未成功执行，未取得通过结算。\n'+output:'测试工具实际返回：\n'+output;
        emit({choices:[{index:0,delta:{content:message}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
      }
      res.end('data: [DONE]\n\n');
    }catch(error){failures.push(String(error));res.destroy();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return{server,before,after,edit,command,baseUrl:'http://127.0.0.1:'+server.address().port,report:()=>({requests,failures,results}),close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
};
