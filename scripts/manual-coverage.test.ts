import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildCoverage,renderCoverage,deriveState} from './manual-coverage.mjs';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const lesson=(playback:string,employee:string)=>({verification:{playback:{status:playback},employee:{status:employee}}});
it('derives teaching state only from evidence',()=>{
 expect(deriveState({impl:'missing'},[])).toBe('待实现');
 expect(deriveState({impl:'unchecked'},[])).toBe('未核对');
 expect(deriveState({impl:'source'},[])).toBe('待录制');
 expect(deriveState({impl:'walked'},[lesson('unknown','unknown')])).toBe('播放待验');
 expect(deriveState({impl:'walked'},[lesson('passed','pending')])).toBe('员工待验');
 expect(deriveState({impl:'walked'},[lesson('passed','accepted'),lesson('stale','accepted')])).toBe('变更后待复核');
 expect(deriveState({impl:'walked'},[lesson('passed','accepted')])).toBe('已验证');
});
it('matrix references only current pages, commands, lessons and chapters, and registers every lesson',()=>{
 const coverage=buildCoverage({rootDir:ROOT});
 expect(coverage.issues).toEqual([]);
});
it('flags a retired page, unknown command and a lesson hung on undelivered capability',()=>{
 const coverage=buildCoverage({rootDir:ROOT,matrix:{modes:{all:'通用'},tasks:[{id:'x',stage:'s',task:'t',roles:[],modes:['all'],views:['old-manager'],commands:['legacy.run'],impl:'missing',lessons:['tutorial-settlement']}]}});
 const messages=coverage.issues.map(i=>i.message).join('\n');
 expect(messages).toContain('old-manager');expect(messages).toContain('legacy.run');expect(messages).toContain('未交付能力不能挂课程');expect(messages).toContain('课程未登记');
});
it('generated coverage document is up to date',()=>{
 const matrix=JSON.parse(readFileSync(`${ROOT}/wiki/matrix/coverage.json`,'utf8'));
 expect(readFileSync(`${ROOT}/docs/manual-coverage.md`,'utf8')).toBe(renderCoverage(buildCoverage({rootDir:ROOT}),matrix.modes)+'\n');
});
