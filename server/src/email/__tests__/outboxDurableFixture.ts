/** Stateful synthetic native delegates; real producer and route are never mocked.
 * Does not prove PostgreSQL locking (qualified separately by native probes). */
import { vi } from 'vitest';
export function durableFixture(emailRow: any, opts: { readFail?: string; updateFail?: boolean; auditFail?: boolean; actorId?: string } = {}) {
  const state: any = { email: emailRow, attempt: null };
  const audits: any[] = [];
  const models: any = {
    email: {
      findUnique: vi.fn(async () => { if (opts.readFail) throw Error(opts.readFail); return state.email && { ...state.email }; }),
      // Mailbox ownership gate in the route (findFirst by id + mailboxOwnerUserId + deletedAt:null). A row without an
      // owner field is treated as the actor's own; a different owner or a soft-deleted row is not found.
      findFirst: vi.fn(async ({ where }: any = {}) => {
        if (opts.readFail) throw Error(opts.readFail);
        const row = state.email; if (!row) return null;
        if (where?.id && where.id !== row.id) return null;
        if (where?.mailboxOwnerUserId && row.mailboxOwnerUserId && row.mailboxOwnerUserId !== where.mailboxOwnerUserId) return null;
        if (where?.deletedAt === null && row.deletedAt) return null;
        return { ...row };
      }),
      update: vi.fn(async ({data}: any) => { if (opts.updateFail) throw Error('DB_LOCK'); return Object.assign(state.email, data); }),
    },
    userAccount: {findUnique: vi.fn(async () => ({id: opts.actorId || 'u1', status:'active', deletedAt:null,
      roles:[{role:{id:'synthetic-native-writer',permissions:[{permission:{scope:'emails:write'}}]}}]}))},
    userPermissionOverrides: {findMany: vi.fn(async()=>[])},
    emailSendAttempt: {
      findUnique: vi.fn(async()=>state.attempt && {...state.attempt}),
      create: vi.fn(async({data}:any)=>{if(state.attempt)throw Error('duplicate reservation');state.attempt={...data};return state.attempt}),
      update: vi.fn(async({data}:any)=>Object.assign(state.attempt,data)),
      updateMany: vi.fn(async({where,data}:any)=>{if(!state.attempt || Object.entries(where).some(([key,value])=>state.attempt[key]!==value))return {count:0};Object.assign(state.attempt,data);return {count:1}}),
    },
    auditLog: {
      create: vi.fn(async({data}:any)=>{if(opts.auditFail)throw Error('AUDIT_REJECT');audits.push(data);return data}),
      findUnique: vi.fn(async({where}:any)=>audits.find(row=>row.id===where.id)||null),
    },
    $queryRaw: vi.fn(async()=>[]),
  };
  let queue=Promise.resolve();
  const prisma:any={...models,$transaction:vi.fn(async(fn:any)=>{
    const previous=queue;let release!:()=>void;queue=new Promise<void>(r=>release=r);await previous;
    const before=structuredClone(state), prior=structuredClone(audits);
    try{return await fn(models)}catch(error){if(state.email&&before.email)Object.assign(state.email,before.email);else state.email=before.email;state.attempt=before.attempt;audits.splice(0,audits.length,...prior);throw error}finally{release()}
  })};
  return {prisma,state,audits};
}
