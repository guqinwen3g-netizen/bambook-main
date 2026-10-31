export type AgentConnectionMode='read'|'operate';
export type AgentConnectionView={id:string;name:string;mode:AgentConnectionMode;version:number;state:'active'|'expired'|'revoked'|'invalid';createdAt:string;expiresAt:string;renewedAt?:string;revokedAt?:string};
export type AgentConnectionPage={items:AgentConnectionView[];nextCursor:string|null;canConnect:boolean};
