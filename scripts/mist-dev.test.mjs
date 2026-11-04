import test from 'node:test';
import assert from 'node:assert/strict';
import {startMistDevelopment,startMistSharedDevelopment,mistDevelopmentProxy,MIST_SHARED_DEVELOPMENT_ORIGIN} from './mist-dev.mjs';

function setup(states,frontendError){
  const calls=[];
  return{calls,options:{probe:async()=>states.length>1?states.shift():states[0],pause:async()=>{},attempts:2,
    createRunner:()=>({start:async()=>calls.push('api-start'),stop:async()=>calls.push('api-stop')}),
    startFrontend:async()=>{calls.push('ui-start');if(frontendError)throw frontendError;return{close:async()=>calls.push('ui-stop')};}
  }};
}
test('cold start waits for local API before opening the frontend and closes owned services',async()=>{
  const s=setup(['free','free','local']);const running=await startMistDevelopment(s.options);
  assert.equal(running.reusedApi,false);assert.deepEqual(s.calls,['api-start','ui-start']);
  await running.close();await running.close();assert.deepEqual(s.calls,['api-start','ui-start','ui-stop','api-stop']);
});
test('reuse only a verified local API and leave it running on exit',async()=>{
  const s=setup(['local']);const running=await startMistDevelopment(s.options);await running.close();
  assert.equal(running.reusedApi,true);assert.deepEqual(s.calls,['ui-start','ui-stop']);
});
test('do not start or stop an unrelated API occupying 8082',async()=>{
  const s=setup(['occupied']);await assert.rejects(startMistDevelopment(s.options),/8082/);assert.deepEqual(s.calls,[]);
});
test('API startup timeout closes owned runner and never starts the frontend',async()=>{
  const s=setup(['free']);await assert.rejects(startMistDevelopment(s.options),/未能就绪/);assert.deepEqual(s.calls,['api-start','api-stop']);
});
test('frontend port conflict closes owned API but leaves a reused API untouched',async()=>{
  const own=setup(['free','local'],new Error('Port 3001 is already in use'));
  await assert.rejects(startMistDevelopment(own.options),/3001/);assert.deepEqual(own.calls,['api-start','ui-start','api-stop']);
  const reused=setup(['local'],new Error('Port 3001 is already in use'));
  await assert.rejects(startMistDevelopment(reused.options),/3001/);assert.deepEqual(reused.calls,['ui-start']);
});
test('shared preview uses the same development origin for authentication, business data and attachments',()=>{
  const shared=mistDevelopmentProxy(true,{}),local=mistDevelopmentProxy(false,{});
  assert.deepEqual(Object.keys(shared),['/api/mist','/api']);
  for(const p of Object.values(shared)){assert.equal(p.target,MIST_SHARED_DEVELOPMENT_ORIGIN);assert.equal(p.changeOrigin,true);}
  for(const p of Object.values(local))assert.equal(p.target,'http://127.0.0.1:8082');
});
test('local API port configures both prefixes and stays direct',()=>{
  for(const port of ['1','8083','65535']){
    const proxies=mistDevelopmentProxy(false,{MIST_LOCAL_API_PORT:port,HTTPS_PROXY:'http://127.0.0.1:3128'});
    assert.deepEqual(Object.keys(proxies),['/api/mist','/api']);
    for(const proxy of Object.values(proxies)){
      assert.equal(proxy.target,`http://127.0.0.1:${port}`);assert.equal(proxy.changeOrigin,true);assert.equal(proxy.agent,undefined);
    }
  }
});
test('local HTTP origin accepts only literal loopback hosts and takes precedence over port',()=>{
  for(const origin of ['http://127.0.0.1:8084','http://localhost:8085/','http://localhost','http://127.0.0.1:80/']){
    const proxies=mistDevelopmentProxy(false,{MIST_LOCAL_API_ORIGIN:origin,MIST_LOCAL_API_PORT:'invalid'});
    for(const proxy of Object.values(proxies))assert.equal(proxy.target,new URL(origin).origin);
  }
});
test('invalid local API ports fail instead of falling back to the default',()=>{
  for(const port of ['','0','65536','-1','1.5','8083x',' 8083','1e3','Infinity']){
    assert.throws(()=>mistDevelopmentProxy(false,{MIST_LOCAL_API_PORT:port}),/MIST_LOCAL_API_PORT 无效/);
  }
});
test('invalid local API origins fail instead of proxying to another host or URL path',()=>{
  for(const origin of ['', 'not a URL','https://localhost:8083','http://example.com','http://0.0.0.0:8083','http://[::1]:8083',
    'http://127.1:8083','http://2130706433:8083','http://localhost.example.com','http://user:pass@localhost:8083',
    'http://localhost:8083/api','http://localhost:8083/../','http://localhost:8083?x=1','http://localhost:8083#x',
    'http://localhost:0','http://localhost:65536','http://localhost:',' http://localhost:8083','http://localhost:8083\n']){
    assert.throws(()=>mistDevelopmentProxy(false,{MIST_LOCAL_API_ORIGIN:origin}),/MIST_LOCAL_API_ORIGIN 无效/);
  }
});
test('shared development ignores local target overrides including invalid values',()=>{
  const proxies=mistDevelopmentProxy(true,{MIST_LOCAL_API_ORIGIN:'https://example.com',MIST_LOCAL_API_PORT:'invalid'});
  for(const proxy of Object.values(proxies))assert.equal(proxy.target,MIST_SHARED_DEVELOPMENT_ORIGIN);
});
test('shared preview verifies the authenticated development API and only owns its frontend',async()=>{
  const calls=[];const running=await startMistSharedDevelopment({probe:async()=>{calls.push('shared-probe');return true;},startFrontend:async()=>{calls.push('ui-start');return{close:async()=>calls.push('ui-stop')};}});
  await running.close();await running.close();assert.equal(running.shared,true);assert.deepEqual(calls,['shared-probe','ui-start','ui-stop']);
});
test('unavailable shared API never starts the frontend or silently falls back to a local database',async()=>{
  let opened=false;await assert.rejects(startMistSharedDevelopment({probe:async()=>false,startFrontend:async()=>{opened=true;}}),/共享开发服务不可用/);assert.equal(opened,false);
});
test('shared authentication and business proxies use one configured HTTPS tunnel while local development stays direct',()=>{
  const env={HTTPS_PROXY:'http://127.0.0.1:3128'},shared=mistDevelopmentProxy(true,env),local=mistDevelopmentProxy(false,env);
  assert(shared['/api'].agent);assert.equal(shared['/api'].agent,shared['/api/mist'].agent);assert.equal(shared['/api'].agent.proxy.hostname,'127.0.0.1');
  assert.equal(local['/api'].agent,undefined);shared['/api'].agent.destroy();
});
test('shared development honors NO_PROXY for its fixed backend and keeps proxy configuration server-side',()=>{
  for(const NO_PROXY of ['bambook-dev.sylway.cloud:443','.sylway.cloud','*.sylway.cloud','*'])assert.equal(mistDevelopmentProxy(true,{HTTPS_PROXY:'http://127.0.0.1:3128',NO_PROXY})['/api'].agent,undefined);
  const differentPort=mistDevelopmentProxy(true,{HTTPS_PROXY:'http://127.0.0.1:3128',NO_PROXY:'bambook-dev.sylway.cloud:444'});assert(differentPort['/api'].agent);differentPort['/api'].agent.destroy();
  assert.throws(()=>mistDevelopmentProxy(true,{HTTPS_PROXY:'invalid proxy'}),/代理配置无效/);
  assert.throws(()=>mistDevelopmentProxy(true,{HTTPS_PROXY:'socks5://127.0.0.1:1080'}),/代理配置无效/);
});
