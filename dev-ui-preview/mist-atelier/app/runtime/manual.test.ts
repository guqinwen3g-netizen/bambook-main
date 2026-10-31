import {expect,it} from 'vitest';
import {manualUrl} from './manual';

it('opens the same-origin manual without carrying record identifiers or credentials into its URL',()=>{
 expect(manualUrl('https://bambook.sylway.cloud/?view=orders&id=private-record','/','https://other.example/api')).toBe('https://bambook.sylway.cloud/manual/');
 expect(manualUrl('https://bambook-admin.sylway.cloud/?view=platform-admin','/')).toBe('https://bambook-admin.sylway.cloud/manual/');
});
it('retains an application mount while keeping a CDN asset base on the business origin',()=>{
 expect(manualUrl('https://example.com/bambook/app/?view=account','/bambook/app/')).toBe('https://example.com/bambook/app/manual/');
 expect(manualUrl('https://example.com/?view=account','https://cdn.example/assets/')).toBe('https://example.com/manual/');
});
it('lets packaged Electron use the active HTTP service and refuses unsafe credential-bearing endpoints',()=>{
 expect(manualUrl('file:///Application/renderer/index.html','/','https://bambook.sylway.cloud/api')).toBe('https://bambook.sylway.cloud/manual/');
 for(const unsafe of ['javascript:void(0)','file:///private/data','https://secret:password@example.com/api','/api'])expect(manualUrl('file:///Application/renderer/index.html','/',unsafe)).toBe('https://bambook.sylway.cloud/manual/');
});
