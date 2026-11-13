import { getApiBaseUrl, getDefaultBambookEndpoint, normalizeDataCenterEndpoint } from './apiBase';
import { View } from '../types';
import { getViewPermission, isAuthenticatedPublicView, isDevOnlyView } from '../lib/modulePermissions';
import {storeLogoutCapability,queueLogoutCapability,pendingLogoutCapabilities,confirmLogoutCapability,confirmUserLogoutCapabilities,clearActiveLogoutCapability,type LogoutCapability} from './logoutCapabilities';

export type AgentRole = 'owner' | 'admin' | 'manager' | 'merchandiser' | 'finance' | 'sales' | 'viewer' | 'agent_operator';

export interface AuthUser {
  companyId?: string | null;
  platformRole?: string | null;
  businessAttributes?: string[];
  globalBusinessScope?: boolean;
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string | null;
  roles: AgentRole[];
  /** Canonical role identifiers supplied by the current server auth DTO. */
  roleIds?: string[];
  /** Display names from the current own-account role tree; never an authorization source. */
  roleLabels?: Array<{ id: string; name: string }>;
  permissions: string[];
  permissionCeiling?: string[];
  departmentIds: string[];
  department: string | null;
  /** 首次登录（初始密码）或管理员重置密码后为 true：须先修改密码才能继续使用。 */
  mustChangePassword?: boolean;
  /** 强制改密的原因：initial = 首次登录，reset = 管理员重置。 */
  passwordChangeReason?: 'initial' | 'reset';
  /** 账号所属公司（/auth/me 顶层返回），用于公司资料未填法定名称时显示。 */
  company?: { id: string; name: string; slug?: string } | null;
  /** 平台管理员当前选择的公司。 */
  platformCompany?: { companyId: string; companyName: string; startedAt: string };
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logoutUnconfirmed?: boolean;
}

type AuthListener = (state: AuthState) => void;

const initialState: AuthState = { user: null, isLoading: true, isAuthenticated: false };

const listeners = new Set<AuthListener>();
const AUTH_TOKEN_KEY = 'bambook_auth_token';
const AUTH_USER_CACHE_KEY = 'bambook_auth_user';
const AUTH_SIGNED_OUT_KEY='bambook_auth_signed_out';
type LogoutMarker='pending'|'confirmed';
function logoutMarkers():Record<string,LogoutMarker>{try{const value=JSON.parse(localStorage.getItem(AUTH_SIGNED_OUT_KEY)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return{};}}
function markSignedOut(base:string,state?:LogoutMarker):void{try{const values=logoutMarkers();if(state)values[base]=state;else delete values[base];localStorage.setItem(AUTH_SIGNED_OUT_KEY,JSON.stringify(values));}catch{/* Local state is still cleared when storage is unavailable. */}}
// 默认认证端点：DEV 闭环本地 8081 后端；PROD 走生产数据中心（与 apiBase 同口径，构建期静态分流）。
const DEFAULT_AUTH_ENDPOINT = getDefaultBambookEndpoint();
const AUTH_FETCH_TIMEOUT_MS = 8000;

const DEFAULT_ROLE_PERMISSIONS: Record<AgentRole, string[] | '*'> = {
  owner: '*',
  admin: ['users:read', 'users:write', 'users:delete', 'roles:read', 'roles:write', 'orders:read', 'orders:write', 'products:read', 'products:write', 'relations:read', 'relations:write', 'knowledge:read', 'knowledge:write', 'knowledge:admin', 'tools:execute', 'tools:admin', 'finance:read', 'ai:chat', 'ai:agent', 'emails:read', 'emails:write', 'settings:read', 'settings:write', 'audit:read', 'approvals:read', 'approvals:write'],
  manager: ['users:read', 'orders:read', 'orders:write', 'products:read', 'products:write', 'relations:read', 'relations:write', 'knowledge:read', 'knowledge:write', 'tools:execute', 'finance:read', 'finance:write', 'emails:read', 'emails:write', 'settings:read', 'audit:read', 'approvals:read', 'approvals:write'],
  merchandiser: ['orders:read', 'orders:write', 'products:read', 'relations:read', 'knowledge:read', 'tools:execute', 'emails:read'],
  sales: ['orders:read', 'products:read', 'relations:read', 'relations:write', 'knowledge:read', 'tools:execute', 'emails:read', 'emails:write'],
  finance: ['orders:read', 'finance:read', 'finance:write', 'knowledge:read', 'tools:execute', 'emails:read'],
  agent_operator: ['orders:read', 'products:read', 'knowledge:read', 'tools:execute'],
  viewer: ['orders:read', 'products:read', 'relations:read', 'knowledge:read'],
};

function deriveDefaultPermissions(roles: AgentRole[]): string[] {
  if (roles.some(role => DEFAULT_ROLE_PERMISSIONS[role] === '*')) {
    return ['*'];
  }
  return Array.from(new Set(roles.flatMap(role => {
    const scopes = DEFAULT_ROLE_PERMISSIONS[role];
    return Array.isArray(scopes) ? scopes : [];
  }))).sort();
}

function normalizeAuthUser(user: AuthUser | null | undefined): AuthUser | null {
  if (!user) return null;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const rawPermissions = (user as any).permissions;
  return {
    ...user,
    roles,
    permissions: Array.isArray(rawPermissions) ? rawPermissions : deriveDefaultPermissions(roles),
    departmentIds: Array.isArray(user.departmentIds) ? user.departmentIds : [],
    department: user.department ?? null,
  };
}

function readCachedAuthState(): AuthState {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
    const raw = localStorage.getItem(AUTH_USER_CACHE_KEY);
    if (!token || !raw) return { ...initialState };
    const user = normalizeAuthUser(JSON.parse(raw));
    if (!user) return { ...initialState };
    return { user, isLoading: false, isAuthenticated: true };
  } catch {
    return { ...initialState };
  }
}

