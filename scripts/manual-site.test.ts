import {afterAll,beforeAll,expect,it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build,createServer,type ViteDevServer} from 'vite';
import {manualSitePlugin} from './manual-site';

const repo=fileURLToPath(new URL('..',import.meta.url));
let root:string,server:ViteDevServer,port:number,buildCount=0;
const fakeBuild=(output:string)=>{buildCount++;fs.mkdirSync(path.join(output,'assets'),{recursive:true});fs.writeFileSync(path.join(output,'index.html'),'<h1>Employee manual</h1>');fs.writeFileSync(path.join(output,'manual-version.json'),JSON.stringify({build:buildCount}));fs.writeFileSync(path.join(output,'assets','step.webp'),'image-bytes');};
const request=(url:string,method='GET')=>new Promise<{status:number;headers:http.IncomingHttpHeaders;body:string}>((resolve,reject)=>{
 const r=http.request({host:'127.0.0.1',port,path:url,method},res=>{let body='';res.setEncoding('utf8');res.on('data',data=>body+=data);res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body}));});r.on('error',reject);r.end();
});
beforeAll(async()=>{
 root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'manual-site-test-')));fs.writeFileSync(path.join(root,'index.html'),'<h1>Business application</h1>');
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','initial','--no-verify'],{cwd:root});
 server=await createServer({configFile:false,root,base:'/app/',logLevel:'silent',plugins:[manualSitePlugin(root,{build:fakeBuild})],server:{host:'127.0.0.1',port:0,fs:{allow:[root]}}});await server.listen();port=(server.httpServer!.address() as {port:number}).port;
});
afterAll(async()=>{await server?.close();if(root)fs.rmSync(root,{recursive:true,force:true});});

it('serves the standalone manual under the application base with correct MIME, query and HEAD behavior',async()=>{
 const redirect=await request('/app/manual?from=help');expect(redirect.status).toBe(308);expect(redirect.headers.location).toBe('/app/manual/?from=help');
 const page=await request('/app/manual/?from=help');expect(page.status).toBe(200);expect(page.body).toContain('Employee manual');expect(page.body).not.toContain('Business application');expect(page.headers['content-type']).toContain('text/html');
 const image=await request('/app/manual/assets/step.webp?v=capture');expect(image.status).toBe(200);expect(image.headers['content-type']).toBe('image/webp');
 const head=await request('/app/manual/manual-version.json','HEAD');expect(head.status).toBe(200);expect(head.body).toBe('');expect(head.headers['content-type']).toContain('application/json');expect(buildCount).toBe(1);
});

it('does not let unknown, encoded traversal or unsupported requests fall through to the business SPA',async()=>{
 expect((await request('/app/manual/missing.webp')).status).toBe(404);
 for(const invalid of ['/app/manual/%2e%2e/index.html','/app/manual/assets/%2e%2e/%2e%2e/private','/app/manual/%5cprivate','/app/manual/%00index.html','/app/manual/%ZZ'])expect((await request(invalid)).status).toBe(400);
 const post=await request('/app/manual/','POST');expect(post.status).toBe(405);expect(post.headers.allow).toBe('GET, HEAD');expect(post.body).not.toContain('Business application');
});

it('refreshes development metadata when HEAD changes even though no course file changed',async()=>{
 const before=JSON.parse((await request('/app/manual/manual-version.json')).body).build;
 execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','next version','--no-verify'],{cwd:root});
 const after=JSON.parse((await request('/app/manual/manual-version.json')).body).build;expect(after).toBe(before+1);
 expect((await request('/app/manual/assets/step.webp')).status).toBe(200);expect(buildCount).toBe(after);
});

it('includes separate manual assets in a real production output without importing them into the business entry',async()=>{
 const output=path.join(root,'built');
 await build({configFile:false,root,base:'/app/',logLevel:'silent',plugins:[manualSitePlugin(root,{build:fakeBuild})],build:{outDir:output,emptyOutDir:true}});
 expect(fs.readFileSync(path.join(output,'index.html'),'utf8')).toContain('Business application');
 expect(fs.readFileSync(path.join(output,'manual/index.html'),'utf8')).toContain('Employee manual');
 expect(fs.readFileSync(path.join(output,'manual/assets/step.webp'),'utf8')).toBe('image-bytes');
 expect(fs.readFileSync(path.join(output,'index.html'),'utf8')).not.toContain('step.webp');
});

it('fails the manual route closed when generation fails and rejects symlinked public assets',async()=>{
 const bad=await createServer({configFile:false,root,logLevel:'silent',plugins:[manualSitePlugin(root,{build:()=>{throw new Error('private source detail');}})],server:{host:'127.0.0.1',port:0}});
 await bad.listen();const original=port;port=(bad.httpServer!.address() as {port:number}).port;
 try{const response=await request('/manual/');expect(response.status).toBe(503);expect(response.body).not.toContain('private source detail');expect(response.body).not.toContain('Business application');}finally{port=original;await bad.close();}
 const linked=await createServer({configFile:false,root,logLevel:'silent',plugins:[manualSitePlugin(root,{build:output=>{fakeBuild(output);fs.symlinkSync(path.join(root,'index.html'),path.join(output,'assets/linked.webp'));}})],server:{host:'127.0.0.1',port:0}});
 await linked.listen();port=(linked.httpServer!.address() as {port:number}).port;
 try{expect((await request('/manual/assets/linked.webp')).status).toBe(404);}finally{port=original;await linked.close();}
});

it('builds all 27 real courses with matching standalone version metadata and versioned image URLs',()=>{
 const output=path.join(root,'actual-manual');fs.mkdirSync(output);
 execFileSync(process.execPath,[path.join(repo,'scripts/wiki-build.mjs'),'--out-dir',output],{cwd:repo,stdio:'pipe'});
 const manifest=JSON.parse(fs.readFileSync(path.join(output,'manual-version.json'),'utf8'));
 expect(manifest.totals).toEqual({lessons:27,steps:164,images:191});expect(manifest.build.commit).toMatch(/^[a-f0-9]{40}$/);expect(manifest.courses.every((c:any)=>c.provenance.status==='registered'&&/^[a-f0-9]{40}$/.test(c.provenance.softwareCommit))).toBe(true);
 const html=fs.readFileSync(path.join(output,'index.html'),'utf8');expect(html.match(/data-lesson data-frames=/g)).toHaveLength(27);expect(html).toMatch(/\/[a-f0-9]{64}\/01\.webp/);
 const files=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
 expect(files(output).filter(file=>file.endsWith('.webp'))).toHaveLength(191);expect(files(output).some(file=>file.endsWith('capture.json'))).toBe(false);
 const protectedDir=path.join(root,'other-files');fs.mkdirSync(protectedDir);fs.writeFileSync(path.join(protectedDir,'important.txt'),'keep');
 const rejected=spawnSync(process.execPath,[path.join(repo,'scripts/wiki-build.mjs'),'--out-dir',protectedDir],{cwd:repo,encoding:'utf8'});expect(rejected.status).not.toBe(0);expect(fs.readFileSync(path.join(protectedDir,'important.txt'),'utf8')).toBe('keep');expect(fs.existsSync(path.join(protectedDir,'index.html'))).toBe(false);
},15000);
