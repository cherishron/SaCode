// ACP 帧格式探针：spawn 真实 opencode acp 进程，发 initialize，抓原始 stdout 字节，
// 判定帧编解码是 Content-Length 头帧还是 NDJSON（单行 JSON + \n）。
// 仅做协议探测（initialize），不发 session/prompt 委派任务。
import {spawn} from 'node:child_process';
import {Buffer} from 'node:buffer';

const PROBE_NAME='sacode-acp-frame-probe';
const PROBE_VERSION='0.1.0';
const OPENCODE_CMD='opencode';
const OPENCODE_ARGS=['acp'];
const TOTAL_TIMEOUT_MS=20000;

// JSON-RPC 2.0 initialize 请求体
const initializeRequest={
  jsonrpc:'2.0',
  id:1,
  method:'initialize',
  params:{
    protocolVersion:1,
    client:{name:PROBE_NAME,version:PROBE_VERSION}
  }
};
const requestJson=JSON.stringify(initializeRequest);

// NDJSON 帧：JSON + \n
const ndjsonFrame=requestJson+'\n';

// Content-Length 头帧：Content-Length: <n>\r\n\r\n<json>
const contentLengthFrame=`Content-Length: ${Buffer.byteLength(requestJson)}\r\n\r\n${requestJson}`;

