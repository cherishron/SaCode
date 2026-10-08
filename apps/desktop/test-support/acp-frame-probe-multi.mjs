// 通用 ACP 帧格式探针：可指定任意产品 CLI 做帧格式探测。
// 用法：node acp-frame-probe-multi.mjs --cmd <command> --args <arg1> <arg2> ...
// 例如：node acp-frame-probe-multi.mjs --cmd codebuddy --args --acp
//       node acp-frame-probe-multi.mjs --cmd "C:\Users\jingg\.qoder\entry\qoder.cmd" --args --acp
import {spawn} from 'node:child_process';
import {Buffer} from 'node:buffer';

const args=process.argv.slice(2);
let cmd='opencode';
let cmdArgs=['acp'];
for(let i=0;i<args.length;i++){
  if(args[i]==='--cmd'){cmd=args[++i];}
  else if(args[i]==='--args'){cmdArgs=[];while(i+1<args.length&&args[i+1]!=='--cmd'){cmdArgs.push(args[++i]);}}
}
const PROBE_NAME='sacode-acp-frame-probe';
const PROBE_VERSION='0.2.0';
const TOTAL_TIMEOUT_MS=20000;
const requestJson=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:1,client:{name:PROBE_NAME,version:PROBE_VERSION}}});
const ndjsonFrame=requestJson+'\n';
const contentLengthFrame=`Content-Length: ${Buffer.byteLength(requestJson)}\r\n\r\n${requestJson}`;