function cacheAuthUser(user: AuthUser | null): void {
  try {
    if (user) {
      localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(AUTH_USER_CACHE_KEY);
    }
  } catch {
    // Auth cache is only a startup accelerator; ignore storage failures.
  }
}

let currentState: AuthState = readCachedAuthState();
// Mutation epoch protects credentials and /me state across login/logout. A
// separate refresh sequence makes concurrent checks resolve latest-first.
let authMutationEpoch = 0;
let authRefreshSequence = 0;

function notify() {
  listeners.forEach(fn => fn({ ...currentState }));
}

function getStoredAuthToken(): string {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function keepCachedAuthOnRefreshFailure(status?: number): boolean {
  if (!status) return true; // 无状态=网络/离线故障：任何环境都宽容保留缓存
  // 401=服务端明确判定会话失效：任何环境都必须登出（DEV 保留缓存会导致
  // “界面显示已登录、JWT 接口却处处 401”的假登录状态）
  if (status === 401) return false;
  if (import.meta.env.DEV) return true;
  return status >= 500 || status === 408 || status === 429;
}

export function subscribe(fn: AuthListener): () => void {
  listeners.add(fn);
  fn({ ...currentState });
  return () => listeners.delete(fn);
}

export function getAuthState(): AuthState {
  return { ...currentState };
}

export function getAuthApiBase(): string {
  // 本地 Web/浏览器模拟测试：VITE_API_BASE_URL 显式配置相对基座（如 '/api'，
  // 由 vite proxy 转发本地 8081 后端）时，auth 与业务 API 同源直连——
  // 优先级与 apiService.getApiBaseUrl 的 env 分支对齐（此前 env 相对基座被
  // 排除，登录请求绕过代理直打生产 DEFAULT_AUTH_ENDPOINT，本地账号全部登录失败）。
  const envBase = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (envBase.startsWith('/')) return envBase.replace(/\/$/, '');

  try {
    const raw = localStorage.getItem('panda_system_config');
    if (raw) {
      const cfg = JSON.parse(raw);
      const cloud = String(cfg?.cloudEndpoint || '').trim();
      if (cloud) {
        const base = normalizeDataCenterEndpoint(cloud).replace(/\/$/, '');
        return base.endsWith('/api') ? base : `${base}/api`;
      }
    }
  } catch {
    // Ignore malformed local config and continue to legacy keys.
  }

  const legacyCloud = localStorage.getItem('cloudEndpoint') || '';
  if (legacyCloud.trim()) {
    const base = normalizeDataCenterEndpoint(legacyCloud).replace(/\/$/, '');
    return base.endsWith('/api') ? base : `${base}/api`;
  }

  const apiBase = getApiBaseUrl().replace(/\/$/, '');
  if (apiBase && apiBase !== '/api') return apiBase;

  return `${DEFAULT_AUTH_ENDPOINT}/api`;
}

/**
 * 认证请求统一错误映射层：把底层网络/协议异常翻译成用户可读文案，
 * 业务页面不再直渲 err.message 原文（TypeError: Failed to fetch 等）。
 * - TypeError / AbortError（断网、CORS、fetch 超时中断）→ 服务器不可达或超时
 * - 非 JSON 响应（代理错误页/HTML 网关页）→ 服务异常（HTTP N）
 * - 其余（后端业务 message，已是中文）→ 原样透传
 */
const NETWORK_ERROR_MESSAGE = '服务器不可达或超时，请检查网络';
const NON_JSON_RESPONSE_RE = /^HTTP (\d+) returned non-JSON response/;

export function mapAuthErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  if (error && typeof error === 'object') {
    const err = error as { name?: unknown; message?: unknown };
    if (err.name === 'AbortError' || error instanceof TypeError) {
      return NETWORK_ERROR_MESSAGE;
    }
    const message = typeof err.message === 'string' ? err.message : '';
    const nonJson = NON_JSON_RESPONSE_RE.exec(message);
    if (nonJson) return `服务异常（HTTP ${nonJson[1]}）`;
    if (message) return message;
  }
  return fallback;
}

