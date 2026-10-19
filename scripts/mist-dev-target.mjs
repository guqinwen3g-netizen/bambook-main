/** Both API prefixes must reach the same backend: login, workspace commands and files share one company database. */
export const MIST_SHARED_DEVELOPMENT_ORIGIN='https://bambook-dev.sylway.cloud';
export function mistDevelopmentProxy(shared=process.env.MIST_SHARED_DEVELOPMENT==='1'){
  const target=shared?MIST_SHARED_DEVELOPMENT_ORIGIN:'http://127.0.0.1:8082';
  return Object.fromEntries(['/api/mist','/api'].map(route=>[route,{target,changeOrigin:true}]));
}
