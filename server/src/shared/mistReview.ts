/** Server-derived review tasks. They expose only the submitted business snapshot. */
export type MistReviewTask = {
  id:string; kind:'procurement'|'procurementAmendment'|'quotation'|'claim'|'order'|'payment'|'risk'|'productionIntake'|'qcConcession'|'stockCount'; entityId:string; title:string;
  requesterId:string; reviewerIds:string[]; status:'pending'|'approved'|'rejected'; submittedAt:string;
  requiredPermission:string; fileIds?:string[];
  /** 批准时是否须当场手写签字（listReviews 按审批类型给出，见 mistSignatures）。 */
  signatureRequired?:boolean; target:{view:string;id:string}; details:Array<{label:string;value:string}>;
  /** 已处理事项的决定：经办人、时间与意见（取自原业务记录，不另存）。 */
  decision?:{actor:string;at:string;note?:string};
};
/** 只在有经办人和时间时给出决定，空串一律不显示。 */
export function reviewDecision(actor:unknown,at:unknown,note?:unknown):MistReviewTask['decision']{
  if(typeof actor!=='string'||!actor.trim()||typeof at!=='string'||!at.trim())return undefined;
  return {actor:actor.trim(),at,...(typeof note==='string'&&note.trim()?{note:note.trim()}:{})};
}