function main(){
  return new Promise((resolve)=>{
    const report={
      probeName:PROBE_NAME,
      probeVersion:PROBE_VERSION,
      target:{cmd:OPENCODE_CMD,args:OPENCODE_ARGS},
      startedAt:new Date().toISOString(),
      exitCode:null,
      killed:false,
      stdoutChunks:[],
      stderrChunks:[],
      stdoutTotalBytes:0,
      stderrTotalBytes:0,
      phases:[],
      verdict:null,
      rawHexPreview:null,
      rawTextPreview:null
    };

    const child=spawn(OPENCODE_CMD,OPENCODE_ARGS,{
      stdio:['pipe','pipe','pipe'],
      shell:true,
      windowsHide:true
    });

    const stdoutBufs=[];
    let stdoutTotal=0;
    const stderrBufs=[];
    let stderrTotal=0;
    let settled=false;

    child.stdout.on('data',(buf)=>{
      stdoutBufs.push(buf);
      stdoutTotal+=buf.length;
      report.stdoutTotalBytes=stdoutTotal;
    });
    child.stderr.on('data',(buf)=>{
      stderrBufs.push(buf);
      stderrTotal+=buf.length;
      report.stderrTotalBytes=stderrTotal;
    });

    child.on('error',(err)=>{
      report.phases.push({phase:'spawn',status:'error',message:err.message});
      if(!settled){settled=true;resolve(report);}
    });
    child.on('exit',(code,signal)=>{
      report.exitCode=code;
      report.killed=signal!==null&&signal!==undefined;
      if(!settled){
        // 进程退出但可能还没分析，先完成分析再 resolve
        finishAnalysis();
        settled=true;
        resolve(report);
      }
    });

    function sendFrame(label,frameBuf){
      report.phases.push({phase:'send',label,byteLength:frameBuf.length,at:new Date().toISOString()});
      child.stdin.write(frameBuf);
    }

    function finishAnalysis(){
      if(stdoutBufs.length===0){
        report.verdict={format:'no-response',reason:'stdout 无任何字节输出'};
        return;
      }
      const allStdout=Buffer.concat(stdoutBufs);
      report.rawHexPreview=allStdout.subarray(0,256).toString('hex');
      report.rawTextPreview=allStdout.subarray(0,512).toString('utf8');

      // 判定逻辑：先找 Content-Length 头
      const headStr=allStdout.toString('latin1').slice(0,200);
      const clMatch=headStr.match(/Content-Length:\s*(\d+)/i);

      if(clMatch){
        const declaredLen=parseInt(clMatch[1],10);
        const headerEnd=allStdout.indexOf('\r\n\r\n');
        const bodyStart=headerEnd+4;
        const actualBodyLen=allStdout.length-bodyStart;
        report.verdict={
          format:'content-length',
          confidence:'high',
          declaredLength:declaredLen,
          actualBodyLength:actualBodyLen,
          headerEndOffset:headerEnd,
          bodyStartOffset:bodyStart,
          bodyPreview:allStdout.subarray(bodyStart,bodyStart+Math.min(declaredLen,512)).toString('utf8')
        };
        // 尝试解析 JSON
        try{
          const bodyStr=allStdout.subarray(bodyStart,bodyStart+declaredLen).toString('utf8');
          const parsed=JSON.parse(bodyStr);
          report.verdict.parsedJson=parsed;
          report.verdict.jsonrpcVersion=parsed.jsonrpc;
          report.verdict.responseMethod=parsed.method;
          report.verdict.responseId=parsed.id;
          if(parsed.result){
            report.verdict.protocolVersion=parsed.result.protocolVersion;
            report.verdict.serverInfo=parsed.result.server||parsed.result.serverInfo;
            report.verdict.capabilities=parsed.result.capabilities;
          }
          if(parsed.error){
            report.verdict.error=parsed.error;
          }
        }catch(e){
          report.verdict.jsonParseError=e.message;
        }
      } else {
        // 尝试 NDJSON：按 \n 分割
        const text=allStdout.toString('utf8');
        const lines=text.split('\n').filter(l=>l.trim().length>0);
        if(lines.length>0){
          // 尝试解析第一行为 JSON
          try{
            const parsed=JSON.parse(lines[0]);
            report.verdict={
              format:'ndjson',
              confidence:'high',
              lineCount:lines.length,
              firstLinePreview:lines[0].slice(0,512),
              parsedJson:parsed,
              jsonrpcVersion:parsed.jsonrpc,
              responseMethod:parsed.method,
              responseId:parsed.id
            };
            if(parsed.result){
              report.verdict.protocolVersion=parsed.result.protocolVersion;
              report.verdict.serverInfo=parsed.result.server||parsed.result.serverInfo;
              report.verdict.capabilities=parsed.result.capabilities;
            }
            if(parsed.error){
              report.verdict.error=parsed.error;
            }
            // 如果有多行，也记录
            if(lines.length>1){
              report.verdict.additionalLines=lines.slice(1).map(l=>l.slice(0,256));
            }
          }catch(e){
            // 既不是 Content-Length 也不是 NDJSON
            report.verdict={
              format:'unknown',
              confidence:'low',
              reason:'无法匹配 Content-Length 头，也无法按行解析 JSON',
              jsonParseError:e.message,
              firstLinePreview:lines[0]?lines[0].slice(0,256):null
            };
          }
        } else {
          report.verdict={format:'empty',reason:'stdout 有字节但无有效内容'};
        }
      }
    }

    // 总超时
    const totalTimer=setTimeout(()=>{
      report.phases.push({phase:'timeout',status:'total-timeout',at:new Date().toISOString(),message:`${TOTAL_TIMEOUT_MS}ms 超时，强制结束`});
      // 分析已有数据
      finishAnalysis();
      report.killed=true;
      try{child.kill('SIGKILL');}catch(e){}
      if(!settled){settled=true;resolve(report);}
    },TOTAL_TIMEOUT_MS);

    // 阶段 0：等待 2 秒看服务端是否主动发数据（有些 ACP 实现会先发 greeting）
    setTimeout(()=>{
      report.phases.push({phase:'observe',status:'idle-wait',at:new Date().toISOString(),stdoutBytesSoFar:stdoutTotal,message:'等待 2s 观察服务端是否主动发帧'});
    },100);

    // 阶段 1：先发 NDJSON 帧（本仓 ExtProcess 惯用格式）
    setTimeout(()=>{
      if(child.exitCode!==null||settled)return;
      sendFrame('ndjson-initialize',Buffer.from(ndjsonFrame,'utf8'));
    },2000);

    // 阶段 2：5 秒后若无 stdout 响应，补发 Content-Length 帧
    setTimeout(()=>{
      if(child.exitCode!==null||settled)return;
      if(stdoutTotal===0){
        report.phases.push({phase:'observe',status:'no-response-to-ndjson',at:new Date().toISOString(),message:'NDJSON 帧后 5s 无响应，补发 Content-Length 帧'});
        sendFrame('content-length-initialize',Buffer.from(contentLengthFrame,'utf8'));
      } else {
        report.phases.push({phase:'observe',status:'got-response-to-ndjson',at:new Date().toISOString(),stdoutBytesSoFar:stdoutTotal,message:'NDJSON 帧已有响应，跳过 Content-Length 探测'});
      }
    },7000);

    // 阶段 3：再等 5 秒收集数据，然后分析并结束
    setTimeout(()=>{
      if(child.exitCode!==null||settled){
        clearTimeout(totalTimer);
        return;
      }
      report.phases.push({phase:'analyze',status:'collecting',at:new Date().toISOString(),stdoutBytesSoFar:stdoutTotal});
      finishAnalysis();
      clearTimeout(totalTimer);
      try{child.kill('SIGTERM');}catch(e){}
      // 给进程 1 秒优雅退出
      setTimeout(()=>{
        if(!settled){
          try{child.kill('SIGKILL');}catch(e){}
          report.killed=true;
          settled=true;
          resolve(report);
        }
      },1000);
    },12000);
  });
}

// 运行
main().then((report)=>{
  console.log('=== ACP 帧格式探针报告 ===');
  console.log(JSON.stringify(report,null,2));
  if(report.verdict){
    console.log('\n=== 结论摘要 ===');
    console.log(`帧格式: ${report.verdict.format}`);
    console.log(`置信度: ${report.verdict.confidence||'n/a'}`);
    if(report.verdict.protocolVersion)console.log(`协议版本: ${report.verdict.protocolVersion}`);
    if(report.verdict.serverInfo)console.log(`服务端信息: ${JSON.stringify(report.verdict.serverInfo)}`);
    if(report.verdict.capabilities)console.log(`能力清单: ${JSON.stringify(report.verdict.capabilities)}`);
    if(report.verdict.error)console.log(`错误: ${JSON.stringify(report.verdict.error)}`);
    if(report.verdict.reason)console.log(`原因: ${report.verdict.reason}`);
  }
  process.exit(0);
}).catch((err)=>{
  console.error('探针异常:',err);
  process.exit(1);
});