async function readJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, ' ').slice(0, 160);
    throw new Error(`HTTP ${res.status} returned non-JSON response: ${preview || 'empty body'}`);
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredAuthToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

export async function checkAuth(): Promise<AuthState> {
  const epoch = authMutationEpoch;
  const refresh = ++authRefreshSequence;
  const base = getAuthApiBase();
  const storedToken = getStoredAuthToken();
  const signedOut=logoutMarkers()[base];
  if(!storedToken&&(signedOut==='pending'||signedOut==='confirmed')){
    currentState={user:null,isLoading:false,isAuthenticated:false,...(signedOut==='pending'?{logoutUnconfirmed:true}:{})};notify();return currentState;
  }
  const isCurrent = () => epoch === authMutationEpoch && refresh === authRefreshSequence
    && storedToken === getStoredAuthToken() && base === getAuthApiBase();
  const canRenderFromCachedUser = currentState.isAuthenticated && Boolean(currentState.user);
  // Only the unresolved initial session blocks rendering. Rechecking a settled
  // guest session on window focus must not unmount the welcome/login screen.
  if (!canRenderFromCachedUser && currentState.isLoading) {
    currentState = { ...currentState, isLoading: true };
    notify();
  }
  try {
    const res = await fetchAuth('/auth/me', {
      method: 'GET',
      headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {},
      credentials: 'include',
    }, { fallbackToOmitCredentials: true });
    if (!isCurrent()) return currentState;
    if (res.ok) {
      const data = await readJsonResponse(res);
      if (!isCurrent()) return currentState;
      currentState = { user: normalizeAuthUser(data.user && data.company && !data.user.company ? { ...data.user, company: data.company } : data.user), isLoading: false, isAuthenticated: true };
      if(currentState.user)storeLogoutCapability(base,data.logoutTicket,currentState.user.id);
      cacheAuthUser(currentState.user);
    } else if (canRenderFromCachedUser && keepCachedAuthOnRefreshFailure(res.status)) {
      currentState = { ...currentState, isLoading: false, isAuthenticated: true };
    } else {
      currentState = { user: null, isLoading: false, isAuthenticated: false };
      cacheAuthUser(null);
    }
  } catch {
    if (!isCurrent()) return currentState;
    currentState = canRenderFromCachedUser
      ? { ...currentState, isLoading: false, isAuthenticated: true }
      : { user: null, isLoading: false, isAuthenticated: false };
    if (!canRenderFromCachedUser) cacheAuthUser(null);
  }
  notify();
  return currentState;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  requestedDepartment?: string;
  code: string;
}

