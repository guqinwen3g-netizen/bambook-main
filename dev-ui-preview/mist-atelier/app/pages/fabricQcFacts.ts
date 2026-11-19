import type {MistQc} from '../../../../server/src/shared/mistWorkspace';
export type FabricFactDraft={key:string;property:string;actual:string;unit:string};
export function fabricQcFacts(rows:FabricFactDraft[]):NonNullable<MistQc['fabricMeasurements']>{return rows.map((row,index)=>{if(!row.property.trim()||!row.unit.trim()||!row.actual.trim()||!Number.isFinite(Number(row.actual))||Number(row.actual)<0)throw Error(`请完整填写面料实测 ${index+1} 的项目、有限非负数和单位`);return{property:row.property.trim(),actual:Number(row.actual),unit:row.unit.trim()};});}
