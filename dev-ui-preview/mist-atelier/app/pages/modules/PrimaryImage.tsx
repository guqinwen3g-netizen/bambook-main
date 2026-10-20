import { Pill } from '../../../../../components/mist';
import { primaryImageId } from '../../../../../server/src/shared/mistPrimaryImage';

type ImageFile={id:string;mimeType:string};
/** 主图规则的统一说明，用于所有会产生展示图的上传入口。 */
export const PRIMARY_IMAGE_HINT='第一张图片是主图：用于列表、详情与首页展示，并会自动抠图。之后上传的背面、细节等补充图数量不限，不做抠图。';
export function imageRole(files:readonly ImageFile[]|undefined,ids:readonly string[],id:string):'primary'|'supplement'|undefined{
 const file=files?.find(item=>item.id===id);if(!file?.mimeType.startsWith('image/'))return undefined;
 return primaryImageId(files??[],ids)===id?'primary':'supplement';
}
/** 附件行上的图片角色标签：主图（自动抠图）/ 补充图；非图片附件不显示。 */
export function ImageRoleTag({files,ids,id}:{files:readonly ImageFile[]|undefined;ids:readonly string[];id:string}){
 const role=imageRole(files,ids,id);
 return role==='primary'?<Pill tone="accent">主图 · 自动抠图</Pill>:role==='supplement'?<Pill plain>补充图</Pill>:null;
}
/** 上传区标题：还没有图片时提示先传主图，之后提示补充图。 */
export function imageUploadTitle(files:readonly ImageFile[]|undefined,ids:readonly string[]){return primaryImageId(files??[],ids)?'继续上传补充图或其他资料':'先上传主图（正面展示图）';}
