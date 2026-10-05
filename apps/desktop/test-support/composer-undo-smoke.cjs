// 用真正 Chromium 编辑与键盘事件验证撤销顺序，不以 defaultPrevented 代替撤销结果。
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sacode-native-undo-'));
const log=process.env.SACODE_UNDO_LOG||path.join(dir,'result.log');
app.whenReady().then(async()=>{let win;try{
 const html=path.join(dir,'index.html');fs.writeFileSync(html,`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'"><textarea id="composer"></textarea><script src="${pathToFileURL(path.resolve(__dirname,'../renderer/composer-edit.js')).href}"></script>`);
 win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await win.loadFile(html);
 const js=s=>win.webContents.executeJavaScript(s,true),value=()=>js("document.querySelector('textarea').value");
 const check=async(expected)=>{await new Promise(r=>setTimeout(r,80));if(await value()!==expected)throw Error(`撤销结果不符：expected=${expected}, actual=${await value()}`);};
 await js("document.querySelector('textarea').value='原始草稿';SaCodeComposerEdit.replace(document.querySelector('textarea'),'增强草稿')");await check('增强草稿');
 await js("document.querySelector('textarea').setSelectionRange(4,4);document.execCommand('insertText',false,'补充')");await check('增强草稿补充');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Z',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Z',modifiers:['control']});await check('增强草稿');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Z',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Z',modifiers:['control']});await check('原始草稿');
 fs.writeFileSync(log,'NATIVE_UNDO PASS 4 checks\n');win.destroy();app.exit(0);
 }catch(e){fs.writeFileSync(log,'NATIVE_UNDO FAIL '+e.stack);if(win)win.destroy();app.exit(1);}});
