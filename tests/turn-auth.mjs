import {createSocket} from 'node:dgram';
import {connect} from 'node:net';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const host=process.env.TURN_HOST||'rl-astra.amwill.dev';
const message=Buffer.alloc(28);message.writeUInt16BE(3,0);message.writeUInt16BE(8,2);message.writeUInt32BE(0x2112a442,4);randomBytes(12).copy(message,8);message.writeUInt16BE(0x19,20);message.writeUInt16BE(4,22);message[24]=17;
const check=bytes=>{assert.equal(bytes.readUInt16BE(0),0x113,'unauthenticated allocation must fail');let error;for(let i=20;i+4<=bytes.length;){const type=bytes.readUInt16BE(i),length=bytes.readUInt16BE(i+2);if(type===9)error=(bytes[i+6]&7)*100+bytes[i+7];i+=4+Math.ceil(length/4)*4;}assert.equal(error,401,'TURN requires authentication');};
for(const protocol of ['udp','tcp'])await new Promise((resolve,reject)=>{
 const timeout=setTimeout(()=>{socket.destroy?.();socket.close?.();reject(Error(protocol+' timed out'));},5000);
 const socket=protocol==='udp'?createSocket('udp4'):connect(3478,host);
 const done=bytes=>{clearTimeout(timeout);try{check(bytes);console.log('PASS',protocol,'rejects unauthenticated TURN allocation');resolve();}catch(e){reject(e);}finally{if(protocol==='udp')socket.close();else socket.destroy();}};
 socket.on('error',e=>{clearTimeout(timeout);reject(e);});
 if(protocol==='udp'){socket.once('message',done);socket.send(message,3478,host);}else{let data=Buffer.alloc(0);socket.on('data',b=>{data=Buffer.concat([data,b]);if(data.length>=20&&data.length>=20+data.readUInt16BE(2))done(data);});socket.on('connect',()=>socket.write(message));}
});
