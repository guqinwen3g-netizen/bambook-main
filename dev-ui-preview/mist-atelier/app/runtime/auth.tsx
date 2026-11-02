import { uiText, ui } from '../../../../services/interfaceLanguage';
import React from 'react';
import {
  canAccessView as authCanAccessView, checkAuth, getAuthApiBase, getAuthState,
  hasPermission as authHasPermission, hasRole as authHasRole,
  login as authLogin, logout as authLogout, mapAuthErrorMessage, renewSessionIfDue, subscribe,
  type AgentRole, type AuthState, type AuthUser,
} from '../../../../services/authService';
import type { View } from '../../../../types';
import { getViewPermissionDefinition } from '../../../../lib/modulePermissions';

export type MistSessionStatus = 'loading' | 'authenticated' | 'anonymous';
export type MistLoginOptions = { remember?: boolean; companyId?: string; entry?: 'company' | 'platform' };
export interface MistSession {
  status: MistSessionStatus;
  user: AuthUser | null;
  /** Opaque invalidation key. Never contains tokens, endpoints or user data. */
  sessionKey: string;
  error: string;
  refreshing: boolean;
  signingIn: boolean;
  signingOut: boolean;
  login: (identifier: string, password: string, options?: MistLoginOptions) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  canAccessView: (view: View) => boolean;
  hasPermission: (...permissions: string[]) => boolean;
  hasRole: (...roles: AgentRole[]) => boolean;
  /** Present only for the explicit server-provided local workspace mode. */
  localMode?: boolean;
  /** Discovery failed before the server could confirm a local or company session. No identity is authorized. */
  connectionModeUnverified?: boolean;
  localProfiles?: Array<{id:string;name:string;title?:string}>;
  selectLocalProfile?: (profileId:string) => Promise<void>;
}
const SessionContext = React.createContext<MistSession | null>(null);
const AUTH_TOKEN_KEY = 'bambook_auth_token';
// The user cache is a startup/display aid, never an authentication signal.
// Treating its writes/removals as credential changes makes signed-in and guest
// tabs revalidate each other indefinitely and retires an in-progress login.
const SESSION_STORAGE_KEYS = new Set([AUTH_TOKEN_KEY, 'panda_system_config', 'cloudEndpoint']);
/** 使用中续期的检查间隔；只有令牌已用过约一天时才真正请求换发。 */
const RENEW_CHECK_MS = 10 * 60 * 1000;

