/** Both API prefixes must reach the same backend: login, workspace commands and files share one company database. */
import {HttpsProxyAgent} from 'https-proxy-agent';
export const MIST_SHARED_DEVELOPMENT_ORIGIN='https://bambook-dev.sylway.cloud';
export function mistDevelopmentProxy(shared=process.env.MIST_SHARED_DEVELOPMENT==='1',environment=process.env){
  const target=shared?MIST_SHARED_DEVELOPMENT_ORIGIN:'http://127.0.0.1:8082';
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
