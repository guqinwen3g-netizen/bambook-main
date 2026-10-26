import { describe, expect, it } from 'vitest';
import { departmentOptions } from './organization';

describe('assignable department hierarchy', () => {
  it('keeps nested business departments available with their parent path', () => {
    expect(departmentOptions([
      { id: 'root', name: '雾织', parentId: null },
      { id: 'business', name: '业务中心', parentId: 'root' },
      { id: 'fabric', name: '面料事业部', parentId: 'business' },
      { id: 'garment', name: '成衣事业部', parentId: 'business' },
    ])).toEqual([
      { value: 'business', label: '业务中心' },
      { value: 'garment', label: '业务中心 / 成衣事业部' },
      { value: 'fabric', label: '业务中心 / 面料事业部' },
    ]);
  });
  it('distinguishes departments under separate company roots and excludes inactive branches', () => {
    expect(departmentOptions([
      { id: 'a', name: '雾织', parentId: null },
      { id: 'b', name: '兰川', parentId: null },
      { id: 'a-finance', name: '财务部', parentId: 'a' },
      { id: 'b-finance', name: '财务部', parentId: 'b' },
      { id: 'old', name: '旧部门', parentId: 'a', status: 'inactive' },
      { id: 'old-child', name: '旧分部', parentId: 'old' },
    ])).toEqual([{ value: 'a-finance', label: '雾织 / 财务部' }, { value: 'b-finance', label: '兰川 / 财务部' }]);
  });
});
