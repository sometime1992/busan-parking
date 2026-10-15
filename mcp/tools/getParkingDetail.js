import { getParking,normalize,summarize } from './data.js';
export const definition = {
  name:'getParkingDetail',description:'부산 공영주차장 코드나 이름으로 요금·운영시간·주소와 실시간 현황을 조회합니다.',
  inputSchema:{type:'object',properties:{code:{type:'string',description:'정확한 주차장 코드'},name:{type:'string',description:'주차장 이름'}},additionalProperties:false}
};
export async function run(args,context) {
  const code=String(args.code??'').trim(), name=normalize(args.name);
  if(!code&&!name) throw new Error('code 또는 name을 제공해 주세요.');
  if(code.length>80||name.length>80) throw new Error('검색어가 너무 깁니다.');
  const body=await getParking(context);
  const items=body.parkingList.filter(p => code ? String(p.parkgcd)===code : normalize(p.parknm)===name);
  if(items.length!==1) return {count:items.length,results:items.slice(0,10).map(summarize),notice:items.length?'동명 주차장이 있어 코드를 지정해야 합니다.':'일치하는 주차장을 찾지 못했습니다.'};
  const p=items[0];
  return { ...summarize(p),currentParked:p.parkingcnt,fees:{baseMinutes:p.pkBascTime,baseWon:p.tenMin,extraMinutes:p.pkAddTime,extraWon:p.feeAdd},
    hours:{weekday:[p.svcSrtTe,p.svcEndTe],saturday:[p.satSrtTe,p.satEndTe],holiday:[p.hldSrtTe,p.hldEndTe]},
    managingOffice:p.guNm,referenceDate:p.fnlDt,dataIssues:p.dataIssues,basicMatched:p.basicMatched,
    notice:'요금·운영시간·주소는 제공기관 자료이며 실제 안내를 우선하세요.',warnings:body.warnings,sources:body.sources};
}
