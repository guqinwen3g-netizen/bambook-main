import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import request from 'supertest';
import {promises as fs} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {createMistLocalRuntime} from './local';import {createMistServer} from './server';
import {randomUUID} from 'node:crypto';
let directory:string;
beforeEach(async()=>{directory=await fs.mkdtemp(path.join(os.tmpdir(),'mist-audit-query-'));vi.stubEnv('MIST_LOCAL_WORKSPACE','1');vi.stubEnv('NODE_ENV','test');});
afterEach(async()=>{vi.unstubAllEnvs();await fs.rm(directory,{recursive:true,force:true});});
async function as(app:any,profileId:string,mode='operate'){
  const human=request.agent(app);await human.get('/api/mist/session').expect(200);await human.post('/api/mist/session').send({profileId}).expect(200);
  const workspace=(await human.get('/api/mist/workspaces/default')).body.workspace;
  const token=(await human.post('/api/mist/agent/delegations').send({mode,workspaceId:workspace.id,id:randomUUID()})).body.delegation.token;
  let id=0;const tool=async(name:string,args:any)=>(await request(app).post('/api/mist/mcp').set('x-bambook-delegation',token).send({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}}).expect(200)).body.result;
  return {human,workspace,tool};
}
describe('Permission-checked REST and MCP audit queries',()=>{
  it('paginates/filter own history, permits company auditors, and keeps ordinary employees from other actors',async()=>{
    const app=createMistServer(undefined,{local:createMistLocalRuntime({directory})}),buyer=await as(app,'demo-buyer');
    for(let i=0;i<3;i++)expect((await buyer.tool('bambook_execute',{workspaceId:buyer.workspace.id,requestId:'calendar-'+i,command:{type:'calendar.save',payload:{title:'收货复核'+i,date:'2026-11-02',time:'09:00',note:'核对资料'}}})).isError).not.toBe(true);
    const base='/api/mist/workspaces/'+buyer.workspace.id+'/agent-audits';
    const seen:string[]=[];let cursor='';
    do {const page=(await buyer.human.get(base).query({limit:1,...(cursor?{cursor}:{})}).expect(200)).body;seen.push(...page.items.map((r:any)=>r.requestId));cursor=page.nextCursor;}while(cursor);
    expect(new Set(seen).size).toBe(3);
    const ownPage=(await buyer.human.get(base).expect(200)).body;
    expect((await buyer.human.get(base).query({agentSessionId:ownPage.items[0].agentSessionId}).expect(200)).body.items).toHaveLength(3);
    expect((await buyer.human.get(base).query({proposalId:'not-a-real-proposal'}).expect(200)).body.items).toHaveLength(0);
    await buyer.human.get(base).query({scope:'company'}).expect(403);
    const other=await as(app,'demo-sales');await other.human.get(base+'/'+encodeURIComponent(seen[0])).expect(404);
    const finance=await as(app,'demo-finance');
    const company=(await finance.human.get(base).query({scope:'company',source:'agent',phase:'executed'}).expect(200)).body;
    expect(company.items).toHaveLength(3);expect(company.canReadCompany).toBe(true);
    const detail=(await buyer.human.get(base+'/'+encodeURIComponent(seen[0])).query({includeCommand:true}).expect(200)).body;
    expect(detail.command.payload.title).toContain('收货复核');expect(detail.changes.length).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toContain('__agentAudit');
    const reader=await as(app,'demo-buyer','read');expect((await reader.tool('bambook_audit',{workspaceId:buyer.workspace.id,requestId:seen[0],includeCommand:true})).structuredContent.command.payload.title).toContain('收货复核');
    const financeReader=await as(app,'demo-finance','read');
    expect((await financeReader.tool('bambook_audit',{workspaceId:buyer.workspace.id,scope:'company'})).structuredContent.items).toHaveLength(3);
    const noWrite=await financeReader.tool('bambook_execute',{workspaceId:buyer.workspace.id,requestId:'still-read-only',command:{type:'calendar.save',payload:{title:'should not persist',date:'2026-11-02',time:'09:00',note:''}}});
    expect(noWrite.isError).toBe(true);expect(noWrite.content[0].text).toContain('只读委托');
    await buyer.human.get(base).query({cursor:'malformed!'}).expect(400);await buyer.human.get(base).query({limit:100}).expect(400);
  });
});