export async function sendVerificationCode(email: string, purpose: 'register' | 'reset_password' = 'register'): Promise<{ message: string; cooldownMs: number; transport: string }> {
  const res = await fetch(`${getAuthApiBase()}/auth/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({ email, purpose }),
  });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    const err: any = new Error(data.message || data.error || `Send code failed (HTTP ${res.status})`);
    err.code = data.error;
    err.retryAfterMs = data.retryAfterMs;
    throw err;
  }
  return { message: data.message, cooldownMs: data.cooldownMs ?? 60000, transport: data.transport };
}

export async function register(input: RegisterInput): Promise<{ message: string; userId: string }> {
  const res = await fetch(`${getAuthApiBase()}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(input),
  });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    throw new Error(data.message || data.error || `Register failed (HTTP ${res.status})`);
  }
  return { message: data.message, userId: data.user?.id };
}

export type SelfRegistrationAccount = { displayName: string; email: string; password: string; code: string };

async function postRegistration(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${getAuthApiBase()}/auth/register/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(body),
  });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    const err: any = new Error(data.message || data.error || `Register failed (HTTP ${res.status})`);
    err.code = data.error;
    throw err;
  }
  return data;
}

/** 创建公司并同时注册该公司的管理员账号；成功后可直接登录。 */
export type CompanyBusiness = 'fabric' | 'garment' | 'both';
export type CompanySize = '1-20' | '21-100' | '100+';
export type CompanySearchResult = { id: string; name: string; business: CompanyBusiness | null };

/** 注册时受限前缀核对在用公司：全称优先，否则达到门槛且唯一才返回单个结果。 */
export async function searchRegistrationCompanies(q: string, signal?: AbortSignal): Promise<CompanySearchResult[]> {
  const res = await fetch(`${getAuthApiBase()}/auth/register/companies?q=${encodeURIComponent(q)}`, { credentials: 'omit', signal });
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(data.message || data.error || `Search failed (HTTP ${res.status})`);
  return Array.isArray(data.companies) ? data.companies : [];
}

export async function registerCompany(input: SelfRegistrationAccount & { companyName: string; business?: CompanyBusiness; size?: CompanySize }): Promise<{ company: { name: string; code: string }; email: string }> {
  const data = await postRegistration('company', input);
  return { company: data.company, email: data.email };
}

/** 选择搜索到的公司或填写公司代码申请加入；公司管理员审批后才能登录。 */
export async function registerJoinCompany(input: SelfRegistrationAccount & ({ companyId: string } | { companyCode: string })): Promise<{ company: { name: string }; email: string }> {
  const data = await postRegistration('join', input);
  return { company: data.company, email: data.email };
}

/**
 * 保存服务端签发的令牌：保持登录写 localStorage（跨浏览器重启），否则只写 sessionStorage（关闭浏览器即清除）。
 * 与服务端 Cookie 的持久 / 会话属性一一对应。
 */
function storeAuthToken(token: string, remember: boolean): void {
  markSignedOut(getAuthApiBase());
  try { if (remember) localStorage.setItem(AUTH_TOKEN_KEY, token); else localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* storage restrictions */ }
  try { sessionStorage.setItem(AUTH_TOKEN_KEY, token); } catch { /* storage restrictions */ }
}

export async function login(identifier: string, password: string, companyId?: string, entry: 'company' | 'platform' = 'company', remember = true): Promise<AuthUser> {
  const epoch = ++authMutationEpoch;
  const base = getAuthApiBase();
  const initialToken = getStoredAuthToken();
  const isCurrent = () => epoch === authMutationEpoch && base === getAuthApiBase() && initialToken === getStoredAuthToken();
  const superseded = () => new Error('登录操作已被新的身份操作替代，请使用当前登录状态');
  let res: Response;
  let data: any;
  try {
    res = await fetchAuth('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: identifier, identifier, password, entry, remember, ...(companyId ? { companyId } : {}) }),
    }, { fallbackToOmitCredentials: true });
    data = await readJsonResponse(res);
  } catch (error) {
    if (!isCurrent()) throw superseded();
    throw new Error(mapAuthErrorMessage(error, '登录失败，请稍后重试'));
  }
  if (!isCurrent()) throw superseded();
  if (!res.ok) {
    const err: any = new Error(data.message || data.error || `服务异常（HTTP ${res.status}）`);
    err.code = data.error;
    // 429 防爆破限流：透传后端算好的冷却时长，供登录页做倒计时
    if (typeof data.retryAfterMs === 'number') err.retryAfterMs = data.retryAfterMs;
    throw err;
  }
  if (data.needsCompany && Array.isArray(data.companies)) {
    // 同一账号属于多家公司：不写任何会话，交由登录页选择后再登录一次。
    const err: any = new Error('请选择要进入的公司');
    err.code = 'COMPANY_SELECTION_REQUIRED';
    err.companies = data.companies;
    throw err;
  }
  if (data.mfaRequired) throw new Error('登录服务版本未更新，请刷新页面后重试或联系管理员');
  if (data.token) storeAuthToken(data.token, remember);
  const user = normalizeAuthUser(data.user);
  if(user)storeLogoutCapability(base,data.logoutTicket,user.id);
  currentState = { user, isLoading: false, isAuthenticated: true };
  cacheAuthUser(user);
  notify();
  return user as AuthUser;
}

