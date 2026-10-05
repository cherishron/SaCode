import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('../../../scripts/pack-host.mjs',import.meta.url));
function fixture(pthread,explicit=false){
 const root=mkdtempSync(join(tmpdir(),'sacode-pack-host-')),dll=join(root,'runtime'),lookup=join(root,'lookup'),exe=join(root,'host.exe'),out=join(root,'packed');
 mkdirSync(dll);mkdirSync(lookup);writeFileSync(exe,'host');writeFileSync(join(dll,'libcangjie-runtime.dll'),'cj');
 for(const file of ['libcrypto-3-x64.dll','libssl-3-x64.dll'])writeFileSync(join(lookup,file),file);
 if(pthread)writeFileSync(join(explicit?dll:lookup,'libwinpthread-1.dll'),'pthread-runtime');
 const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env.PATH=lookup;
 return {result:spawnSync(process.execPath,[script,exe,out,dll],{env,encoding:'utf8'}),out};
}
test('缺少 stdx TLS 的 pthread 依赖时拒绝宣称 Host 自包含',()=>{
 const {result}=fixture(false);assert.equal(result.status,1);assert.match(result.stderr,/libwinpthread-1\.dll/);
});
test('Host 从构建环境发现 pthread 并实际带入发布目录',()=>{
 const {result,out}=fixture(true);assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(join(out,'bin','libwinpthread-1.dll'),'utf8'),'pthread-runtime');
});
test('显式 DLL 目录已有运行库时不要求 PATH 再提供一份',()=>{
 const {result,out}=fixture(true,true);assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(join(out,'bin','libwinpthread-1.dll'),'utf8'),'pthread-runtime');
});
