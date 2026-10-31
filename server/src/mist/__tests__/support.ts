import { randomUUID } from 'node:crypto';
import type { TokenPayload } from '../../auth/service';
import { MistApiError } from '../errors';
import type { MistContract } from '../repository';
import { queryMistReceipts } from '../receiptQuery';
/** 最小的 Prisma where 子集：字段相等、OR、state JSON 数组包含。 */
function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]: [string, any]) => key === 'OR' ? value.some((rule: any) => matches(row, rule))
    : key === 'state' ? (row.state[value.path?.[0] || 'reviewerIds'] || []).includes(value.array_contains[0]) : (row[key] ?? null) === value);
}
/** In-memory transactional test fixture only. It never connects to a database. */
export class MemoryMistDatabase {
  workspaces = new Map<string, any>(); receipts = new Map<string, any>(); businessSequences = new Map<string, any>(); failReceipt = false;
  /** 账号表（包 A 成员目录）：未登记的账号视为在职账号、显示名为账号编号；测试可登记停用 / 删除状态。 */
  accounts = new Map<string, { displayName?: string; status?: string; deletedAt?: Date | null }>();
  /** 公司成员表（公司单库名册）：仅公司会话的测试需要登记。 */
  companyMembers: Array<{ companyId: string; userId: string; status: string; joinedAt?: Date; createdAt?: Date }> = [];
  /** 人事小组（经部门归属公司）：仅小组范围测试需要登记。 */
  teams: Array<{ id: string; name: string; companyId: string; status?: string; deletedAt?: bigint | null }> = [];
  /** 小组成员、部门（负责人与上下级）与账号所属部门：仅行级范围测试需要登记。 */
  teamMembers: Array<{ teamId: string; userId: string; leftAt?: Date | null }> = [];
  departments: Array<{ id: string; companyId: string; parentId: string | null; headId: string | null; status?: string }> = [];
  userDepartments = new Map<string, string>();
  private queue = Promise.resolve();
  private delegates(workspaces: Map<string, any>, receipts: Map<string, any>, businessSequences = this.businessSequences) {
    return {
      $queryRawUnsafe: async () => [],
      team: {
        findMany: async ({ where }: any) => this.teams.filter(t => t.companyId === where.department?.companyId && (t.status ?? 'active') === where.status && !t.deletedAt).map(t => ({ id: t.id, name: t.name })),
      },
      teamMember: {
        findMany: async ({ where }: any) => this.teamMembers.filter(m => m.userId === where.userId && !m.leftAt && this.teams.some(t => t.id === m.teamId && t.companyId === where.team?.department?.companyId && !t.deletedAt && (t.status ?? 'active') === 'active')).map(m => ({ teamId: m.teamId })),
      },
      department: {
        findMany: async ({ where }: any) => this.departments.filter(d => d.companyId === where.companyId && (d.status ?? 'active') === where.status).map(({ id, parentId, headId }) => ({ id, parentId, headId })),
      },
      companyMember: {
        findMany: async ({ where }: any) => this.companyMembers.filter(m => m.companyId === where.companyId && (!where.status || m.status === where.status)).flatMap(m => {
          const a = this.accounts.get(m.userId), user = { displayName: a?.displayName ?? m.userId, status: a?.status ?? 'active', deletedAt: a?.deletedAt ?? null };
          if (where.user && (user.status !== where.user.status || user.deletedAt)) return [];
          return [{ userId: m.userId, joinedAt: m.joinedAt ?? new Date('2026-10-01T00:00:00Z'), createdAt: m.createdAt ?? new Date('2026-10-01T00:00:00Z'), user: { displayName: user.displayName } }];
        }),
      },
      userAccount: {
        findMany: async ({ where }: any) => where?.OR ? [...this.userDepartments.entries()].filter(([, dept]) => where.OR[0].primaryDeptId.in.includes(dept)).map(([id]) => ({ id })) : ((where?.id?.in ?? []) as string[]).map(id => { const a = this.accounts.get(id); return { id, displayName: a?.displayName ?? id, status: a?.status ?? 'active', deletedAt: a?.deletedAt ?? null }; }),
      },
      mistWorkspace: {
        findFirst: async ({ where }: any) => [...workspaces.values()].find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
        findMany: async ({ where }: any = {}) => [...workspaces.values()].filter(row => matches(row, where)),
        findUnique: async ({ where }: any) => [...workspaces.values()].find(row => row.ownerId === where.ownerId_slug.ownerId && row.slug === where.ownerId_slug.slug) ?? null,
        create: async ({ data }: any) => {
          if ([...workspaces.values()].some(row => row.ownerId === data.ownerId && row.slug === data.slug || data.companyId && row.companyId === data.companyId)) throw Object.assign(new Error('unique'), { code: 'P2002' });
          const row = { createdAt: new Date(), updatedAt: new Date(), ...data }; workspaces.set(row.id, row); return row;
        },
        update: async ({ where, data }: any) => { const original=workspaces.get(where.id);const row = { ...original, ...data, ...(typeof data.revision==='object'?{revision:original.revision+data.revision.increment}:{}), updatedAt: new Date() }; workspaces.set(row.id, row); return row; },
      },
      mistCommandReceipt: {
        findUnique: async ({ where }: any) => receipts.get(`${where.workspaceId_requestId.workspaceId}:${where.workspaceId_requestId.requestId}`) ?? null,
        findMany: async (args: any) => queryMistReceipts([...receipts.values()],args),
        create: async ({ data }: any) => { if (this.failReceipt) throw new Error('transaction failed'); receipts.set(`${data.workspaceId}:${data.requestId}`, data); return data; },
        updateMany:async({where,data}:any)=>{let count=0;for(const [key,row] of receipts)if(queryMistReceipts([row],{where}).length){if(!row.requestId.startsWith('mist-revision:agent-connection:'))throw new Error('Business receipts are immutable');receipts.set(key,{...row,...structuredClone(data)});count++;}return{count};},
      },
      businessSequence: {
        upsert: async ({where,create}:any) => { if(!businessSequences.has(where.id))businessSequences.set(where.id,structuredClone(create));return structuredClone(businessSequences.get(where.id)); },
        update: async ({where,data}:any) => {const prior=businessSequences.get(where.id);if(!prior)throw new Error('Sequence not found');const increment=data.seq?.increment;if(!Number.isSafeInteger(increment)||increment<1)throw new Error('Invalid sequence increment');const next={...prior,...data,seq:prior.seq+increment};businessSequences.set(where.id,next);return structuredClone(next);},
        findUnique: async ({where}:any) => structuredClone(businessSequences.get(where.id)??null),
      },
    };
  }
  get mistCommandReceipt() { return this.delegates(this.workspaces, this.receipts).mistCommandReceipt; }
  async $transaction<T>(run: (tx: any) => Promise<T>) {
    const previous = this.queue; let release!: () => void; this.queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    const workspaces = structuredClone(this.workspaces), receipts = structuredClone(this.receipts), businessSequences = structuredClone(this.businessSequences);
    try { const result = await run(this.delegates(workspaces, receipts, businessSequences)); this.workspaces = workspaces; this.receipts = receipts; this.businessSequences = businessSequences; return result; }
    finally { release(); }
  }
}
/** 只统计业务请求回执；不含服务端为并发合并记录的版本标记。 */
export const requestReceiptCount = (db: MemoryMistDatabase) => [...db.receipts.values()].filter(row => !String(row.requestId).startsWith('mist-revision:')).length;
export const testActor = (id = 'owner'): TokenPayload => ({ userId: id, displayName: id, roles: ['owner'], departmentIds: [], permissions: ['products:write', 'finance:write', 'vouchers:write', 'invoices:reconcile', 'invoices:write'] });
export function testAuthority() {
  const users = new Map([['owner', { active: true, permissions: ['products:write', 'finance:write', 'vouchers:write', 'invoices:reconcile', 'invoices:write'] }], ['other', { active: true, permissions: ['products:write'] }]]);
  return { users, authorize: async (_db: any, prior: TokenPayload, permission?: string | null) => {
    const current = users.get(prior?.userId);
    if (!current?.active) throw new MistApiError('ACCOUNT_DISABLED', '账号已失效', 401);
    if (permission && (!current.permissions.includes(permission) || prior.permissionCeiling && !prior.permissionCeiling.includes(permission) && !prior.permissionCeiling.includes('*'))) throw new MistApiError('FORBIDDEN', '权限不足', 403);
    return { ...prior, permissions: current.permissions };
  } };
}
export const testContract: MistContract = {
  createMistState: (_context, seed) => ({ money: { cents: seed === 'empty' ? 0 : 100 }, files: [], notes: [], settings: { workspaceName: 'Test workspace' } } as any),
  mistCommandPermission: (command: any) => command.type === 'money.add' ? 'finance:write' : 'products:write',
  applyMistCommand: (state: any, command: any) => {
    if (command.type === 'money.add') {
      const cents = command.payload.cents;
      if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(state.money.cents + cents)) throw new MistApiError('INVALID_AMOUNT', '金额无效');
      state.money.cents += cents; return { state, result: { cents: state.money.cents } };
    }
    if (command.type === 'notes.add') { const id = randomUUID(); state.notes.push({ id, text: command.payload.text }); return { state, result: { id } }; }
    if (command.type === 'products.setImages') { state.market = { products: [{ id: 'p1', fileIds: command.payload.fileIds }] }; return { state, result: { id: 'p1' } }; }
    if (command.type === 'files.add') { state.files.push(command.payload.file); return { state, result: { id: command.payload.file.id } }; }
    throw new MistApiError('VALIDATION', '未知命令');
  },
};