/**
 * 开发调试面板专用：用后端签发好的 token 直接以某账号身份进入。
 * 与 login() 成功路径行为一致（写 token + 更新 auth 状态），
 * 但跳过口令校验 —— 仅 dev 面板可调用（后端 BAMBOOK_DEV_PANEL 护栏）。
 */
export async function devLoginAs(token: string, user: AuthUser): Promise<AuthUser> {
  return adoptIssuedSession(token, user);
}

/** 换用服务端刚签发的会话（开发面板切换账号、平台切换管理公司）。 */
export async function adoptIssuedSession(token: string, user: AuthUser,logoutTicket?:string): Promise<AuthUser> {
  authMutationEpoch += 1;
  markSignedOut(getAuthApiBase());
  clearActiveLogoutCapability(getAuthApiBase());
  storeLogoutCapability(getAuthApiBase(),logoutTicket,user.id);
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  }
  const normalized = normalizeAuthUser(user);
  if (!normalized) {
    throw new Error('缺少有效用户，无法进入');
  }
  currentState = { user: normalized, isLoading: false, isAuthenticated: true };
  cacheAuthUser(normalized);
  notify();
  return normalized;
}

async function fetchAuth(
  path: string,
  init: RequestInit,
  options: { fallbackToOmitCredentials?: boolean } = {},
): Promise<Response> {
  const url = `${getAuthApiBase()}${path}`;
  const fetchWithTimeout = (nextInit: RequestInit) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
    return fetch(url, { ...nextInit, signal: nextInit.signal ?? controller.signal })
      .finally(() => window.clearTimeout(timer));
  };
  try {
    return await fetchWithTimeout(init);
  } catch (error) {
    if (!options.fallbackToOmitCredentials || init.credentials === 'omit') {
      throw error;
    }
    return fetchWithTimeout({ ...init, credentials: 'omit' });
  }
}

