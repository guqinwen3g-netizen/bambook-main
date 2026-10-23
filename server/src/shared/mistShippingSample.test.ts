import {expect,it} from 'vitest';
import {parseShippingSampleSizes,normalizeShippingSampleSizes} from './mistShippingSample';
it('parses only explicit actual sizes and positive integer piece counts',()=>{
 expect(normalizeShippingSampleSizes(parseShippingSampleSizes('S:1\nM：1\nL:1'),3)).toEqual([{size:'S',quantity:1},{size:'M',quantity:1},{size:'L',quantity:1}]);
 for(const value of ['', 'M:1.5','M = 1'])expect(()=>parseShippingSampleSizes(value)).toThrow();
 for(const rows of [[{size:'M',quantity:0}],[{size:'M',quantity:-1}],[{size:'M',quantity:1.5}]])expect(()=>normalizeShippingSampleSizes(rows,1)).toThrow();
});
