import {expect,it} from 'vitest';
import {orderLineProduct} from './OrderProductThumb';
import {createMistState} from '../../../../server/src/shared/mistWorkspace';
it('resolves fabric by its own source and never uses a garment with the same SKU',()=>{
 const state=createMistState({id:()=>crypto.randomUUID(),now:'2026-10-19T00:00:00Z',actorName:'owner'},'empty');
 state.market!.products=[{id:'f',sku:'FAB-1',category:'fabric'},{id:'g',sku:'FAB-1',category:'garment'}] as any;
 const line={style:'FAB-1',sourceProductId:'f'} as any;
 expect(orderLineProduct(state,line,'fabric')?.id).toBe('f');
 expect(orderLineProduct(state,{...line,sourceProductId:'g'},'fabric')).toBeUndefined();
 expect(orderLineProduct(state,{style:'FAB-1'} as any,'fabric')?.id).toBe('f');
 expect(orderLineProduct(state,{style:'UNKNOWN'} as any,'fabric')).toBeUndefined();
});
