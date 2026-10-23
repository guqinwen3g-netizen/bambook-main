import {expect,it} from 'vitest';
import type {TokenPayload} from '../auth/service';
import {projectState} from './access';
import {materialDeliveryFixture} from './__tests__/materialDelivery';
import {createMistState} from '../shared/mistWorkspace';
import {orderActualCost} from '../shared/mistOrderCost';
const scopes=['orders:read','procurement:read','invoices:read','vouchers:read','reports:admin'];
const actor=(permissions=scopes)=>({userId:'finance',roles:[],permissions,authorizationLoaded:true,departmentIds:[]} as TokenPayload);
function fixture(){const f=materialDeliveryFixture();const empty=()=>createMistState(f.context,'empty');return {f,view:(permissions=scopes)=>projectState(f.state,actor(permissions),empty)};}
const cost=(state:any,id:string,basis?:any)=>orderActualCost(state,id,'period','2026-10','2026-10-24',basis);
it('preserves internal material cost for finance without granting warehouse records or changing persisted state',()=>{
 const {f,view}=fixture(),id=f.issue(50);f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,evidence:'Receiver counted'}},'garment');const before=structuredClone(f.state),v=view();
 expect(v.state.fulfillment.stock).toEqual([]);expect(v.state.fulfillment.stockMovements).toEqual([]);expect(v.state.fulfillment.warehouses).toEqual([]);expect(v.hidden.some(s=>s.key==='inventory')).toBe(true);
 expect(cost(v.state,f.target.orderId).purchaseCny).toBe(20);expect(cost(v.state,f.target.orderId,v.costMaterialBasis).purchaseCny).toBe(3420);expect(cost(v.state,f.source.orderId,v.costMaterialBasis).purchaseCny).toBe(3420.4);
 expect(v.costMaterialBasis).toHaveLength(1);expect(JSON.stringify(v.costMaterialBasis)).not.toMatch(/location|evidence|stockId|person|fileIds|quantity/);expect((v.state as any).costMaterialBasis).toBeUndefined();expect(f.state).toEqual(before);
});
it('does not turn planned or unconfirmed delivery into transferred cost, and refreshes exact financial proportions after a return',()=>{
 const {f,view}=fixture(),id=f.issue(20);expect(cost(view().state,f.target.orderId,view().costMaterialBasis).purchaseCny).toBe(20);f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,evidence:'Counted'}},'garment');expect(cost(view().state,f.target.orderId,view().costMaterialBasis).purchaseCny).toBe(1380);
 f.run({type:'fulfillment.inventory.move',payload:{id:f.state.fulfillment.stock[0].id,kind:'return',quantity:5,issueId:id,location:'A-01',person:'factory',note:'Surplus returned'}});const v=view();expect(cost(v.state,f.target.orderId,v.costMaterialBasis).purchaseCny).toBe(1040);expect(cost(v.state,f.source.orderId,v.costMaterialBasis).purchaseCny).toBe(5800.4);
});
it('requires financial-report and source read scopes together, while leaving ordinary procurement and warehouse access unchanged',()=>{
 const {f,view}=fixture();for(const missing of scopes)expect(view(scopes.filter(s=>s!==missing)).costMaterialBasis).toBeUndefined();expect(view(['procurement:read']).costMaterialBasis).toBeUndefined();expect(view(['inventory:read']).costMaterialBasis).toBeUndefined();expect(view(['inventory:read']).state.fulfillment.stock).toEqual(f.state.fulfillment.stock);
});
it('rejects missing or malformed projected proportions, and authoritative calculations ignore a restored lookalike field',()=>{
 const {f,view}=fixture(),id=f.issue();f.run({type:'fulfillment.materials.confirm',payload:{kind:'issue',id,evidence:'Counted'}},'garment');const v=view();expect(()=>cost(v.state,f.target.orderId,null)).toThrow('依据未读取');expect(()=>cost(v.state,f.target.orderId,[])).toThrow('不完整');expect(()=>cost(v.state,f.target.orderId,[{purchaseId:f.purchaseId,weights:[{orderId:f.target.orderId,weight:'0'}]}])).toThrow('比例无效');
 (f.state as any).costMaterialBasis=[{purchaseId:f.purchaseId,weights:[{orderId:f.source.orderId,weight:'1'}]}];expect(cost(f.state,f.target.orderId).purchaseCny).toBe(6840.4);const fresh=view();expect((fresh.state as any).costMaterialBasis).toBeUndefined();expect(cost(fresh.state,f.target.orderId,fresh.costMaterialBasis).purchaseCny).toBe(6840.4);
});

it('keeps minimal workspaces readable before a fulfillment module exists',()=>{const {f}=fixture();const minimal={...f.state} as any;delete minimal.fulfillment;const before=structuredClone(minimal);const result=projectState(minimal,actor(),()=>createMistState(f.context,'empty'));expect(result.costMaterialBasis).toEqual([]);expect(minimal).toEqual(before);});
