import { describe, expect, it } from 'vitest';
import { View } from '../../../types';
import { canOpenMistView, personalSettingsSection } from './routeAccess';

const access = (...views: View[]) => ({ canAccessView: (view: View) => views.includes(view), platformOperator: false });
describe('Mist page read permissions', () => {
  it.each(['settings', 'system-settings', 'workspace-settings', 'company-settings'])('requires company settings permission for %s', view => {
    expect(canOpenMistView(view, access(View.QcWorkbench), false)).toBe(false);
    expect(canOpenMistView(view, access(View.SystemSettings), false)).toBe(true);
  });
  it.each(Object.values(View).filter(view => ![View.Settings, View.AccountSettings].includes(view)))('does not open registered business page %s without read access', view => {
    expect(canOpenMistView(view, access(), false)).toBe(false);
    expect(canOpenMistView(view, access(view), false)).toBe(true);
  });
  it('allows QC reading without granting writes or access to other modules', () => {
    expect(canOpenMistView('qc-workbench', access(View.QcWorkbench), false)).toBe(true);
    expect(canOpenMistView('orders/detail', access(View.QcWorkbench), false)).toBe(false);
    expect(canOpenMistView('unknown-module', access(), true)).toBe(false);
  });
  it('keeps personal pages and legacy personal links separate from company settings', () => {
    expect(canOpenMistView('account', access(), false)).toBe(true);
    expect(personalSettingsSection({ view: 'company-settings', section: 'appearance' })).toBe('appearance');
    expect(personalSettingsSection({ view: 'settings', section: 'account' })).toBe('profile');
    expect(personalSettingsSection({ view: 'settings', section: 'company' })).toBeUndefined();
  });
  it('keeps developer pages and platform administration behind their own boundary', () => {
    expect(canOpenMistView('design-system', access(), false)).toBe(false);
    expect(canOpenMistView('design-system', access(), true)).toBe(true);
    expect(canOpenMistView('platform-admin', access(), true)).toBe(false);
  });
});

it.each([['development/new',View.Development,'products:write'],['orders/new',View.Orders,'orders:write']] as const)('requires write access for %s', (route,view,scope)=>{expect(canOpenMistView(route,{...access(view),hasPermission:()=>false},false)).toBe(false);expect(canOpenMistView(route,{...access(view),hasPermission:(permission:string)=>permission===scope},false)).toBe(true);});
it('rejects read-only sourcing creation URLs',()=>{expect(canOpenMistView({view:'development',id:'new',section:'sourcing'},{...access(View.Development),hasPermission:()=>false},false)).toBe(false);});
