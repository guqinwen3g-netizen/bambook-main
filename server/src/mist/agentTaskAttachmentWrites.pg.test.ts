import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import * as contract from '../shared/mistWorkspace';
import { TASK_HASH, TASK_PREFIX } from './agentTasks';
import { MistPrivateFiles } from './files';
import { MistRepository } from './repository';
import { testActor, testAuthority } from './__tests__/support';

const url = process.env.MIST_PG_CONFLICT_TEST_URL;
const owner = testActor('owner');

describe.skipIf(!url)('real PostgreSQL task attachment writes', () => {
  async function fixture(client: PrismaClient, run: (repo: MistRepository, workspaceId: string, directory: string) => Promise<void>) {
    const directory = await mkdtemp(path.join(tmpdir(), 'mist-task-attachment-pg-'));
    const auth = testAuthority();
    auth.users.get(owner.userId)!.permissions.push('ai:chat');
    const repo = new MistRepository(client, contract, new MistPrivateFiles(directory), auth.authorize);
    repo.setPlatformTaskRuntime(() => true);
    let workspaceId: string | undefined;
    try {
      workspaceId = (await repo.create(owner, {name:'附件并发验收',slug:'task-attachments-'+randomUUID(),seed:'empty'})).id;
      await repo.ensurePersonalAgent(owner, workspaceId, () => 'bma1_test');
      await run(repo, workspaceId, directory);
    } finally {
      try {
        if (workspaceId) {
          await client.mistCommandReceipt.deleteMany({where:{workspaceId}});
          await client.mistWorkspace.deleteMany({where:{id:workspaceId}});
        }
      } finally {
        await client.$disconnect();
        await rm(directory,{recursive:true,force:true});
      }
    }
  }

  function database() {
    const target = new URL(url!);
    expect(['127.0.0.1','localhost']).toContain(target.hostname);
    expect(target.pathname).toMatch(/^\/bambook_(test|acceptance|account)/);
    return new PrismaClient({datasourceUrl:url});
  }

  const taskInput = () => ({requestId:randomUUID(),name:'核对原件',instructions:'只读核对原件。'});
  const attachments = [{name:'source.txt',mimeType:'text/plain',bytes:Buffer.from('synthetic source')}];

  it('stores one original when both submissions initially see no receipt', async () => {
    const prisma = database();
    let reads=0, open!:()=>void;
    const both=new Promise<void>(resolve=>{open=resolve;});
    const extended=prisma.$extends({query:{mistCommandReceipt:{async findUnique({args,query}){
      const result=await query(args);
      if(!result&&args.where.workspaceId_requestId?.requestId.startsWith(TASK_PREFIX+'create:')&&reads<2){
        if(++reads===2)open();
        await both;
      }
      return result;
    }}}});
    await fixture(extended as unknown as PrismaClient, async (repo,workspaceId,directory)=>{
      const input=taskInput();
      const submit=()=>repo.assignPersonalAgentTask(owner,workspaceId,input,()=> 'bma1_test',undefined,attachments);
      const [first,second]=await Promise.all([submit(),submit()]);
      expect(reads).toBe(2);
      expect(first.id).toBe(second.id);
      const files=await readdir(path.join(directory,workspaceId));
      expect(files).toEqual([first.attachments![0].id]);
      expect(await prisma.mistCommandReceipt.count({where:{workspaceId,inputHash:TASK_HASH}})).toBe(1);
    });
  },15000);

  it('removes staged originals after a definite task-creation rollback', async () => {
    const prisma=database();
    const extended=prisma.$extends({query:{mistCommandReceipt:{async create({args,query}){
      if(args.data.inputHash===TASK_HASH)throw new Error('synthetic task row rollback');
      return query(args);
    }}}});
    await fixture(extended as unknown as PrismaClient,async(repo,workspaceId,directory)=>{
      await expect(repo.assignPersonalAgentTask(owner,workspaceId,taskInput(),()=> 'bma1_test',undefined,attachments)).rejects.toThrow('synthetic task row rollback');
      const files=await readdir(path.join(directory,workspaceId)).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
      expect(files).toEqual([]);
      expect(await prisma.mistCommandReceipt.count({where:{workspaceId,requestId:{startsWith:TASK_PREFIX}}})).toBe(0);
    });
  });

  it('keeps committed originals when the commit acknowledgment is lost', async () => {
    await fixture(database(), async(repo,workspaceId,directory)=>{
      const identity=await repo.ensurePersonalAgent(owner,workspaceId,()=> 'bma1_test');
      const input={...taskInput(),identityId:identity.id,executor:'platform'};
      const boundary=repo as unknown as {transact:(run:(db:unknown)=>Promise<unknown>)=>Promise<unknown>};
      const transact=boundary.transact.bind(repo);
      const spy=vi.spyOn(boundary,'transact').mockImplementationOnce(async run=>{
        await transact(run);
        throw new Error('synthetic lost commit acknowledgment');
      });
      try {
        await expect(repo.createAgentTask(owner,workspaceId,input,undefined,attachments)).rejects.toThrow('synthetic lost commit acknowledgment');
        const originalIds=await readdir(path.join(directory,workspaceId));
        expect(originalIds).toHaveLength(1);
        const replay=await repo.createAgentTask(owner,workspaceId,input,undefined,attachments);
        expect(originalIds).toEqual([replay.attachments![0].id]);
        expect(await readdir(path.join(directory,workspaceId))).toEqual(originalIds);
      } finally {spy.mockRestore();}
    });
  });

});
