import test from 'node:test';
import assert from 'node:assert/strict';
import frame from '../renderer/frame.js';

test('关闭右栏后中央获得全部剩余宽度，左栏偏好仍受官方范围约束',()=>{
  assert.deepEqual(frame.columns(1280,280,0),{sidebar:280,center:1000,rightbar:0});
  assert.deepEqual(frame.columns(1280,0,0),{sidebar:56,center:1224,rightbar:0});
  assert.deepEqual(frame.columns(1280,0,0,0),{sidebar:0,center:1280,rightbar:0});
  assert.equal(frame.columns(1280,184,0).sidebar,264);
  assert.equal(frame.columns(1280,800,0).sidebar,420);
});
test('右栏优先缩小和关闭，避免挤穿中央 400px 最小宽度',()=>{
  assert.deepEqual(frame.columns(1000,280,450),{sidebar:280,center:400,rightbar:320});
  assert.deepEqual(frame.columns(970,280,450),{sidebar:280,center:690,rightbar:0});
  assert.deepEqual(frame.columns(1800,280,810),{sidebar:280,center:710,rightbar:810});
  for(let width=860;width<=2000;width+=13) for(const sidebar of [0,264,280,420]) for(const collapsedWidth of [0,56]) {
    const cols=frame.columns(width,sidebar,width*.45,collapsedWidth);
    assert.equal(cols.sidebar+cols.center+cols.rightbar,width);
    if(cols.rightbar) {assert.ok(cols.center>=400); assert.ok(cols.rightbar>=300); assert.ok(cols.rightbar<=width*.7);}
  }
});
