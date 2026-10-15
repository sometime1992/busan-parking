import { getParking, normalize, limitOf, summarize } from './data.js';
export const definition = {
  name:'searchParking', description:'부산 공영주차장 이름으로 검색하고 현재 주차 가능한 대수를 확인합니다.',
  inputSchema:{type:'object',properties:{query:{type:'string',description:'주차장 이름 또는 일부 명칭'},limit:{type:'integer',minimum:1,maximum:20}},required:['query'],additionalProperties:false}
};
export async function run(args, context) {
  const q = normalize(args.query);
  if (!q || q.length > 80) throw new Error('검색어는 1~80자로 입력해 주세요.');
  const body = await getParking(context);
  const matches = body.parkingList.filter(p => normalize(p.parknm).includes(q)||normalize(p.pkNam).includes(q))
    .sort((a,b)=>Number(normalize(b.parknm).startsWith(q))-Number(normalize(a.parknm).startsWith(q)) || String(a.parknm).localeCompare(String(b.parknm),'ko'));
  return {count:matches.length,results:matches.slice(0,limitOf(args.limit)).map(summarize),warnings:body.warnings,sources:body.sources};
}
