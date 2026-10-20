import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ctx={};vm.runInNewContext(readFileSync(new URL('../../renderer/side-panels.js',import.meta.url),'utf8'),ctx);
const el=(tag,cls,children,props={})=>({tag,cls,children,props});
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.children)];
test('模型审批在当前运行会话展示完整参数并复用精确应答入口',()=>{
 const decisions=[],self={scrollSession:'s1',turn:{running:true},approval:{source:'model',sessionId:'s1',name:'edit',approvalId:17,displayArguments:'{\n "path":"a.txt", "old_string":"甲", "new_string":"乙"\n}'},answerTool:v=>decisions.push(v)};
 const card=ctx.SaCodeSidePanels.renderApprovalCard(self,{el});
 const rows=nodes(card);assert.equal(rows.find(n=>n.tag==='pre').children,self.approval.displayArguments);
 rows.find(n=>n.props.id==='allow-once').props.onClick();rows.find(n=>n.props.id==='deny').props.onClick();
 assert.deepEqual(decisions,['allowed-once','denied']);assert.equal(card.props['aria-label'],'当前工具调用审批');
 self.scrollSession='s2';assert.equal(ctx.SaCodeSidePanels.renderApprovalCard(self,{el}),null);
 self.scrollSession='s1';self.turn.running=false;assert.equal(ctx.SaCodeSidePanels.renderApprovalCard(self,{el}),null);
 self.approval=null;assert.equal(ctx.SaCodeSidePanels.renderApprovalCard(self,{el}),null);
});
