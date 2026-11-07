/**
 * 用真实模型跑小竹任务循环：本机 Claude 命令行作模型，临时目录的演示公司，只有模拟数据。
 * 用来检查真实模型能否遵守“每轮一个 JSON 工具调用”并办完事，脚本化模型验证不了这件事。
 * 运行：cd server && npx tsx scripts/agent-real-model.ts [模型别名，默认 haiku]
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

const model = process.argv[2] || 'haiku';
function ask(system: string, user: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', model, '--output-format', 'text', '--tools', '', '--system-prompt', system], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('model timeout')); }, 110_000);
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => { clearTimeout(timer); code === 0 && out.trim() ? resolve(out.trim()) : reject(new Error('claude exit ' + code + ' ' + err.slice(0, 200))); });
    child.stdin.end(user);
  });
}
async function main() {
  process.env.MIST_LOCAL_WORKSPACE = '1'; process.env.NODE_ENV = 'development';
  const { createMistLocalRuntime } = await import('../src/mist/local');
  const { createMistServer } = await import('../src/mist/server');
  const cwd = await mkdtemp(path.join(tmpdir(), 'agent-real-cwd-')); let calls = 0, bad = 0;
  const complete = async (input: any) => { calls++; const user = input.messages.filter((m: any) => m.role !== 'system').map((m: any) => m.content).join('\n'); const system = [input.systemPrompt, ...input.messages.filter((m: any) => m.role === 'system').map((m: any) => m.content)].filter(Boolean).join('\n'); const reply = await ask(system, user, cwd); try { JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { bad++; } console.log(`  turn ${calls}: ${reply.replace(/\s+/g, ' ').slice(0, 170)}`); return reply; };
  const local = createMistLocalRuntime({ directory: await mkdtemp(path.join(tmpdir(), 'agent-real-')) });
  const app = createMistServer(undefined, { local, agentTasks: { complete, tickMs: 3_600_000, pulseMs: 500, concurrency: 1 } }), human = request.agent(app);
  await human.get('/api/mist/session').expect(200);
  const ws = (await human.get('/api/mist/workspaces/default').expect(200)).body.workspace, base = '/api/mist/workspaces/' + ws.id, worker: any = app.locals.platformTaskWorker; worker.start(3_600_000);
  const read = async (id: string) => (await human.get(base + '/agent-tasks/' + id).expect(200)).body.item;
  const settle = async (id: string) => { for (let i = 0; i < 40; i++) { await worker.tick(); await worker.settled(); const t = await read(id); if (!['queued', 'running'].includes(t.state)) return t; } return read(id); };
  const state = async () => (await human.get(base).expect(200)).body.workspace;
  const ask2 = async (instructions: string) => (await human.post(base + '/personal-agent/tasks').send({ requestId: randomUUID(), name: instructions.slice(0, 60), instructions, locale: 'zh-CN' }).expect(201)).body.item;
  const scenarios: Array<[string, string]> = [['问答', '哪些订单交期最近？列出前三张的订单号和交期。']];
  for (const [label, text] of scenarios) {
    console.log(`\n=== ${label}：${text}`); const before = calls; const started = Date.now();
    let t = await settle((await ask2(text)).id);
    for (let round = 0; round < 3 && t.state === 'waiting_human'; round++) {
      const q = (t.questions ?? []).find((x: any) => !x.answeredAt);
      if (q) { console.log('  追问：' + q.question); await human.post(base + '/agent-tasks/' + t.id + '/answer').send({ requestId: randomUUID(), version: t.version, questionId: q.id, answer: '客户是 Cedar & Crown，只查订单进度，不用改任何东西。' }).expect(200); }
      else if (t.waitingProposalIds.length) { console.log('  待确认提议，本人确认'); const w = await state(); await human.post(base + '/commands').send({ requestId: randomUUID(), expectedRevision: w.revision, command: { type: 'agent.proposal.confirm', payload: { id: t.waitingProposalIds[0] } } }).expect(200); }
      t = await settle(t.id);
    }
    console.log(`  结果：${t.state} · 模型 ${calls - before} 轮 · ${Math.round((Date.now() - started) / 1000)} 秒\n  ${String(t.result || t.checkpoint).slice(0, 300)}`);
  }
  console.log('\n=== 自动规则：每天定时，让模型归档收件箱第一封邮件');
  const rule = (await human.post(base + '/agent-automations').send({ name: '每日归档', trigger: 'daily', time: '00:00', instructions: '把收件箱里当前第一封邮件归档。' }).expect(201)).body.item, auto: any = app.locals.automationWorker;
  await auto.tick(); const run = (await human.get(base + '/agent-automations').expect(200)).body.items[0].runs[0]; const auto1 = await settle(run.taskId);
  const pending = (await state()).state.agentProposals.filter((p: any) => p.state === 'pending').length;
  console.log(`  规则 ${rule.name}：${run.detail} · 任务 ${auto1.state} · 待确认提议 ${pending}\n  ${String(auto1.result).slice(0, 200)}`);
  const final = await state();
  console.log(`\n合计模型 ${calls} 轮，非 JSON ${bad} 轮；跟进写入：${JSON.stringify(final.state.crm).includes('大货交期')}；已归档邮件：${final.state.email.messages.filter((m: any) => m.folder === 'archive').length}`);
  await worker.stop(); process.exit(0);
}
main().catch(error => { console.error(error); process.exit(1); });
