const {deflateSync}=require('node:zlib');
// 完整可解码的 2×1 RGBA PNG，包含正确 CRC、IDAT 与 IEND；不是仅供尺寸解析的头部。
function chunk(type,data){
 const payload=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
 for(const byte of payload){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
 return Buffer.concat([length,payload,checksum]);
}
const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255,0,255,0,255]))),chunk('IEND',Buffer.alloc(0))]);
module.exports={png};
