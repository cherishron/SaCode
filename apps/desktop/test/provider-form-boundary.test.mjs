// 执行实际表单校验函数，与主进程字段边界对账。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source=readFileSync(new URL('../renderer/pages/provider-settings.ts',import.meta.url),'utf8');
const validation=source.slice(source.indexOf('export function validateProvider'),source.indexOf('// --- UI 辅助 ---'));
const {validateProvider}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(validation)).toString('base64'));
const base={id:'mine',name:'供应商',baseUrl:'https://example.com/v1',protocol:'openai-completions',transport:'direct',key:'valid-key',sortOrder:1,declared:false,models:[{id:'m',name:'模型',contextWindow:'',maxTokens:'',image:false}]};
test('合法新增及不更换密钥的编辑可保存',()=>{assert.equal(validateProvider(base,[],false),'');assert.equal(validateProvider({...base,key:''},[],true),'');});
test('ID 名称 地址和密钥超过主进程长度上限时拒绝',()=>{for(const [field,value] of [['id','a'.repeat(65)],['name','名'.repeat(101)],['baseUrl','https://example.com/'+ 'a'.repeat(512)],['key','a'.repeat(4097)]])assert.notEqual(validateProvider({...base,[field]:value},[],false),'',field);});
test('排序超出主进程范围及非整数被拒绝',()=>{for(const sortOrder of [-1,0.5,1000000001,NaN])assert.notEqual(validateProvider({...base,sortOrder},[],false),'');assert.equal(validateProvider({...base,sortOrder:1000000000},[],false),'');});
test('非法协议与传输方式不能保存',()=>{assert.notEqual(validateProvider({...base,protocol:'unknown'},[],false),'');assert.notEqual(validateProvider({...base,transport:'unknown'},[],false),'');});
test('密钥控制字符与地址中的凭据拒绝',()=>{assert.notEqual(validateProvider({...base,key:'key\nvalue'},[],false),'');assert.notEqual(validateProvider({...base,baseUrl:'https://user:secret@example.com'},[],false),'');});
test('新增重复 ID 拒绝，编辑原 ID 允许',()=>{assert.notEqual(validateProvider(base,[base],false),'');assert.equal(validateProvider(base,[base],true),'');});

test('模型数量和模型身份边界拒绝无效条目',()=>{for(const models of [[],Array(129).fill(base.models[0]),[{...base.models[0],id:''}],[{...base.models[0],id:'x'.repeat(201)}],[{...base.models[0],name:'x'.repeat(101)}]])assert.notEqual(validateProvider({...base,models},[],false),'');});
test('模型结构能力枚举重复能力和密钥槽拒绝',()=>{for(const patch of [{contextWindow:1},{maxTokens:null},{image:'true'},{supports:['tools','tools']},{inputModalities:['unknown']},{availability:'invalid'},{meterUnit:'invalid'},{provenance:'invalid'},{apiKey:'secret'}])assert.notEqual(validateProvider({...base,models:[{...base.models[0],...patch}]},[],false),'');});
test('内置供应商启停不要求编辑只读模型目录',()=>{assert.equal(validateProvider({...base,declared:true,models:[],key:''},[],true),'');});
