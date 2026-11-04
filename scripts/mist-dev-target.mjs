/** Both API prefixes must reach the same backend: login, workspace commands and files share one company database. */
import {HttpsProxyAgent} from 'https-proxy-agent';
export const MIST_SHARED_DEVELOPMENT_ORIGIN='https://bambook-dev.sylway.cloud';
function localDevelopmentOrigin(environment){
  const origin=environment.MIST_LOCAL_API_ORIGIN;
  const port=environment.MIST_LOCAL_API_PORT;
  // Validate the literal host too: URL normalizes alternate IPv4 spellings to loopback.
  if(origin!==undefined){
    try{
      if(!/^http:\/\/(127\.0\.0\.1|localhost)(?::[0-9]+)?\/?$/i.test(origin))throw new Error();
      const url=new URL(origin);
      if(url.port==='0')throw new Error();
      return url.origin;
    }catch{throw new Error('MIST_LOCAL_API_ORIGIN 无效：仅支持 http://127.0.0.1 或 http://localhost，可指定端口（1–65535）。');}
  }
  if(port!==undefined&&(!/^[0-9]+$/.test(port)||Number(port)<1||Number(port)>65535)){
    throw new Error('MIST_LOCAL_API_PORT 无效：须为 1–65535 的整数。');
  }
  return `http://127.0.0.1:${port===undefined?'8082':Number(port)}`;
}
export function mistDevelopmentProxy(shared=process.env.MIST_SHARED_DEVELOPMENT==='1',environment=process.env){
  const target=shared?MIST_SHARED_DEVELOPMENT_ORIGIN:localDevelopmentOrigin(environment);
  const url=new URL(target),host=url.hostname,port=url.port||(url.protocol==='https:'?'443':'80');
  const bypass=(environment.NO_PROXY||environment.no_proxy||'').split(',').some(item=>{
    const requestedPort=item.trim().match(/:(\d+)$/)?.[1];if(requestedPort&&requestedPort!==port)return false;
    const entry=item.trim().toLowerCase().replace(/:\d+$/,'');
    return entry==='*'||entry===host||entry.startsWith('.')&&(host===entry.slice(1)||host.endsWith(entry))||entry.startsWith('*.')&&host.endsWith(entry.slice(1));
  });
  const address=shared&&!bypass?(environment.https_proxy||environment.HTTPS_PROXY||environment.http_proxy||environment.HTTP_PROXY):undefined;
  let agent;
  if(address){try{if(!['http:','https:'].includes(new URL(address).protocol))throw new Error();agent=new HttpsProxyAgent(address,{keepAlive:true});}catch{throw new Error('共享开发代理配置无效，请检查 HTTPS_PROXY（HTTP / HTTPS 地址）。');}}
  return Object.fromEntries(['/api/mist','/api'].map(route=>[route,{target,changeOrigin:true,...(agent?{agent}:{})}]));
}
