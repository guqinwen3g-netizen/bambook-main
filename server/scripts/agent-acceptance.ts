/**
 * 小竹 cowork 本机验收环境：临时目录的演示公司 + 真实平台任务执行器 + 脚本化模型，前端 3002。
 * 不连开发服务器、不写 server/private/mist-local，退出后数据丢弃。
 * 模型按请求内容走固定路线：含“归档邮件”走待确认提议，含“问我”先追问，其余读订单后回答。
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main() {
const ROOT = path.resolve(__dirname, '../..'), API_PORT = 8083, WEB_PORT = 3002;
process.env.MIST_LOCAL_WORKSPACE = '1'; process.env.NODE_ENV = 'development'; process.env.MIST_LOCAL_API_PORT = String(API_PORT); process.env.BAMBOOK_AI_SUBSCRIPTION_DIR = await mkdtemp(path.join(tmpdir(), 'agent-acceptance-ai-'));
const { createMistLocalRuntime } = await import('../src/mist/local');
const { createMistServer } = await import('../src/mist/server');
const tool = (name: string, args: object) => JSON.stringify({ name, arguments: args });
const finish = (result: string) => tool('bambook_task', { action: 'finish', outcome: 'succeeded', result });
function plan(text: string) {
  const facts = JSON.parse(text.slice(text.indexOf('{'))), task = facts.task, done = facts.history?.recent ?? [], asked = task.instructions as string;
  const count = (name: string) => done.filter((d: any) => d.name === name).length;
  const mail = asked.includes('归档邮件');
  if (count('bambook_query') === 0) return tool('bambook_query', { type: mail ? 'email' : 'order', limit: 5 });
  if (facts.requiresRead) return tool('bambook_get', { type: mail ? 'email' : 'order', id: done.find((d: any) => d.name === 'bambook_query').result.results[0].id });
  if (asked.includes('问我') && !(task.questions ?? []).length) return tool('bambook_task', { action: 'question', question: '要看哪个客户？' });
  if (mail && count('bambook_execute') === 0) return tool('bambook_execute', { command: { type: 'email.move', payload: { id: done.find((d: any) => d.name === 'bambook_query').result.results[0].id, folder: 'archive' } } });
  const rows: any[] = done.find((d: any) => d.name === 'bambook_query')?.result?.results ?? [];
  const table = rows.slice(0, 4).map((r: any) => `| ${r.label} | ${String(r.summary?.customer ?? r.summary?.state ?? '').slice(0, 14)} | ${String(r.summary?.due ?? '—')} |`).join('\n');
  return finish(`## 交期最近的订单\n\n共查到 **${rows.length}** 张，需要优先跟进的是：\n\n| 订单 | 客户/状态 | 交期 |\n| --- | --- | --- |\n${table}\n\n**建议下一步**\n\n1. 先核对 ${rows[0]?.label ?? ''} 的备料进度\n2. 与客户 Cedar & Crown 确认出运窗口\n3. 逾期订单逐张说明原因\n\n> 以上只读，没有改动任何记录。`);
}
const local = createMistLocalRuntime({ directory: await mkdtemp(path.join(tmpdir(), 'agent-acceptance-')) });
// AGENT_MODEL=haiku（或 sonnet）时改用本机 Claude 命令行作真实模型，看真实回答在界面上的样子；默认仍是脚本化模型。
const realModel = process.env.AGENT_MODEL;
async function askClaude(system: string, user: string): Promise<string> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', realModel!, '--output-format', 'text', '--tools', '', '--system-prompt', system], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('model timeout')); }, 110_000);
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => { clearTimeout(timer); code === 0 && out.trim() ? resolve(out.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) : reject(new Error('claude exit ' + code + ' ' + err.slice(0, 200))); });
    child.stdin.end(user);
  });
}
const complete = async (input: any) => {
  if (realModel) { const system = [input.systemPrompt, ...(input.messages ?? []).filter((m: any) => m.role === 'system').map((m: any) => m.content)].filter(Boolean).join('\n'); return askClaude(system, (input.messages ?? []).filter((m: any) => m.role !== 'system').map((m: any) => m.content).join('\n')); }
  const user = input.messages?.at?.(-1)?.content ?? input.user ?? JSON.stringify(input); const text = String(user); return plan(text.slice(text.indexOf('User request:') + 13));
};
const app = createMistServer(undefined, { local, agentTasks: { complete, tickMs: 1000, pulseMs: 200 } });
(app.locals.platformTaskWorker as any).start(1000);
(app.locals.automationWorker as any).start(3000);
app.listen(API_PORT, '127.0.0.1');
const { createServer } = await import('vite');
const { mistDevelopmentProxy } = await import(path.join(ROOT, 'scripts/mist-dev-target.mjs'));
const web = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.mist.config.ts'), server: { port: WEB_PORT, strictPort: true, proxy: mistDevelopmentProxy(false) }, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') } });
await web.listen(); console.log(`acceptance ready http://localhost:${WEB_PORT}/?view=assistant`);
}
main().catch(error => { console.error(error); process.exit(1); });
