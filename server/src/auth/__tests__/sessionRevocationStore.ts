/** Minimal persistent-store substitute for auth HTTP tests that already substitute UserAccount. */
export function sessionRevocationStore(){
 const rows=new Map<string,any>();
 return{
  findUnique:async({where}:{where:{id:string}})=>rows.get(where.id)??null,
  createMany:async({data}:{data:Array<{id:string;expiresAt:Date}>})=>{let count=0;for(const row of data)if(!rows.has(row.id)){rows.set(row.id,structuredClone(row));count++;}return{count};},
 };
}
