import net from 'node:net';
import { simpleParser } from 'mailparser';
/** Isolated loopback SMTP endpoint; no mail leaves this process. */
export async function smtpCapture(){
 const messages:string[]=[];const sockets=new Set<net.Socket>();
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.setEncoding('utf8');socket.write('220 localhost ESMTP\r\n');let buffer='',data=false,lines:string[]=[];
  socket.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);if(data){if(line==='.'){messages.push(lines.join('\r\n'));lines=[];data=false;socket.write('250 accepted\r\n');}else lines.push(line.startsWith('..')?line.slice(1):line);continue;}if(/^EHLO|^HELO/i.test(line))socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');else if(/^AUTH /i.test(line))socket.write('235 authenticated\r\n');else if(/^DATA/i.test(line)){data=true;socket.write('354 send data\r\n');}else if(/^QUIT/i.test(line)){socket.end('221 bye\r\n');}else socket.write('250 ok\r\n');}});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return{port:(server.address() as net.AddressInfo).port,messages,async link(index=messages.length-1){const message=await simpleParser(messages[index]);const match=message.text?.match(/https?:\/\/\S+/);if(!match)throw Error('No access link in captured email');return new URL(match[0]);},async close(){for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
