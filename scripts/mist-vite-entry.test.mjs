import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer, resolveConfig} from 'vite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const configFile=path.join(root,'vite.mist.config.ts');

test('direct Vite startup keeps authentication and workspace requests on the local API origin',async()=>{
  const config=await resolveConfig({configFile,logLevel:'silent'},'serve');
  assert.equal(config.define['import.meta.env.VITE_API_BASE_URL'],JSON.stringify('/api'));
  assert.equal(config.server.proxy['/api'].target,config.server.proxy['/api/mist'].target);
});

test('worktree preview serves real dependency fonts without opening unrelated filesystem paths',async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'bambook-vite-boundary-'));
  const font=await realpath(path.join(root,'node_modules/@fontsource/urbanist/files/urbanist-latin-400-normal.woff2'));
  const outside=path.join(temporary,'unrelated.txt');
  await writeFile(outside,'not a preview asset');
  let server;
  try{
    server=await createServer({configFile,logLevel:'silent',cacheDir:path.join(temporary,'cache'),
      optimizeDeps:{noDiscovery:true,entries:[]},server:{host:'127.0.0.1',port:0,strictPort:true}});
    await server.listen();
    const address=server.httpServer.address();
    assert(address&&typeof address==='object');
    const base='http://127.0.0.1:'+address.port;
    const served=await fetch(base+'/@fs'+font);
    assert.equal(served.status,200);
    assert((await served.arrayBuffer()).byteLength>1000);
    const denied=await fetch(base+'/@fs'+outside);
    assert.equal(denied.status,403);
  }finally{
    await server?.close();
    await rm(temporary,{recursive:true,force:true});
  }
});
