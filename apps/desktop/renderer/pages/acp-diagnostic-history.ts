import {readAcpDiagnostics} from './acp-diagnostics';
export function checkedAcpDiagnosticHistory(value:any,sessionId:string,peerId='opencode'){
 if(!value||value.version!==1||value.sessionId!==sessionId||(value.peerId??'opencode')!==peerId||value.source!=='durable-history'||typeof value.scopeCurrent!=='boolean')throw Error('ACP 历史诊断身份或格式无效');
 if(value.record===null){if(value.scopeCurrent)throw Error('ACP 空诊断作用域无效');return value;}
 const r=value.record,d=r?.report?.diagnostics;
 if(!r||r.version!==1||r.sessionId!==sessionId||!Number.isSafeInteger(r.revision)||r.revision<1||
 !Number.isSafeInteger(r.scopeRevision)||r.scopeRevision<0||!['pending','kept'].includes(r.decision)||
 !/^acp-[0-9a-f]{32}$/.test(r.diagnosticId)||d?.diagnosticId!==r.diagnosticId||
 r.report.peerId!==peerId||r.report.modelTaskTested!==false||typeof r.report.protocolReady!=='boolean'||!readAcpDiagnostics(d))throw Error('ACP 历史诊断身份或格式无效');
 return value;
}
