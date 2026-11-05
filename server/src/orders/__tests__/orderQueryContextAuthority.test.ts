import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordAuthorityFixtureProof } from '../../auth/__tests__/currentAuthorityFixtureProof';
import { queryOrders } from '../query';

// Storage-only substitute: real current account/grant/scope and domain queries run.
// No authorization, source or money helper is mocked. All writes/SQL are forbidden.
const allScopes = ['orders:read', 'products:read', 'quotations:read', 'bom:read',
  'procurement:read', 'production:read', 'shipments:read', 'customs:read',
  'invoices:read', 'vouchers:read'];
const actor = (ceiling?: string[]) => ({ userId: 'sales-1', roles: ['sales'] as any,
  permissions: allScopes, authorizationLoaded: true as const,
  ...(ceiling !== undefined ? { permissionCeiling: ceiling } : {}) });
function matches(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k,v]: any) => {
    if (k === 'AND') return (Array.isArray(v) ? v : [v]).every(x => matches(row,x));
    if (k === 'OR') return v.some((x: any) => matches(row,x));
    if (k === 'NOT') return !matches(row,v);
    const actual = row[k] ?? null;
    if (v === null || typeof v !== 'object') return actual === v;
    if ('in' in v) return v.in.includes(actual);
    if ('contains' in v) return String(actual ?? '').toLowerCase().includes(String(v.contains).toLowerCase());
    if ('has' in v) return Array.isArray(actual) && actual.includes(v.has);
    if ('equals' in v) return actual === v.equals;
    if ('gt' in v) return actual > v.gt;
    if ('gte' in v) return actual >= v.gte;
    if ('lte' in v) return actual <= v.lte;
    return matches(actual,v);
  });
}
function project(row: any, select?: any): any {
  if (!select) return { ...row };
  return Object.fromEntries(Object.entries(select).filter(([,v]) => v).map(([k,v]: any) => [k,
    v === true ? row[k] : Array.isArray(row[k]) ? row[k].map((x: any) => project(x,v.select)) : project(row[k] ?? {},v.select)]));
}
let latestFixture: any;
function store() {
  const s = {
    grants: [...allScopes], active: true, hook: undefined as undefined | ((model: string,args: any) => void),
    rows: {
      order: [{ id:'O1', poNumber:'PO1', deletedAt:null, customerRelationId:'R1', ownerId:'sales-1', sourceCaseId:null, lines:[] },
        { id:'O2', poNumber:'PO2', deletedAt:null, customerRelationId:'R2', ownerId:'other', sourceCaseId:null, lines:[] }],
      relation: [{ id:'R1', deletedAt:null, ownerId:'sales-1', salesRepIds:[] }, { id:'R2', deletedAt:null, ownerId:'other', salesRepIds:[] }],
      teamMember: [], teamDataGrant: [], userPermissionOverrides: [],
      quotation: [], developmentCase: [], sample: [], sealSample: [], sampleBatch: [], bOM: [], purchaseOrder: [],
      productionStage: [], inspectionReport: [], outsourcingOrder: [], shipment: [], shipmentOrderAllocation: [],
      invoice: [], invoiceOrderAllocation: [], paymentVoucher: [], invoiceAllocation: [], customsDeclaration: [], taxRefund: [],
    } as Record<string,any[]>,
    writes: [] as string[], db: {} as any,
  };
  for (const name of Object.keys(s.rows)) {
    const read = async (args: any = {}) => {
      s.hook?.(name,args);
      const rows = s.rows[name].filter(x => matches(x,args.where));
      const offset = args.skip ?? 0, end = args.take === undefined ? undefined : offset + args.take;
      return rows.slice(offset,end).map(x => project(x,args.select));
    };
    s.db[name] = { findMany:vi.fn(read), findFirst:vi.fn(async (a: any) => (await read(a))[0] ?? null),
      count:vi.fn(async (a: any) => (await read(a)).length) };
    for (const method of ['create','update','updateMany','delete','deleteMany','upsert']) {
      s.db[name][method] = vi.fn(() => { s.writes.push(name+'.'+method); throw Error('WRITE_FORBIDDEN'); });
    }
  }
  const currentAccount = () => ({
    id:'sales-1', status:s.active ? 'active':'disabled', deletedAt:null, displayName:'Sales', primaryDeptId:null,
    roles:[{roleId:'role-sales', departmentId:null, role:{id:'role-sales', permissions:s.grants.map(scope => ({permission:{scope}}))}}],
  });
  s.db.userAccount = { findFirst:vi.fn(async ({where}: any) => where.id === 'sales-1' ? currentAccount() : null),
    findUnique:vi.fn(async ({where,select}: any) => { const current=currentAccount(); return matches(current,where) ? project(current,select) : null; }) };
  s.db.$queryRaw = vi.fn(() => { s.writes.push('SQL'); throw Error('SQL_FORBIDDEN'); });
  s.db.$executeRaw = s.db.$queryRaw;
  latestFixture = s;
  return s;
}
afterEach(async context=>recordAuthorityFixtureProof('orderQueryContextAuthority.test.ts',context.task,latestFixture));
describe('company Orders current authority source contracts', () => {
  it('list and count AND the same current Order L2 without replacing the search OR', async () => {
    const s=store();
    const list:any=await queryOrders(s.db,{query:'PO'},{actor:actor()});
    const count:any=await queryOrders(s.db,{aggregate:'count',query:'PO'},{actor:actor()});
    expect(list.items.map((x:any)=>x.id)).toEqual(['O1']);
    expect(list.total).toBe(1);expect(count.count).toBe(1);
    expect(s.db.order.findMany.mock.calls[0][0].where).toEqual(s.db.order.count.mock.calls[0][0].where);
    expect(s.db.order.count.mock.calls[0][0].where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({OR:expect.arrayContaining([{id:'PO'}])}),
      expect.objectContaining({OR:expect.arrayContaining([{customerRelationId:{in:['R1']}}])}),
    ])); expect(s.writes).toEqual([]);
  });
  it('revoked current orders grant is rejected even when the caller still carries old permissions', async () => {
    const s=store();s.grants=[];
    await expect(queryOrders(s.db,{},{actor:actor()})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(s.db.order.findMany).not.toHaveBeenCalled();
  });
  it('an empty ceiling and a body-supplied actor cannot manufacture read authority', async () => {
    const s=store();
    await expect(queryOrders(s.db,{actor:{userId:'owner',roles:['owner']},developmentRead:true},{actor:actor([])})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(s.db.order.findMany).not.toHaveBeenCalled();
    await expect((queryOrders as any)(s.db,{actor:{userId:'owner'},developmentRead:true})).rejects.toMatchObject({code:'UNAUTHORIZED'});
  });
  it('list row transfer after the initial read cannot survive the response-time parent scope check', async () => {
    const s=store();const native=s.db.order.findMany.getMockImplementation();let called=0;
    s.db.order.findMany.mockImplementation(async (args:any)=>{const rows=await native(args);if(++called===1)s.rows.order[0].customerRelationId='R2';return rows;});
    await expect(queryOrders(s.db,{query:'PO'},{actor:actor()})).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it('count is freshly scoped after a customer transfer rather than returning a stale count', async () => {
    const s=store();const native=s.db.order.count.getMockImplementation();let called=0;
    s.db.order.count.mockImplementation(async (args:any)=>{const count=await native(args);if(++called===1)s.rows.order[0].customerRelationId='R2';return count;});
    const res:any=await queryOrders(s.db,{aggregate:'count'},{actor:actor()});
    expect(res.count).toBe(0);expect(s.db.order.findMany).not.toHaveBeenCalled();
  });
});
