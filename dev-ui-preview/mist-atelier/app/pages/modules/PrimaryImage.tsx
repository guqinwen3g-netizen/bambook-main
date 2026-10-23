import { uiText, ui } from '../../../../../services/interfaceLanguage';
import { Pill } from '../../../../../components/mist';
import { primaryImageId } from '../../../../../server/src/shared/mistPrimaryImage';

type ImageFile={id:string;mimeType:string};
/** First image is primary and may be processed for display; later images keep their originals. */
export function imageRole(files:readonly ImageFile[]|undefined,ids:readonly string[],id:string):'primary'|'supplement'|undefined{
 const file=files?.find(item=>item.id===id);if(!file?.mimeType.startsWith('image/'))return undefined;
 return primaryImageId(files??[],ids)===id?'primary':'supplement';
}
/** 附件行上的图片角色标签：主图（自动抠图）/ 补充图；非图片附件不显示。 */
export function ImageRoleTag({files,ids,id}:{files:readonly ImageFile[]|undefined;ids:readonly string[];id:string}){
 const role=imageRole(files,ids,id);
 return role==='primary'?<Pill tone="accent">{uiText("主图")}</Pill>:role==='supplement'?<Pill plain>{uiText("补充图")}</Pill>:null;
}
/** 上传区标题：还没有图片时提示先传主图，之后提示补充图。 */
export function imageUploadTitle(_files:readonly ImageFile[]|undefined,_ids:readonly string[]){return '上传附件';}
