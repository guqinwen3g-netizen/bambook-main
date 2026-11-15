import {MistCommandError,type MistContext,type MistCustomer,type MistState} from './mistWorkspace';
export const CUSTOMER_GRADE_SCOPE='relations:admin';
export const CUSTOMER_CREDIT_SCOPE='risk:admin';
type Fields=Pick<MistCustomer,'grade'|'creditLimit'|'currency'>;
/** Creating an unrated, zero-credit archive grants no rating or credit authority. */
export function customerFieldPermissions(before:Fields|undefined,after:Fields):string[]{
 const scopes:string[]=[];
 if((before?.grade?.trim()||'')!==after.grade.trim())scopes.push(CUSTOMER_GRADE_SCOPE);
 if((before?.creditLimit??0)!==after.creditLimit||!!before&&before.currency!==after.currency&&(before.creditLimit>0||after.creditLimit>0))scopes.push(CUSTOMER_CREDIT_SCOPE);
 return scopes;
}
export function assertCustomerFieldAuthority(context:MistContext,before:Fields|undefined,after:Fields):void{
 for(const scope of customerFieldPermissions(before,after))if(!context.can?.(scope))throw new MistCommandError('FORBIDDEN',scope===CUSTOMER_GRADE_SCOPE?'客户等级调整需要客户管理权限':'信用额度调整需要信用管理权限',403);
}
/** Runtime risk uses the actual changed credit, not the generic archive-write command name. */
export function customerCommandChangesCredit(command:{type?:string;payload?:any},state?:Pick<MistState,'customers'>|null):boolean{
 const p=command.payload;
 if(command.type==='market.customer.create')return p?.input?.creditLimit!==undefined&&Number(p.input.creditLimit)!==0;
 if(command.type==='market.import'&&p?.kind==='customer')return !Array.isArray(p.rows)||p.rows.some((row:any)=>Number(row?.creditLimit||0)!==0);
 if(!['market.customer.update','customer.update'].includes(command.type||''))return false;
 const patch=p?.patch;if(!patch||typeof patch!=='object')return false;
 const before=state?.customers.find(c=>c.id===p.id);
 if(!before)return Object.prototype.hasOwnProperty.call(patch,'creditLimit')||Object.prototype.hasOwnProperty.call(patch,'currency');
 const amount=patch.creditLimit===undefined?before.creditLimit:patch.creditLimit;
 if(typeof amount!=='number'||!Number.isFinite(amount)||amount!==before.creditLimit)return true;
 return patch.currency!==undefined&&patch.currency!==before.currency&&(before.creditLimit>0||amount>0);
}

/** Compound entry points (including proposals/imports) must not hide a protected field inside an archive command. */
export function customerCommandFieldPermissions(state:Pick<MistState,'customers'>,command:{type?:string;payload?:any}):string[]{
 const p=command.payload;const scopes=new Set<string>();
 const grade=(value:unknown)=>typeof value==='string'?value.trim():value===undefined?'':String(value);
 if(command.type==='market.customer.create'&&grade(p?.input?.grade))scopes.add(CUSTOMER_GRADE_SCOPE);
 if(['market.customer.update','customer.update'].includes(command.type||'')&&p?.patch?.grade!==undefined){const before=state.customers.find(c=>c.id===p.id);if(grade(p.patch.grade)!==grade(before?.grade))scopes.add(CUSTOMER_GRADE_SCOPE);}
 if(command.type==='market.import'&&p?.kind==='customer'&&Array.isArray(p.rows)&&p.rows.some((row:any)=>grade(row?.grade)))scopes.add(CUSTOMER_GRADE_SCOPE);
 if(customerCommandChangesCredit(command,state))scopes.add(CUSTOMER_CREDIT_SCOPE);
 return [...scopes];
}
export function assertCustomerCommandFieldAuthority(context:Pick<MistContext,'can'>,state:Pick<MistState,'customers'>,command:{type?:string;payload?:any}):string[]{
 const permissions=customerCommandFieldPermissions(state,command);
 for(const scope of permissions)if(!context.can?.(scope))throw new MistCommandError('FORBIDDEN',scope===CUSTOMER_GRADE_SCOPE?'客户等级调整需要客户管理权限':'信用额度调整需要信用管理权限',403);
 return permissions;
}
