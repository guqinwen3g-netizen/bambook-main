/** Server-recorded provenance of one submitted main review; never accepted from a command payload. */
export type OrderMainApprovalSource={
  schemaVersion:1;
  mode:'organization'|'explicit';
  companyId:string;
  businessLine:'garment'|'fabric';
  requesterId:string;
  departmentSnapshotId:string;
};
export type SubmittedOrderMain={source:OrderMainApprovalSource;reviewerIds:readonly string[]};
const keys=new Set(['schemaVersion','mode','companyId','businessLine','requesterId','departmentSnapshotId']);
const reference=(value:unknown):value is string=>typeof value==='string'&&!!value&&value===value.trim()&&value.length<=200;
export function parseOrderMainApprovalSource(value:unknown,expected:Partial<Pick<OrderMainApprovalSource,'companyId'|'businessLine'|'requesterId'>>={}):OrderMainApprovalSource|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==keys.size||Object.keys(v).some(k=>!keys.has(k))||v.schemaVersion!==1||(v.mode!=='organization'&&v.mode!=='explicit')||(v.businessLine!=='garment'&&v.businessLine!=='fabric')||!reference(v.companyId)||!reference(v.requesterId)||!reference(v.departmentSnapshotId))return null;
  if(expected.companyId!==undefined&&v.companyId!==expected.companyId||expected.businessLine!==undefined&&v.businessLine!==expected.businessLine||expected.requesterId!==undefined&&v.requesterId!==expected.requesterId)return null;
  return{schemaVersion:1,mode:v.mode as OrderMainApprovalSource['mode'],companyId:v.companyId,businessLine:v.businessLine as OrderMainApprovalSource['businessLine'],requesterId:v.requesterId,departmentSnapshotId:v.departmentSnapshotId};
}