type LogoutRequest={base:string;headers:Record<string,string>;capability?:LogoutCapability};
const unconfirmedLogouts=new Map<string,LogoutRequest>();
function forgetLocalSession(pending=false):void{
  authMutationEpoch += 1;
  markSignedOut(getAuthApiBase(),pending?'pending':'confirmed');
  try{localStorage.removeItem(AUTH_TOKEN_KEY);}catch{/* Browser storage may be restricted. */}
  try{sessionStorage.removeItem(AUTH_TOKEN_KEY);}catch{/* The in-memory identity must still be cleared. */}
  cacheAuthUser(null);
  currentState = { user: null, isLoading: false, isAuthenticated: false };
  notify();
}
export async function logout(): Promise<void> {
  const logoutBase = getAuthApiBase();
  const token=getStoredAuthToken(),knownUser=!!currentState.user,previousPending=logoutMarkers()[logoutBase]==='pending';
  const active=queueLogoutCapability(logoutBase,currentState.user?.id),capabilities=pendingLogoutCapabilities(logoutBase);
  if(!active&&(token||knownUser))unconfirmedLogouts.set(logoutBase,{base:logoutBase,headers:authHeaders()});
  const legacy=unconfirmedLogouts.get(logoutBase);
  const requests:LogoutRequest[]=[...capabilities.map(capability=>({base:logoutBase,headers:{'Content-Type':'application/json'},capability})),...(legacy?[legacy]:[])];
  if(!requests.length)requests.push({base:logoutBase,headers:authHeaders()});
  const hadTarget=knownUser||!!token||previousPending||currentState.logoutUnconfirmed===true||capabilities.length>0||!!legacy;
  forgetLocalSession(true);
  const epoch=authMutationEpoch;
  // Invalidate immediately; a slow logout acknowledgement must never clear a
  // token or user that a newer login has already installed.
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15_000);
  try{
    let failed=false;
    for(const request of requests)try{
      const send=(credentials:RequestCredentials)=>fetch(`${request.base}/auth/logout`, { method: 'POST', credentials,headers:request.headers,signal:controller.signal,...(request.capability?{body:JSON.stringify({logoutTicket:request.capability.ticket})}:{}) });
      const response=await send('include').catch(failure=>{if(failure instanceof TypeError&&!controller.signal.aborted&&(request.capability||request.headers.Authorization))return send('omit');throw failure;});
      if(!response.ok)throw Error('unconfirmed');
      if(hadTarget){const receipt=await readJsonResponse(response);if(receipt.revokedSession!==true)throw Error('unconfirmed');}
      if(request.capability)confirmLogoutCapability(logoutBase,request.capability);
      else if(unconfirmedLogouts.get(logoutBase)===request)unconfirmedLogouts.delete(logoutBase);
    }catch{failed=true;}
    if(failed||pendingLogoutCapabilities(logoutBase).length||unconfirmedLogouts.has(logoutBase))throw Error('unconfirmed');
    if(epoch===authMutationEpoch&&logoutBase===getAuthApiBase()&&!getStoredAuthToken()){markSignedOut(logoutBase,'confirmed');currentState={user:null,isLoading:false,isAuthenticated:false};notify();}
  }catch{
    if(epoch===authMutationEpoch&&logoutBase===getAuthApiBase()&&!getStoredAuthToken()){currentState={user:null,isLoading:false,isAuthenticated:false,logoutUnconfirmed:true};notify();}
    throw new Error('服务器退出未确认，请重试。');
  }
  finally{clearTimeout(timeout);}
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetchAuth('/auth/change-password', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ currentPassword, newPassword }),
  }, { fallbackToOmitCredentials: true });
  const data = await readJsonResponse(res);
  if (!res.ok) {
    throw new Error(data.message || data.error || `Password change failed (HTTP ${res.status})`);
  }
  // 服务器改密后让其他设备的旧会话失效，并为当前设备换发新令牌：沿用原来的存放位置（“保持登录”与否不变）。
  if (typeof data.token === 'string' && data.token) {
    authMutationEpoch += 1;
    storeAuthToken(data.token, tokenIsRemembered());
    if(currentState.user)storeLogoutCapability(getAuthApiBase(),data.logoutTicket,currentState.user.id);
  }
}

function tokenIsRemembered(): boolean {
  try { return !!localStorage.getItem(AUTH_TOKEN_KEY); } catch { return false; }
}
function tokenClaims(token: string): { iat?: number; exp?: number } | null {
  try {
    const part = token.split('.')[1]; if (!part) return null;
    const value = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}
let renewal: Promise<boolean> | null = null;
/**
 * 使用中滑动续期：令牌已用过约一天（或会话令牌用过一半）时向服务端换发，最多每次请求一个。
 * 服务端重新核验账号状态与凭据代次，续期不能复活已停用 / 改密 / 重置后的旧令牌；被拒时按会话失效处理。
 * 换发只替换同一会话的令牌，不改变当前账号与权限，因此页面状态保持不变。
 */
export function renewSessionIfDue(): Promise<boolean> {
  if (renewal) return renewal;
  const token = getStoredAuthToken(), claims = token ? tokenClaims(token) : null;
  if (!currentState.isAuthenticated || !claims || typeof claims.iat !== 'number' || typeof claims.exp !== 'number') return Promise.resolve(false);
  const now = Date.now() / 1000, lifetime = claims.exp - claims.iat;
  if (now - claims.iat < Math.min(24 * 3600, lifetime / 2)) return Promise.resolve(false);
  const epoch = authMutationEpoch, base = getAuthApiBase(), remember = tokenIsRemembered();
  renewal = (async () => {
    try {
      const res = await fetchAuth('/auth/refresh', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, credentials: 'include' }, { fallbackToOmitCredentials: true });
      if (epoch !== authMutationEpoch || base !== getAuthApiBase() || token !== getStoredAuthToken()) return false;
      const data = await readJsonResponse(res).catch(() => ({}));
      if (res.ok && typeof data.token === 'string' && data.token) { storeAuthToken(data.token, remember);if(currentState.user)storeLogoutCapability(base,data.logoutTicket,currentState.user.id); return true; }
      if (res.status === 401) await checkAuth();
      return false;
    } catch { return false; }
    finally { renewal = null; }
  })();
  return renewal;
}

