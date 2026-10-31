export type AgentIdentityView = {
  id:string; name:string; ownerId:string; ownerName:string; mode:'read'|'operate'; version:number;
  state:'pending'|'active'|'disabled'|'revoked'|'expired'|'invalid';
  createdAt:string; expiresAt?:string; activatedAt?:string; canManage:boolean; canIssue:boolean;
};
export type AgentIdentityPage = {items:AgentIdentityView[];canManage:boolean;owners:Array<{id:string;name:string}>;nextCursor:string|null};
export type AgentIdentityEvent={action:'created'|'configured'|'issued'|'revoked';actor:{id:string;name:string};at:string;version:number;ownerId:string;ownerName:string;mode:'read'|'operate';enabled:boolean};
