import React from 'react';
import type { ThemeMode } from '../../../components/mist';
import type { WorkbenchTarget } from '../../../services/dashboardTaskService';

/** Mist owns navigation; exact business identities stay attached to the route. */
export type RouteTarget = { versionId?: string; batchId?: string; section?: string; customerId?: string; orderLineId?: string; productionId?: string; automationId?: string; detail?: 'full'; workbenchTarget?: WorkbenchTarget };
type SourcePosition =
  | {view:'calendar';scope:string;date:string;mode:'week'|'month';mineOnly:boolean}
  | {view:'crm';scope:string;customerId:string;tab:string}
  | {view:'assistant';scope:string;taskId:string;version:number;updatedAt:string;citation:number;offset:number;conversationId?:string}
  | {view:'reports';scope:string;from:string;to:string;currency:string;basis:'order'|'shipment'|'invoice';progress:string;fxView:'none'|'actual'|'period'|'quote'|null;fxMonth:string};
export type Route = RouteTarget & { view: string; id?: string; sourcePosition?: SourcePosition };
/** Attach the filters to this browser history entry only. A fresh navigation creates a fresh mistRoute. */
export function rememberMistSource(route:Route, sourcePosition:SourcePosition) {
  if (route.view===sourcePosition.view) history.replaceState({...history.state,mistRoute:{...route,sourcePosition}},'');
}
/** keepScroll: selecting a row inside the same list (preview) must not jump the page back to the top. */
export type GoOptions = { keepScroll?: boolean };
export type NavCtx = {
  route: Route; go: (view: string, id?: string, target?: RouteTarget, options?: GoOptions) => void;
  theme: ThemeMode; toggleTheme: () => void;
  openPalette: () => void; openAI: (prompt?: string) => void;
};
export const Nav = React.createContext<NavCtx>(null as unknown as NavCtx);
export const useNav = () => React.useContext(Nav);

const ROUTE_KEYS = ['view','id','versionId','batchId','section','customerId','orderLineId','productionId','automationId','detail'] as const;
export function readMistRoute(): Route {
  const qs = new URLSearchParams(location.search);
  const view = qs.get('view') || 'cockpit', id = qs.get('id') || undefined;
  const saved = history.state?.mistRoute;
  const scopeMatches = saved?.view === view && saved?.id === id && ROUTE_KEYS.slice(2).every(key => saved[key] === (qs.get(key) || undefined));
  return {
    ...(scopeMatches ? saved : {}),
    view, id, ...Object.fromEntries(ROUTE_KEYS.slice(2).map(key => [key, qs.get(key) || undefined])),
  };
}
export function writeMistRoute(route: Route, options: GoOptions = {}) {
  const url = new URL(location.href);
  for (const key of ROUTE_KEYS) {
    if (route[key]) url.searchParams.set(key, route[key]!); else url.searchParams.delete(key);
  }
  history.pushState({ ...history.state, mistRoute: route, mistListState: isListState(route, options), mistDepth: (Number(history.state?.mistDepth) || 0) + 1 }, '', url);
}
/** A list position: the list itself or a row picked for its in-page preview (not a full page). */
export function isListState(route: Route, options: GoOptions = {}) { return !route.detail && (!route.id || !!options.keepScroll); }
/** Scroll resets on page changes, but not while switching the previewed row inside the same list (or going back/forward between such rows). */
export function nextScrollKey(previous: { key: string; route: Route; list: boolean }, route: Route, list: boolean) {
  const keep = list && previous.list && previous.route.view === route.view && (previous.route.section ?? '') === (route.section ?? '');
  return keep ? previous.key : scrollKeyOf(route, list);
}
export function scrollKeyOf(route: Route, list: boolean) { return route.view + (route.id ?? '') + (list ? '#list' : '');
}
