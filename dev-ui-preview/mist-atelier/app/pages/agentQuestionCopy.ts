export function agentQuestionCopy(text:string){
  if(text.includes('\n'))return text;
  const intro=/[：:][ \t]*(?=1[.)、]\s)/.exec(text);
  if(!intro)return text;
  const start=intro.index+intro[0].length;
  const choices=text.slice(start);
  const markers=[...choices.matchAll(/(?:^|\s+)(\d{1,2})([.)、])(?=\s+\S)/g)];
  if(markers.length<2||markers.some((marker,index)=>Number(marker[1])!==index+1||marker[2]!==markers[0][2]))return text;
  const lines=markers.map((marker,index)=>choices.slice(marker.index,markers[index+1]?.index).trim());
  return [text.slice(0,start).trimEnd(),...lines].join('\n');
}