/** 退出所有设备：服务器使此前签发的全部令牌失效（含当前会话），随后需重新登录。 */
export async function logoutAllSessions(): Promise<void> {
  const epoch=++authMutationEpoch,token=getStoredAuthToken(),base=getAuthApiBase(),userId=currentState.user?.id;
  const res = await fetchAuth('/auth/logout-all', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: '{}',
  }, { fallbackToOmitCredentials: true });
  const data = await readJsonResponse(res);
  if (!res.ok) throw new Error(data.message || data.error || `Logout-all failed (HTTP ${res.status})`);
  // The server already revoked every old credential and cleared its cookie.
  // A later login owns its own state; never clear it from this older acknowledgement.
  if(epoch===authMutationEpoch&&token===getStoredAuthToken()&&base===getAuthApiBase()){
    if(userId)confirmUserLogoutCapabilities(base,userId);
    unconfirmedLogouts.delete(base);forgetLocalSession(pendingLogoutCapabilities(base).length>0);
    if(pendingLogoutCapabilities(base).length){currentState={user:null,isLoading:false,isAuthenticated:false,logoutUnconfirmed:true};notify();}
  }
}

export async function updateMyProfile(input: { avatarUrl?: string | null; displayName?: string }): Promise<AuthUser> {
  const epoch = authMutationEpoch; const token = getStoredAuthToken(); const base = getAuthApiBase();
  const refresh = authRefreshSequence;
  const res = await fetchAuth('/auth/me', {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(input),
  }, { fallbackToOmitCredentials: true });
  const data = await readJsonResponse(res);
  if (epoch !== authMutationEpoch || refresh !== authRefreshSequence || token !== getStoredAuthToken() || base !== getAuthApiBase()) {
    throw new Error('个人资料更新属于先前的登录状态，请重新读取当前资料');
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || `Profile update failed (HTTP ${res.status})`);
  }
  const user = normalizeAuthUser(data.user);
  currentState = { user, isLoading: false, isAuthenticated: true };
  cacheAuthUser(user);
  notify();
  return user as AuthUser;
}

export function hasRole(...roles: AgentRole[]): boolean {
  if (!currentState.user) return false;
  return currentState.user.roles.some(r => roles.includes(r));
}

export function hasPermission(...permissions: string[]): boolean {
  const user = currentState.isAuthenticated ? currentState.user : null;
  if (!user || !Array.isArray(user.permissions)) return false;
  const allows = (grants: readonly string[], scope: string) => grants.includes('*') || grants.includes(scope);
  return permissions.some(scope => allows(user.permissions, scope)
    && (user.permissionCeiling === undefined || (Array.isArray(user.permissionCeiling) && allows(user.permissionCeiling, scope))));
}

export function canAccessView(view: View): boolean {
  if (!currentState.isAuthenticated || !currentState.user) return false;
  if (isAuthenticatedPublicView(view)) return true;
  if (isDevOnlyView(view)) return import.meta.env.DEV;
  const requiredPermission = getViewPermission(view);
  if (!requiredPermission) return false;
  return hasPermission(requiredPermission);
}

/** Business eligibility is server-projected; account permissions still decide actions. */
export function canUseBusinessFamily(family: 'fabric' | 'garment', purpose: 'business' | 'qc' = 'business'): boolean {
  const user = getAuthState().user;
  return !!user && (user.globalBusinessScope === true || !!user.businessAttributes?.includes(`${family}_${purpose}`));
}
