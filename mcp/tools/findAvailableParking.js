import { getParking, normalize, limitOf, available, summarize } from './data.js';
export const definition = {
  name:'findAvailableParking',description:'부산 공영주차장 중 빈자리가 확인된 곳을 찾습니다. 지역은 주차장명/주소와 일치하는 문자열만 사용합니다.',
  inputSchema:{type:'object',properties:{area:{type:'string',description:'예: 서면, 대연동. 생략하면 전체'},limit:{type:'integer',minimum:1,maximum:20}},additionalProperties:false}
};
export async function run(args,context) {
  const area=normalize(args.area);
  if(area.length>80) throw new Error('지역 검색어는 80자 이하로 입력해 주세요.');
  const body=await getParking(context);
  const matches=body.parkingList.filter(p=>available(p) && (!area || normalize(p.parknm).includes(area)||normalize(p.doroAddr).includes(area)||normalize(p.jibunAddr).includes(area)))
   .sort((a,b)=>b.curravacnt-a.curravacnt || String(a.parknm).localeCompare(String(b.parknm),'ko'));
  return {count:matches.length,results:matches.slice(0,limitOf(args.limit)).map(summarize),warnings:body.warnings,sources:body.sources,
  notice:'빈자리는 제공기관 갱신 시점 기준이며 실제 주차 가능 여부는 현장에서 확인해야 합니다.'};
}
