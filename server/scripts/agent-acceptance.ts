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
  return finish(`已读取 ${done.find((d: any) => d.name === 'bambook_query')?.result?.results?.length ?? 0} 张订单。本机验收回答：${asked.slice(-40)}`);
}
const local = createMistLocalRuntime({ directory: await mkdtemp(path.join(tmpdir(), 'agent-acceptance-')) });
const complete = async (input: any) => { const user = input.messages?.at?.(-1)?.content ?? input.user ?? JSON.stringify(input); const text = String(user); return plan(text.slice(text.indexOf('User request:') + 13)); };
const app = createMistServer(undefined, { local, agentTasks: { complete, tickMs: 1000, pulseMs: 200 } });
(app.locals.platformTaskWorker as any).start(1000);
app.listen(API_PORT, '127.0.0.1');
const { createServer } = await import('vite');
const { mistDevelopmentProxy } = await import(path.join(ROOT, 'scripts/mist-dev-target.mjs'));
const web = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.mist.config.ts'), server: { port: WEB_PORT, strictPort: true, proxy: mistDevelopmentProxy(false) }, define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') } });
await web.listen(); console.log(`acceptance ready http://localhost:${WEB_PORT}/?view=assistant`);
}
main().catch(error => { console.error(error); process.exit(1); });
