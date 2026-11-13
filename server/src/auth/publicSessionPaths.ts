/** These routes authenticate independently or expose only connection health/mode. Company lists remain private. */
const anonymousAuth=/^(?:\/(?:bambook\/)?api)?\/auth\/(?:login(?:\/mfa)?|logout|send-code|register|account-access\/(?:request|complete))\/?$/;
const discovery=/^\/(?:bambook\/)?api\/(?:health|mist\/session)\/?$/;
export function isPublicSessionPath(path:string):boolean{return anonymousAuth.test(path)||discovery.test(path);}
