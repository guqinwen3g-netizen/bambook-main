import {expect,it} from 'vitest';
import {queryMistReceipts} from './receiptQuery';

it('paginates an ascending keyset across equal timestamps and later dates without dropping or repeating a row',()=>{
 const rows=[{id:'c',createdAt:'2026-11-01T00:01:00Z'},{id:'b',createdAt:'2026-11-01T00:00:00Z'},{id:'a',createdAt:'2026-11-01T00:00:00Z'}],orderBy=[{createdAt:'asc'},{id:'asc'}];
 const first=queryMistReceipts(rows,{orderBy,take:1}),cursor=first[0],rest=queryMistReceipts(rows,{where:{OR:[{createdAt:{gt:new Date(cursor.createdAt)}},{createdAt:new Date(cursor.createdAt),id:{gt:cursor.id}}]},orderBy});
 expect([...first,...rest].map(r=>r.id)).toEqual(['a','b','c']);expect(rest.map(r=>r.id)).not.toContain(cursor.id);
});
