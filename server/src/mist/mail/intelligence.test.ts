import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as contract from '../../shared/mistWorkspace';
import { parseEmailAnalysis } from '../../shared/mistEmailReview';
import { MistRepository, type MistContract } from '../repository';
import { MistPrivateFiles } from '../files';
import { createMistLocalRuntime } from '../local';
import { analyzeEmail, emailAnalysisHash } from './intelligence';
import { agentCommandSensitivity } from '../agentMcp';
import { agentGet } from '../agentRead';

let directory: string;
beforeEach(async () => { vi.stubEnv('MIST_LOCAL_WORKSPACE', '1'); vi.stubEnv('NODE_ENV', 'test'); directory = await mkdtemp(path.join(tmpdir(), 'mail-analysis-')); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const local = createMistLocalRuntime({ directory }); await local.ready;
  const actor = await local.actorForProfile('demo-sales');
  const repo = new MistRepository(local.database, contract as MistContract, new MistPrivateFiles(path.join(directory, 'files')), local.authorize);
  const ws = await repo.create(actor, { name: 'Mail processing', seed: 'demo' });
  const m = ws.state.email.messages[0];
  const answer = { category: '订单往来', summary: '客户提出订单需求，需核对附件。', fields: [{ field: '数量', value: '1,200 件', source: 'body', quote: '双面羊毛城市大衣 1,200 件' }], warnings: ['附件需另行核对'] };
  const complete = vi.fn().mockResolvedValue(JSON.stringify(answer));
  const deps = { complete, providers: () => [{ id: 'test', baseUrl: 'https://model.example.test', apiKey: 'private-test', model: 'test' }], subscription: () => null };
  const run = async (type: string, payload: any) => { const latest = await repo.get(actor, ws.id); return repo.execute(actor, ws.id, { requestId: randomUUID(), expectedRevision: latest.revision, command: { type, payload } }); };
  const analyze = () => analyzeEmail(repo, actor, ws.id, m.id, { consent: true }, undefined, deps);
  return { local, actor, repo, ws, m, answer, deps, complete, analyze, run };
}
it('uses only selected mail text, stores a draft, and does not overwrite reviewed/business facts', async () => {
  const f = await fixture(), before = JSON.stringify(f.ws.state.orders), result = await f.analyze();
  const m = result.workspace.state.email.messages[0];
  expect(m.analysis).toMatchObject({ category: '订单往来', sourceHash: emailAnalysisHash(f.m), attachmentCount: 1 });
  expect(m.extracted).toEqual(f.m.extracted); expect(m.extractionReview).toBeUndefined();
  expect(JSON.stringify(result.workspace.state.orders)).toBe(before);
  const prompt = JSON.stringify(f.complete.mock.calls[0][0].messages);
  expect(prompt).toContain('1,200 件'); expect(prompt).not.toContain('private-test'); expect(prompt).not.toContain(f.ws.state.email.messages[1].body);
});
it('rejects invented values and evidence, oversized structures and unknown keys', async () => {
  const f = await fixture();
  for (const patch of [{ fields: [{ ...f.answer.fields[0], value: '2000 件' }] }, { fields: [{ ...f.answer.fields[0], quote: '不存在的依据 1,200 件' }] }, { action: 'approve' }, { fields: Array(17).fill(f.answer.fields[0]) }]) expect(() => parseEmailAnalysis(JSON.stringify({ ...f.answer, ...patch }), f.m)).toThrow();
  f.complete.mockResolvedValueOnce('not json'); await expect(f.analyze()).rejects.toMatchObject({ code: 'MAIL_ANALYSIS_INVALID' });
  expect((await f.repo.get(f.actor, f.ws.id)).state.email.messages[0].analysis).toBeUndefined();
});
it('requires consent and scoped mail permission, and rejects a message trashed during analysis', async () => {
  const f = await fixture();
  await expect(analyzeEmail(f.repo, f.actor, f.ws.id, f.m.id, {}, undefined, f.deps)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const before = f.complete.mock.calls.length;
  const denied = { ...f.actor, permissionCeiling: ['ai:chat'] };
  await expect(analyzeEmail(f.repo, denied, f.ws.id, f.m.id, { consent: true }, undefined, f.deps)).rejects.toMatchObject({ status: 403 });
  expect(f.complete).toHaveBeenCalledTimes(before);
  f.complete.mockImplementationOnce(async () => { await f.repo.execute(f.actor, f.ws.id, { requestId: randomUUID(), expectedRevision: (await f.repo.get(f.actor, f.ws.id)).revision, command: { type: 'email.move', payload: { id: f.m.id, folder: 'trash' } } }); return JSON.stringify(f.answer); });
  await expect(f.analyze()).rejects.toMatchObject({ code: 'PRECONDITION' });
});
it('rechecks AI permission after model completion and does not publish after a mid-call revocation', async () => {
  const f = await fixture();
  f.complete.mockImplementationOnce(async () => { f.actor.permissionCeiling = ['emails:read', 'emails:write']; return JSON.stringify(f.answer); });
  await expect(f.analyze()).rejects.toMatchObject({ status: 403 });
  expect((await f.repo.get(f.actor, f.ws.id)).state.email.messages[0].analysis).toBeUndefined();
});
it('requires human review, preserves original evidence on correction, and freezes handoff snapshots', async () => {
  const f = await fixture(); await f.analyze();
  let m = (await f.repo.get(f.actor, f.ws.id)).state.email.messages[0]; m.example = false;
  const state = contract.createMistState({ id: randomUUID, now: '2026-11-01T01:00:00Z', actorName: 'Test', actorId: f.actor.userId }, 'demo');
  state.email.messages[0] = m;
  const context = { id: randomUUID, now: '2026-11-01T01:00:00Z', actorName: 'Test', actorId: f.actor.userId };
  const target = m.links[0];
  expect(() => contract.applyMistCommand(state, { type: 'email.submitExtraction', payload: { id: m.id, link: target } }, context)).toThrow('先复核');
  await f.run('email.extraction.review', { id: m.id, analysisId: m.analysis!.id, category: '订单往来', fields: [{ id: 'field-1', value: '1,200 件（待确认）' }], note: '核对数量' });
  m = (await f.repo.get(f.actor, f.ws.id)).state.email.messages[0];
  expect(m.extractionReview!.fields[0]).toMatchObject({ corrected: true, quote: '双面羊毛城市大衣 1,200 件' });
  await f.run('email.submitExtraction', { id: m.id, link: target });
  const saved = await f.repo.get(f.actor, f.ws.id), submission = saved.state.email.messages[0].submissions.at(-1)!;
  expect(submission.review!.fields[0].value).toBe('1,200 件（待确认）');
  expect(saved.state.tasks.find(t => t.id === submission.taskId)!.target).toEqual({ view: 'emails', id: m.id });
  await expect(f.run('task.complete', { id: submission.taskId, done: true })).rejects.toMatchObject({ code: 'PRECONDITION' });
  const recipient = await f.local.actorForProfile(saved.state.tasks.find(t => t.id === submission.taskId)!.assigneeIds[0]);
  await f.repo.execute(recipient, f.ws.id, {requestId:randomUUID(),expectedRevision:saved.revision,command:{type:'email.extraction.resolve',payload:{ id: m.id, taskId: submission.taskId, outcome: 'handled', note: '已核对，正式订单按既有审批流程办理。' }}});
  const finished = await f.repo.get(f.actor, f.ws.id);
  expect(finished.state.email.messages[0].submissions.at(-1)!.resolution?.outcome).toBe('handled');
  expect(finished.state.tasks.find(t => t.id === submission.taskId)!.done).toBe(true);
});
it('rejects stale drafts, forged server results and duplicate field selection', async () => {
  const f = await fixture(); await f.analyze(); let m = (await f.repo.get(f.actor, f.ws.id)).state.email.messages[0]; const oldId = m.analysis!.id;
  await expect(f.run('email.server.analysis', { id: m.id, analysis: m.analysis })).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
  await f.analyze();
  await expect(f.run('email.extraction.review', { id: m.id, analysisId: oldId, category: '其他', fields: [] })).rejects.toMatchObject({ code: 'VALIDATION' });
  m = (await f.repo.get(f.actor, f.ws.id)).state.email.messages[0];
  await expect(f.run('email.extraction.review', { id: m.id, analysisId: m.analysis!.id, category: '其他', fields: [{ id: 'field-1', value: 'a' }, { id: 'field-1', value: 'b' }] })).rejects.toMatchObject({ code: 'VALIDATION' });
  expect(agentCommandSensitivity('email.extraction.review')).toBe('confirm'); expect(agentCommandSensitivity('email.extraction.resolve')).toBe('confirm');
});
it('keeps personal mail private on cross-owner handoff, uses the Shanghai business day and restricts result handling', async () => {
  const f = await fixture(), state = structuredClone(f.ws.state), m = state.email.messages[0], account = state.email.accounts.find(a => a.id === m.accountId)!;
  account.ownerId = 'sender'; account.memberIds = []; m.example = true;
  const customer = state.customers.find(c => c.id === m.links[0].id)!; customer.ownerId = 'receiver';
  const command = { type: 'email.submitExtraction', payload: { id: m.id, link: m.links[0] } } as const;
  const context = { id: randomUUID, now: '2026-10-31T20:00:00Z', actorName: 'Sender', actorId: 'sender' };
  expect(() => contract.applyMistCommand(state, command, context)).toThrow('负责人无权查看');
  account.memberIds.push('receiver'); const result = contract.applyMistCommand(state, command, context);
  const task = result.state.tasks.find(t => t.kind === 'email-extraction-review')!;
  expect(task).toMatchObject({ due: '2026-11-01', assigneeIds: ['receiver'] });
  expect(() => contract.applyMistCommand(result.state, { type: 'email.extraction.resolve', payload: { id: m.id, taskId: task.id, outcome: 'handled', note: 'Handled' } }, context)).toThrow('只能处理分配给本人');
});
it('MCP mail reads include structured evidence rather than opaque object placeholders', async () => {
  const f = await fixture(); await f.analyze(); const state = (await f.repo.get(f.actor, f.ws.id)).state;
  const read = agentGet(state, f.actor, 'email', f.m.id);
  expect((read.data as any).analysis.fields[0]).toMatchObject({ id: 'field-1', value: '1,200 件', quote: '双面羊毛城市大衣 1,200 件' });
});
it('checks the recipient current mail permissions before creating a handoff task', async () => {
  const f = await fixture(); await f.analyze(); const m = (await f.repo.get(f.actor, f.ws.id)).state.email.messages[0];
  await f.run('email.extraction.review', { id: m.id, analysisId: m.analysis!.id, category: '订单往来', fields: [{ id: 'field-1', value: '1,200 件' }] });
  const count = (await f.repo.get(f.actor, f.ws.id)).state.tasks.length;
  vi.spyOn(f.repo as any, 'reviewSubject').mockResolvedValue({ ...f.actor, permissions: ['orders:read'], authorizationLoaded: true });
  await expect(f.run('email.submitExtraction', { id: m.id, link: m.links[0] })).rejects.toMatchObject({ code: 'PRECONDITION', message: expect.stringContaining('缺少邮件办理权限') });
  expect((await f.repo.get(f.actor, f.ws.id)).state.tasks.length).toBe(count);
});
