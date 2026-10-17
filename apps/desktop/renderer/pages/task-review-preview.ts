// 预览仅接受当前任务清单中的对象身份，限制返回体，迟到结果由调用方丢弃。
export function decodeReviewPreview(value:any,task:any,row:any,side:'before'|'after'){
 const expected=row[side+'Digest'],missing=expected==='';
 if(!value||value.version!==1||value.sessionId!==task.sessionId||value.executionId!==task.executionId||value.revision!==task.revision||value.path!==row.path||value.side!==side||value.sha256!==expected||value.exists!==!missing||!Number.isSafeInteger(value.totalBytes)||value.totalBytes<0||value.totalBytes>8388608||!Number.isSafeInteger(value.returnedBytes)||value.returnedBytes<0||value.returnedBytes>65536||value.returnedBytes>value.totalBytes||value.truncated!==(value.returnedBytes<value.totalBytes)||typeof value.data!=='string'||value.data.length>87384)throw Error('文件预览身份或长度无效');
 const bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));
 if(bytes.length!==value.returnedBytes||(missing&&(bytes.length||value.totalBytes||value.data)))throw Error('文件预览字节无效');
 let text='';let binary=false;
 try{if(bytes.includes(0))binary=true;else text=new TextDecoder('utf-8',{fatal:true}).decode(bytes,{stream:value.truncated});}catch{binary=true;}
 return {text,binary,truncated:value.truncated,totalBytes:value.totalBytes,exists:value.exists};
}
