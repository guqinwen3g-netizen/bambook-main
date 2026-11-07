import {expect,it} from 'vitest';
import fs from 'node:fs';import path from 'node:path';
import {AGENT_OBJECT_TYPES} from './agentRead';

// The desktop assistant keeps its own copy of the readable object types (it cannot import server code); this pins the two lists together.
it('keeps the desktop assistant readable-type list identical to the server registry',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../electron/assistant/bambookTools.ts'),'utf8');
 const block=source.slice(source.indexOf('BAMBOOK_OBJECT_TYPES = ['),source.indexOf('] as const;'));
 const desktop=[...block.matchAll(/'([a-z_]+)'/g)].map(m=>m[1]);
 expect([...desktop].sort()).toEqual(AGENT_OBJECT_TYPES.map(t=>t.type).sort());
});