/** 同一登录会话的标识（服务端 sessionId；旧令牌退回令牌本身）。续期换发令牌不算换了身份。 */
function storedSession() {
  let token = '';
  try { token = localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || ''; }
  catch { return ''; }
  try { const claims = JSON.parse(atob((token.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/'))); if (typeof claims?.sessionId === 'string' && claims.sessionId) return 'session:' + claims.sessionId + ':' + claims.userId; }
  catch { /* opaque or legacy token */ }
  return token;
}
/** Used only inside this adapter. The public session key is a local revision. */
function identityOf(state: AuthState) {
  const user = state.isAuthenticated ? state.user : null;
  return JSON.stringify([
    getAuthApiBase(), storedSession(), state.isAuthenticated, user?.id, user?.platformRole,
    [...(user?.roles ?? [])].sort(), [...(user?.roleIds ?? [])].sort(),
    [...(user?.permissions ?? [])].sort(), user?.permissionCeiling === undefined ? null : [...user.permissionCeiling].sort(),
    [...(user?.departmentIds ?? [])].sort(), user?.globalBusinessScope, [...(user?.businessAttributes ?? [])].sort(),
  ]);
}

/** Reuses the production auth service. No demo identity or automatic dev login. */
function ProductionMistSessionProvider({ children }: { children: React.ReactNode }) {
  const instanceId = React.useId();
  const [auth, setAuth] = React.useState(getAuthState);
  const [initializing, setInitializing] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(true);
  const [signingIn, setSigningIn] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [error, setError] = React.useState('');
  const [revision, setRevision] = React.useState(0);
  const [contextUnverified, setContextUnverified] = React.useState(false);
  const verificationBaseline = React.useRef<AuthUser | null | undefined>(undefined);
  const mounted = React.useRef(false);
  const identity = React.useRef(identityOf(auth));
  const refreshSequence = React.useRef(0);
  const commandSequence = React.useRef(0);
  const publicStatus = React.useRef<MistSessionStatus>('loading');

  const publish = React.useCallback((next: AuthState) => {
    if (!mounted.current) return;
    // checkAuth keeps the exact cached user object on offline fallback and
    // normalizes a new object on a verified /me response. After credentials or
    // endpoint changes, an old cached identity cannot authorize the new context.
    if (verificationBaseline.current !== undefined && (!next.isAuthenticated || next.user !== verificationBaseline.current)) {
      verificationBaseline.current = undefined; setContextUnverified(false);
    }
    const nextIdentity = identityOf(next);
    if (identity.current !== nextIdentity) { identity.current = nextIdentity; setRevision(value => value + 1); }
    setAuth(next);
  }, []);
  const revalidate = React.useCallback(async (block: boolean) => {
    const sequence = ++refreshSequence.current;
    if (block) setInitializing(true);
    setRefreshing(true);
    try {
      const next = await checkAuth();
      if (mounted.current && sequence === refreshSequence.current) {
        publish(next);
        if (verificationBaseline.current !== undefined) setError('登录凭据或服务地址已变化，请重新登录以核验当前账号');
        else setError('');
      }
    } catch (failure) {
      if (mounted.current && sequence === refreshSequence.current) {
        publish(getAuthState());
        setError(mapAuthErrorMessage(failure, '暂时无法核验登录状态，请重试'));
      }
    } finally {
      if (mounted.current && sequence === refreshSequence.current) { setInitializing(false); setRefreshing(false); }
    }
  }, [publish]);

  React.useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribe(publish);
    void revalidate(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && !SESSION_STORAGE_KEYS.has(event.key)) return;
      // Even A→B→A storage events retire the previous page's requests.
      setRevision(value => value + 1);
      commandSequence.current += 1; setSigningIn(false); setSigningOut(false);
      verificationBaseline.current = getAuthState().user; setContextUnverified(true);
      setError('');
      void revalidate(true);
    };
    const onFocus = () => {
      const changed = identity.current !== identityOf(getAuthState());
      if (changed) {
        setRevision(value => value + 1);
        verificationBaseline.current = getAuthState().user; setContextUnverified(true);
      }
      void revalidate(changed);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    // 使用中续期：页面打开期间定时检查，回到页面时也检查；页面关闭后不续期，空闲会话按原有效期到期。
    const renew = () => { if (document.visibilityState !== 'hidden') void renewSessionIfDue(); };
    const timer = window.setInterval(renew, RENEW_CHECK_MS);
    window.addEventListener('focus', renew);
    return () => {
      mounted.current = false;
      refreshSequence.current += 1;
      commandSequence.current += 1;
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('focus', renew);
    };
  }, [publish, revalidate]);

  const login = React.useCallback(async (identifier: string, password: string, options: MistLoginOptions = {}) => {
    if (!mounted.current) throw new Error('会话页面已关闭，请在当前页面操作');
    if (publicStatus.current === 'loading') throw new Error('正在核验登录状态，请稍后重试');
    const sequence = ++commandSequence.current;
    setError(''); setSigningIn(true); setSigningOut(false);
    try {
      // 保持登录：服务端签发 30 天令牌与持久 Cookie；不勾选：会话 Cookie，令牌只存本次浏览器会话。
      const user = await authLogin(identifier.trim(), password, options.companyId, options.entry ?? 'company', options.remember !== false);
      if (!user || typeof user.id !== 'string' || !user.id.trim()) throw new Error('登录响应未包含有效账号，请重新登录');
      if (!mounted.current || sequence !== commandSequence.current) throw new Error('登录操作已被新的会话操作替代');
      refreshSequence.current += 1; setInitializing(false); setRefreshing(false);
      publish(getAuthState());
      return user;
    } catch (failure) {
      if (mounted.current && sequence === commandSequence.current && (failure as { code?: unknown })?.code !== 'MFA_REQUIRED') setError(mapAuthErrorMessage(failure, '登录失败，请稍后重试'));
      throw failure;
    } finally {
      if (mounted.current && sequence === commandSequence.current) setSigningIn(false);
    }
  }, [publish]);
  const logout = React.useCallback(async () => {
    if (!mounted.current) throw new Error('会话页面已关闭，请在当前页面操作');
    const sequence = ++commandSequence.current;
    setError(''); setSigningOut(true); setSigningIn(false);
    refreshSequence.current += 1; setInitializing(false); setRefreshing(false);
    try { await authLogout(); }
    catch (failure) {
      if (mounted.current && sequence === commandSequence.current) setError(mapAuthErrorMessage(failure, '退出登录失败，请重试'));
      throw failure;
    } finally {
      if (mounted.current && sequence === commandSequence.current) { publish(getAuthState()); setSigningOut(false); }
    }
  }, [publish]);
  const refresh = React.useCallback(() => mounted.current ? revalidate(false) : Promise.resolve(), [revalidate]);
  const clearError = React.useCallback(() => setError(''), []);
  const status: MistSessionStatus = initializing || auth.isLoading ? 'loading' : !contextUnverified && auth.isAuthenticated && auth.user && typeof auth.user.id === 'string' && !!auth.user.id.trim() ? 'authenticated' : 'anonymous';
  publicStatus.current = status;
  const canAccessView = React.useCallback((view: View) => publicStatus.current === 'authenticated' && authCanAccessView(view), []);
  const hasPermission = React.useCallback((...permissions: string[]) => publicStatus.current === 'authenticated' && authHasPermission(...permissions), []);
  const hasRole = React.useCallback((...roles: AgentRole[]) => publicStatus.current === 'authenticated' && authHasRole(...roles), []);
  const value: MistSession = { status, user: status === 'authenticated' ? auth.user : null, sessionKey: `${instanceId}:${revision}`, error, refreshing, signingIn, signingOut, login, logout, refresh, clearError, canAccessView, hasPermission, hasRole };
  return <SessionContext.Provider value={value}>{uiText(children)}</SessionContext.Provider>;
}

type LocalEnvelope = {mode:'local';user:AuthUser;profiles:Array<{id:string;name:string}>};
function localEnvelope(value:unknown):LocalEnvelope {
 const data=value as LocalEnvelope;
 const strings=(input:unknown):input is string[]=>Array.isArray(input)&&input.every(item=>typeof item==='string'&&!!item.trim());
 if(!data||data.mode!=='local'||!data.user||typeof data.user.id!=='string'||!data.user.id.trim()
  ||typeof data.user.displayName!=='string'||!data.user.displayName.trim()||typeof data.user.email!=='string'
  ||!strings(data.user.permissions)||!strings(data.user.roles)||!Array.isArray(data.user.departmentIds)
  ||!data.user.departmentIds.every(id=>typeof id==='string')
  ||data.user.permissionCeiling!==undefined&&!strings(data.user.permissionCeiling)
  ||!Array.isArray(data.profiles)||!data.profiles.length||data.profiles.some(p=>!p||typeof p.id!=='string'||!p.id.trim()||typeof p.name!=='string'||!p.name.trim())
  ||new Set(data.profiles.map(p=>p.id)).size!==data.profiles.length||!data.profiles.some(p=>p.id===data.user.id))throw new Error('本地会话响应不完整，请重新连接公司');
 return data;
}
function localIdentity(data:LocalEnvelope){return JSON.stringify([data.user.id,data.user.displayName,data.user.email,[...data.user.permissions].sort(),data.user.permissionCeiling&&[...data.user.permissionCeiling].sort(),[...data.user.roles].sort(),data.user.departmentIds,[...data.profiles].sort((a,b)=>a.id.localeCompare(b.id))]);}

/** Local mode is enabled only by an explicit same-origin server response; `mode: 'remote'` (or a legacy 404) retains production auth. */
export function MistSessionProvider({children}:{children:React.ReactNode}) {
 const instanceId=React.useId();
 const [mode,setMode]=React.useState<'probing'|'local'|'remote'|'error'>('probing');
 const [data,setData]=React.useState<LocalEnvelope|null>(null),[status,setStatus]=React.useState<MistSessionStatus>('loading');
 const [error,setError]=React.useState(''),[revision,setRevision]=React.useState(0),[switching,setSwitching]=React.useState(false),[refreshing,setRefreshing]=React.useState(true);
 const mounted=React.useRef(false),generation=React.useRef(0),controller=React.useRef<AbortController|null>(null),signature=React.useRef(''),switchLock=React.useRef(false);
 const modeRef=React.useRef(mode);modeRef.current=mode;
 const current=React.useRef(data);current.current=data;
 const load=React.useCallback(async(profileId?:string,discovery=false):Promise<AuthUser|undefined>=>{
  if(!mounted.current)throw new Error('会话页面已关闭，请在当前页面操作');
  if(switchLock.current)throw new Error('正在切换工作身份，请稍后重试');
  if(profileId!==undefined&&!current.current?.profiles.some(p=>p.id===profileId))throw new Error('请选择服务器提供的工作身份');
  const blocking=profileId!==undefined||!current.current||modeRef.current!=='local';
  switchLock.current=profileId!==undefined;setSwitching(profileId!==undefined);
  const sequence=++generation.current;controller.current?.abort();const requestController=new AbortController();controller.current=requestController;
  if(blocking){setStatus('loading');setRevision(v=>v+1);}setRefreshing(true);setError('');
  const timeout=window.setTimeout(()=>requestController.abort(),8000);
  try{
   const response=await fetch('/api/mist/session',{method:profileId===undefined?'GET':'POST',credentials:'include',cache:'no-store',signal:requestController.signal,...(profileId===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify({profileId})})});
   if(!mounted.current||sequence!==generation.current)throw new Error('会话操作已被新的请求替代');
   if(discovery&&response.status===404){setMode('remote');setStatus('anonymous');return;}
   const body=await response.json().catch(()=>null);
   if(discovery&&response.ok&&body?.mode==='remote'){setMode('remote');setStatus('anonymous');return;}
   if(!response.ok)throw new Error(body?.error?.message||body?.message||'公司会话无法核验，请重新连接');
   const next=localEnvelope(body);
   if(profileId!==undefined&&next.user.id!==profileId)throw new Error('返回的工作身份与选择不一致，请重新核对');
   if(!mounted.current||sequence!==generation.current)throw new Error('会话操作已被新的请求替代');
   const nextSignature=localIdentity(next);if(signature.current!==nextSignature){signature.current=nextSignature;setRevision(v=>v+1);}
   current.current=next;setData(next);setMode('local');setStatus('authenticated');setError('');return next.user;
  }catch(failure){
   // A background re-check that cannot reach the server keeps the current identity;
   // only a server answer (or a blocking switch) can end the local session.
   const offline=failure instanceof TypeError||(failure as {name?:unknown})?.name==='AbortError';
   if(mounted.current&&sequence===generation.current&&!blocking&&offline&&current.current)setError(mapAuthErrorMessage(failure,'公司连接超时，请重试'));
   else if(mounted.current&&sequence===generation.current){current.current=null;setData(null);signature.current='';setRevision(v=>v+1);setMode(modeRef.current==='local'?'local':'error');setStatus('anonymous');setError(mapAuthErrorMessage(failure,'公司连接超时，请重试'));}
   throw failure;
  }finally{window.clearTimeout(timeout);if(mounted.current&&sequence===generation.current){switchLock.current=false;setSwitching(false);setRefreshing(false);}}
 },[]);
 React.useEffect(()=>{
  mounted.current=true;void load(undefined,true).catch(()=>undefined);
  const onFocus=()=>{if(modeRef.current==='local'&&!switchLock.current)void load().catch(()=>undefined);};
  window.addEventListener('focus',onFocus);
  return()=>{mounted.current=false;generation.current++;controller.current?.abort();switchLock.current=false;window.removeEventListener('focus',onFocus);};
 },[load]);
 const refresh=React.useCallback(async()=>{if(!mounted.current)return;await load(undefined,modeRef.current==='error').then(()=>undefined).catch(()=>undefined);},[load]);
 const login=React.useCallback(async()=>{const user=await load();if(!user)throw new Error('未收到本地工作身份');return user;},[load]);
 const selectLocalProfile=React.useCallback(async(id:string)=>{await load(id);},[load]);
 const permits=React.useCallback((...permissions:string[])=>{
  const user=status==='authenticated'?data?.user:null;if(!user)return false;
  const allows=(grants:readonly string[],scope:string)=>grants.includes('*')||grants.includes(scope);
  return permissions.some(scope=>allows(user.permissions,scope)&&(user.permissionCeiling===undefined||allows(user.permissionCeiling,scope)));
 },[data,status]);
 const hasRole=React.useCallback((...roles:AgentRole[])=>status==='authenticated'&&!!data?.user.roles.some(role=>roles.includes(role)),[data,status]);
 const canAccessView=React.useCallback((view:View)=>{
  if(status!=='authenticated')return false;const policy=getViewPermissionDefinition(view);if(!policy)return false;
  if(policy.policy==='public-authenticated')return true;if(policy.policy==='dev-only')return import.meta.env.DEV;
  if(policy.policy==='role')return !!policy.roles?.some(role=>data?.user.roles.includes(role as AgentRole));
  return !!policy.required&&permits(policy.required);
 },[data,status,permits]);
 if(mode==='remote')return <ProductionMistSessionProvider>{uiText(children)}</ProductionMistSessionProvider>;
 const value:MistSession={status,user:status==='authenticated'?data!.user:null,sessionKey:`${instanceId}:local:${revision}`,error,refreshing,signingIn:switching,signingOut:false,login,logout:refresh,refresh,clearError:()=>setError(''),canAccessView,hasPermission:permits,hasRole,localMode:mode==='local',connectionModeUnverified:mode==='error',localProfiles:data?.profiles||[],selectLocalProfile};
 return <SessionContext.Provider value={value}>{uiText(children)}</SessionContext.Provider>;
}

/** 可选会话：在没有会话上下文的嵌入 / 测试场景返回 null（仅用于展示与默认值，不用于权限判断）。 */
export function useOptionalMistSession(): MistSession | null { return React.useContext(SessionContext); }
export function useMistSession(): MistSession {
  const session = React.useContext(SessionContext);
  if (!session) throw new Error('useMistSession must be used inside MistSessionProvider');
  return session;
}
