// 只监听 loopback 的合成提供方，供完整桌面卡片验证使用；不连接真实供应商。
module.exports = async function createFixture(output) {
  const {createServer}=require('node:http');
  const {writeFileSync}=require('node:fs');const {join}=require('node:path');
  const assert=require('node:assert/strict');
  let requests=0;const failures=[];
  const report=()=>{
    const result=JSON.stringify({pid:process.pid,requests,failures},null,2);
    writeFileSync(join(output,'question-fixture.json'),result);
    writeFileSync(join(output,'question-fixture-'+process.pid+'.json'),result);
  };
  report();
  const options=[{id:'a',label:'方案甲'},{id:'b',label:'方案乙'}];
  const questions=[{id:'single',question:'选择方向',type:'single',options,allowCustom:true},{id:'multi',question:'选择范围',type:'multi',options},{id:'input',question:'补充说明',type:'input'}];
  const server=createServer(async(req,res)=>{
    try{
      let raw='';for await(const b of req)raw+=b;const body=JSON.parse(raw);requests++;
      res.writeHead(200,{'Content-Type':'text/event-stream'});
      const emit=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
      const ask=(id,items)=>{emit({choices:[{index:0,delta:{tool_calls:[{index:0,id,function:{name:'ask_user_question',arguments:JSON.stringify({questions:items})}}]}}]});emit({choices:[{index:0,delta:{},finish_reason:'tool_calls'}]});};
      if(requests===1){assert.ok(body.tools.some(t=>t.function.name==='ask_user_question'));ask('gui-question-1',questions);}
      else if(requests===2){
        const answers=JSON.parse(body.messages.find(m=>m.role==='tool'&&m.tool_call_id==='gui-question-1').content).answers;
        assert.deepEqual(answers.map(a=>a.selectedIds),[['a'],['a','b'],[]]);
        assert.equal(answers[0].text,'自定义补充');assert.equal(answers[2].text,'GUI 合成输入');
        ask('gui-question-2',[{id:'confirm',question:'是否按上述选择继续？',type:'confirm'}]);
      }else if(requests===3){
        const answers=JSON.parse(body.messages.find(m=>m.role==='tool'&&m.tool_call_id==='gui-question-2').content).answers;
        assert.deepEqual(answers[0].selectedIds,['yes']);
        emit({choices:[{index:0,delta:{content:'选择已收到，原任务继续完成。'}}]});emit({choices:[{index:0,delta:{},finish_reason:'stop'}]});
      }else if(requests===4){ask('gui-question-cancel',[{id:'cancel',question:'这次任务是否继续？',type:'confirm'}]);}
      else throw Error('unexpected-question-retry');
      res.end('data: [DONE]\n\n');
    }catch(e){failures.push(String(e));res.destroy();}
    finally{report();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {server,baseUrl:'http://127.0.0.1:'+server.address().port};
};
