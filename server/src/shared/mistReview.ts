/** Server-derived review tasks. They expose only the submitted business snapshot. */
export type MistReviewTask = {
  id:string; kind:'procurement'|'procurementAmendment'|'quotation'|'claim'|'order'|'payment'|'risk'|'productionIntake'|'qcConcession'|'stockCount'; entityId:string; title:string;
  requesterId:string; reviewerIds:string[]; status:'pending'|'approved'|'rejected'; submittedAt:string;
  requiredPermission:string; fileIds?:string[];
  /** 批准时是否须当场手写签字（listReviews 按审批类型给出，见 mistSignatures）。 */
  signatureRequired?:boolean; target:{view:string;id:string}; details:Array<{label:string;value:string}>;
};
