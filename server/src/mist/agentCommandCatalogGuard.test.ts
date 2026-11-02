import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { MIST_COMMAND_CATALOG } from './agentCommandCatalog';
import { mistCommandPermission, type MistCommand } from '../shared/mistWorkspace';
import { AGENT_EXCLUDED_COMMANDS } from '../../../scripts/gen-mist-command-catalog.mjs';

/**
 * 命令目录守卫：目录与 server/src/shared 的命令声明、处理分支、权限映射三者不得漂移。
 * 声明用 TypeScript 语法树枚举（含 `type: 'a' | 'b'` 联合写法），不依赖目录生成器自己的正则。
 */
const SHARED = path.resolve(__dirname, '../shared');
const sources = fs.readdirSync(SHARED).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()
  .map(file => ({ file, text: fs.readFileSync(path.join(SHARED, file), 'utf8') }));
const catalogTypes = MIST_COMMAND_CATALOG.map(entry => entry.type);

function declaredCommandTypes() {
  const found = new Set<string>();
  for (const { file, text } of sources) {
    const visit = (node: ts.Node) => {
      if (ts.isTypeLiteralNode(node)) {
        const props = node.members.filter(ts.isPropertySignature), named = (n: string) => props.find(p => p.name.getText() === n);
        const type = named('type')?.type;
        if (type && named('payload')) for (const member of ts.isUnionTypeNode(type) ? type.types : [type])
          if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal) && /^[a-z]\w*(\.\w+)+$/.test(member.literal.text)) found.add(member.literal.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  }
  return found;
}

/** 处理分支：`case 'x'`、`=== 'x'` 或列入一个命令数组 / includes 判断。 */
function handled(type: string) {
  const q = type.replace(/\./g, '\\.');
  const pattern = new RegExp(`case\\s*'${q}'|===\\s*'${q}'|!==\\s*'${q}'|\\[[^\\]]*'${q}'[^\\]]*\\]`);
  return sources.some(({ text }) => pattern.test(text.replace(/(\{\s*)?type:\s*'[^']+'\s*(\|\s*'[^']+'\s*)*;\s*payload/g, '')));
}

/** 不在 shared 处理、由仓储换成其他命令执行的类型。 */
const HANDLED_IN_REPOSITORY: Record<string, string> = {
  'agent.proposal.confirm': 'repository.ts#execute 换成提议里的原命令，按本人身份走完整门禁；shared 对它一律拒绝',
};
/** 权限为 null 的命令：仓储层另有专门门禁，逐条写明原因。 */
const NULL_PERMISSION_ALLOWLIST: Record<string, string> = {
  'agent.proposal.reject': '撤销本人待办提议，不依赖 AI 权限；领域层只认 ownerId 本人且拒绝 Agent（mistAgentProposals.ts）',
  'agent.task.cancel': '停止本人任务是安全动作，收回 ai:chat 后仍须能停；仓储拒绝 Agent，changeTask 只认任务创建人（agentTasks.ts#owner），REST 停止与 /commands 同一路径',
  'calendar.save': 'MEMBER_PERSONAL_COMMANDS：仓储按当前账号可见日程与可读来源核对',
  'notification.read': 'MEMBER_PERSONAL_COMMANDS：仓储按当前账号可见通知核对',
  'notification.readAll': 'MEMBER_PERSONAL_COMMANDS：只处理当前账号可见通知',
  'task.complete': 'MEMBER_PERSONAL_COMMANDS：仓储按当前账号可见事项核对',
  'settings.update': '仓储对 null 权限限定为公司管理员 / 工作区所有者',
  'member.groups.set': '仓储对 null 权限限定为公司管理员 / 工作区所有者',
  'handover.account': '按账号整体交接，仓储对 null 权限限定为公司管理员 / 工作区所有者',
};
/** 权限依赖 payload 字段的命令：给出最小有效 payload 才能取到映射。 */
const PERMISSION_PAYLOAD: Record<string, Record<string, unknown>> = {
  'fulfillment.qc.request': { source: { kind: 'order' }, domain: 'garment' },
  'market.attachment.set': { kind: 'product' },
  'market.import': { kind: 'customer' },
};

describe('命令目录守卫', () => {
  it('目录与 shared 中声明的命令完全一致（包括 type 联合写法）', () => {
    const declared = declaredCommandTypes();
    expect([...declared].filter(t => !catalogTypes.includes(t) && !Object.hasOwn(AGENT_EXCLUDED_COMMANDS, t)).sort()).toEqual([]);
    expect(catalogTypes.filter(t => !declared.has(t))).toEqual([]);
  });
  it('目录中每个命令在 shared 都有处理分支', () => {
    expect(catalogTypes.length).toBeGreaterThan(300);
    expect(catalogTypes.filter(t => !HANDLED_IN_REPOSITORY[t] && !handled(t))).toEqual([]);
    expect(Object.keys(HANDLED_IN_REPOSITORY).filter(t => !catalogTypes.includes(t))).toEqual([]);
  });
  it('目录中每个命令都有权限映射，null 只允许白名单', () => {
    const problems: string[] = [];
    for (const type of catalogTypes) {
      let permission: string | null;
      try { permission = mistCommandPermission({ type, payload: PERMISSION_PAYLOAD[type] ?? {} } as unknown as MistCommand); }
      catch (error) { problems.push(`${type}: ${(error as Error).message}`); continue; }
      if (permission === null && !NULL_PERMISSION_ALLOWLIST[type]) problems.push(`${type}: null`);
      if (permission !== null && NULL_PERMISSION_ALLOWLIST[type]) problems.push(`${type}: 白名单已过期（实际 ${permission}）`);
    }
    expect(problems).toEqual([]);
    expect(Object.keys(NULL_PERMISSION_ALLOWLIST).filter(t => !catalogTypes.includes(t))).toEqual([]);
  });
  it('永远失败或已停用的命令不进入目录', () => {
    for (const retired of ['development.billing.request', 'finance.developmentInvoice.issue', 'platform.goods.transition', 'market.quotation.send', 'market.quotation.respond']) expect(catalogTypes).not.toContain(retired);
  });
  it('源码保留但不登记的命令写明原因，且确实不在目录', () => {
    for (const [type, reason] of Object.entries(AGENT_EXCLUDED_COMMANDS)) { expect(declaredCommandTypes().has(type)).toBe(true); expect(String(reason).length).toBeGreaterThan(10); expect(catalogTypes).not.toContain(type); }
  });
});
