import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const window={};
vm.runInNewContext(readFileSync(new URL('../renderer/tooltip.js',import.meta.url),'utf8'),{window});
const fit=window.SaCodeTooltip.fit;
test('上方放不下时翻到下方，底部不足时翻到上方，间距仍为八像素',()=>{
  const top=fit({left:400,right:424,top:8,bottom:32},{width:120,height:26},{width:860,height:600},{side:'top'});
  assert.equal(top.side,'bottom');assert.equal(top.top,40);
  const bottom=fit({left:400,right:424,top:560,bottom:584},{width:120,height:26},{width:860,height:600},{side:'bottom'});
  assert.equal(bottom.side,'top');assert.equal(bottom.top,526);
});
test('视口四角的三种方向与长提示均保留十二像素安全边距',()=>{
  for(const anchor of [{left:0,right:24,top:0,bottom:24},{left:836,right:860,top:0,bottom:24},{left:0,right:24,top:576,bottom:600},{left:836,right:860,top:576,bottom:600}]){
    for(const side of ['top','bottom','right']){
      const size={width:430,height:96},pos=fit(anchor,size,{width:860,height:600},{side});
      assert.ok(pos.left>=12&&pos.left+size.width<=848);
      assert.ok(pos.top>=12&&pos.top+size.height<=588);
    }
  }
});
test('居中与末端对齐分别保持锚点中心和右缘，右侧提示居中且间距十像素',()=>{
  const anchor={left:400,right:424,top:250,bottom:274},size={width:120,height:26},viewport={width:860,height:600};
  const center=fit(anchor,size,viewport,{side:'top'}),end=fit(anchor,size,viewport,{side:'top',align:'end'}),right=fit(anchor,size,viewport);
  assert.equal(center.left+60,412);assert.equal(end.left+120,424);assert.equal(right.left,434);assert.equal(right.top+13,262);
});
