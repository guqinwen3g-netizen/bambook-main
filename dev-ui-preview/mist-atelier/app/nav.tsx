import React from 'react';
import type { ThemeMode } from '../../../components/mist';
import type { WorkbenchTarget } from '../../../services/dashboardTaskService';

/** Mist owns navigation; exact business identities stay attached to the route. */
export type RouteTarget = { versionId?: string; batchId?: string; section?: string; customerId?: string; orderLineId?: string; productionId?: string; detail?: 'full'; workbenchTarget?: WorkbenchTarget };
type SourcePosition =
  | {view:'calendar';scope:string;date:string;mode:'week'|'month';mineOnly:boolean}
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