function probe(){
  return new Promise((resolve)=>{
    const report={target:{cmd,args:cmdArgs},startedAt:new Date().toISOString(),exitCode:null,killed:false,phases:[],verdict:null};
    const child=spawn(cmd,cmdArgs,{stdio:['pipe','pipe','pipe'],shell:true,windowsHide:true});
    const stdoutBufs=[];let stdoutTotal=0;
    const stderrBufs=[];let stderrTotal=0;
    let settled=false;
    child.stdout.on('data',(buf)=>{stdoutBufs.push(buf);stdoutTotal+=buf.length;});
    child.stderr.on('data',(buf)=>{stderrBufs.push(buf);stderrTotal+=buf.length;});
    child.on('error',(err)=>{report.phases.push({phase:'spawn',status:'error',message:err.message});if(!settled){settled=true;resolve(report);}});
    child.on('exit',(code,signal)=>{report.exitCode=code;report.killed=signal!==null;if(!settled){finish();settled=true;resolve(report);}});
    function sendFrame(label,frameBuf){report.phases.push({phase:'send',label,byteLength:frameBuf.length,at:new Date().toISOString()});child.stdin.write(frameBuf);}
    function finish(){
      if(stdoutBufs.length===0){report.verdict={format:'no-response',reason:'stdout 无字节输出',stderrBytes:stderrTotal,
        stderrPreview:Buffer.concat(stderrBufs).subarray(0,512).toString('utf8')};return;}
      const allStdout=Buffer.concat(stdoutBufs);
      const headStr=allStdout.toString('latin1').slice(0,200);
      const clMatch=headStr.match(/Content-Length:\s*(\d+)/i);
      if(clMatch){
        const declaredLen=parseInt(clMatch[1],10);
        const headerEnd=allStdout.indexOf('\r\n\r\n');
        const bodyStart=headerEnd+4;
        report.verdict={format:'content-length',confidence:'high',declaredLength:declaredLen,bodyLength:allStdout.length-bodyStart,
          bodyPreview:allStdout.subarray(bodyStart,bodyStart+Math.min(declaredLen,512)).toString('utf8')};
        try{const parsed=JSON.parse(allStdout.subarray(bodyStart,bodyStart+declaredLen).toString('utf8'));
          report.verdict.parsedJson=parsed;report.verdict.protocolVersion=parsed.result?.protocolVersion;
          report.verdict.agentInfo=parsed.result?.agentInfo||parsed.result?.serverInfo;
          report.verdict.capabilities=parsed.result?.agentCapabilities;
          report.verdict.authMethods=parsed.result?.authMethods;
          report.verdict.error=parsed.error;}catch(e){report.verdict.jsonParseError=e.message;}
      }else{
        const text=allStdout.toString('utf8');
        const lines=text.split('\n').filter(l=>l.trim().length>0);
        if(lines.length>0){
          try{const parsed=JSON.parse(lines[0]);
            report.verdict={format:'ndjson',confidence:'high',lineCount:lines.length,firstLinePreview:lines[0].slice(0,512),parsedJson:parsed,
              protocolVersion:parsed.result?.protocolVersion,agentInfo:parsed.result?.agentInfo||parsed.result?.serverInfo,
              capabilities:parsed.result?.agentCapabilities,authMethods:parsed.result?.authMethods,error:parsed.error};
            if(lines.length>1)report.verdict.additionalLines=lines.slice(1).map(l=>l.slice(0,256));
          }catch(e){report.verdict={format:'unknown',confidence:'low',reason:'非 Content-Length 且非 NDJSON',jsonParseError:e.message,
            firstLinePreview:lines[0]?.slice(0,256),stderrBytes:stderrTotal,stderrPreview:Buffer.concat(stderrBufs).subarray(0,512).toString('utf8')};}
        }else{report.verdict={format:'empty',reason:'stdout 有字节但无有效内容',stderrBytes:stderrTotal};}
      }
    }
    const totalTimer=setTimeout(()=>{report.phases.push({phase:'timeout',status:'total-timeout',at:new Date().toISOString()});finish();report.killed=true;try{child.kill('SIGKILL');}catch(e){}if(!settled){settled=true;resolve(report);}},TOTAL_TIMEOUT_MS);
    setTimeout(()=>{report.phases.push({phase:'observe',status:'idle-wait',stdoutBytesSoFar:stdoutTotal,message:'等待 2s 观察服务端是否主动发帧'});},100);
    setTimeout(()=>{if(child.exitCode!==null||settled)return;sendFrame('ndjson-initialize',Buffer.from(ndjsonFrame,'utf8'));},2000);
    setTimeout(()=>{if(child.exitCode!==null||settled)return;if(stdoutTotal===0){report.phases.push({phase:'observe',status:'no-response-to-ndjson',message:'NDJSON 后 5s 无响应，补发 Content-Length'});sendFrame('content-length-initialize',Buffer.from(contentLengthFrame,'utf8'));}else{report.phases.push({phase:'observe',status:'got-response-to-ndjson',stdoutBytesSoFar:stdoutTotal,message:'NDJSON 有响应'});}},7000);
    setTimeout(()=>{if(child.exitCode!==null||settled){clearTimeout(totalTimer);return;}finish();clearTimeout(totalTimer);try{child.kill('SIGTERM');}catch(e){}setTimeout(()=>{if(!settled){try{child.kill('SIGKILL');}catch(e){}report.killed=true;settled=true;resolve(report);}},1000);},12000);
  });
}
probe().then((report)=>{
  console.log(JSON.stringify(report,null,2));
  if(report.verdict){
    console.log('\n=== 结论 ===');
    console.log(`帧格式: ${report.verdict.format}`);
    console.log(`置信度: ${report.verdict.confidence||'n/a'}`);
    if(report.verdict.protocolVersion)console.log(`协议版本: ${report.verdict.protocolVersion}`);
    if(report.verdict.agentInfo)console.log(`Agent 信息: ${JSON.stringify(report.verdict.agentInfo)}`);
    if(report.verdict.capabilities)console.log(`能力: ${JSON.stringify(report.verdict.capabilities)}`);
    if(report.verdict.authMethods)console.log(`认证方法: ${JSON.stringify(report.verdict.authMethods)}`);
    if(report.verdict.error)console.log(`错误: ${JSON.stringify(report.verdict.error)}`);
    if(report.verdict.stderrPreview)console.log(`stderr 预览: ${report.verdict.stderrPreview.slice(0,256)}`);
  }
  process.exit(0);
}).catch((err)=>{console.error('探针异常:',err);process.exit(1);});