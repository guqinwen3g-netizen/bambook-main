import React from 'react';
import type { ThemeMode } from '../../../components/mist';
import type { WorkbenchTarget } from '../../../services/dashboardTaskService';

/** Mist owns navigation; exact business identities stay attached to the route. */
export type RouteTarget = { versionId?: string; batchId?: string; section?: string; customerId?: string; orderLineId?: string; productionId?: string; detail?: 'full'; workbenchTarget?: WorkbenchTarget };
export type Route = RouteTarget & { view: string; id?: string };
/** keepScroll: selecting a row inside the same list (preview) must not jump the page back to the top. */
export type GoOptions = { keepScroll?: boolean };
export type NavCtx = {
  route: Route; go: (view: string, id?: string, target?: RouteTarget, options?: GoOptions) => void;
  theme: ThemeMode; toggleTheme: () => void;
  openPalette: () => void; openAI: (prompt?: string) => void;
};
export const Nav = React.createContext<NavCtx>(null as unknown as NavCtx);
export const useNav = () => React.useContext(Nav);
