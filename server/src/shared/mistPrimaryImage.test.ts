import {describe,expect,it} from 'vitest';
import {primaryImageId,primaryImageIds,withPrimaryImage} from './mistPrimaryImage';

const files=[{id:'spec',mimeType:'application/pdf'},{id:'front',mimeType:'image/png'},{id:'back',mimeType:'image/jpeg'},{id:'dev',mimeType:'image/webp'}];
describe('primary image rule',()=>{
 it('uses the first image in attachment order and skips documents',()=>{expect(primaryImageId(files,['spec','front','back'])).toBe('front');expect(primaryImageId(files,['spec'])).toBeUndefined();expect(primaryImageId(files,undefined)).toBeUndefined();});
 it('collects only primary images of products, developments and versions',()=>{
  const ids=primaryImageIds({files,market:{products:[{fileIds:['spec','front','back']}]},devs:[{fileIds:['dev','back']}],versions:[{fileIds:[]}]});
  expect([...ids].sort()).toEqual(['dev','front']);
 });
 it('moves a chosen image to the front without reordering the rest',()=>{expect(withPrimaryImage(['spec','front','back'],'back')).toEqual(['back','spec','front']);expect(withPrimaryImage(['a'],'x')).toEqual(['a']);});
});
