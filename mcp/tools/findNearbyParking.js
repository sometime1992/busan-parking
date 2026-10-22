import { getParking, summarize } from './data.js';
import { nearby } from '../../lib/nearbyParking.js';
export const definition={
 name:'findNearbyParking',
 description:'GPS 현재 위치에서 직선거리로 가까운 부산 공영주차장을 조회합니다. 위치 권한 허용 후 전달된 위도와 경도만 사용합니다.',
 inputSchema:{type:'object',properties:{latitude:{type:'number'},longitude:{type:'number'},limit:{type:'integer'},radiusMeters:{type:'integer'},onlyAvailable:{type:'boolean'}},required:['latitude','longitude']}
};
export async function run(args,context){
 const body=await getParking(context);
 const matches=nearby(body.parkingList,Number(args.latitude),Number(args.longitude),{limit:args.limit??5,radius:Math.min(20000,Math.max(200,args.radiusMeters??10000)),onlyAvailable:args.onlyAvailable!==false});
 return {count:matches.length,results:matches.map(p=>({...summarize(p),distanceMeters:p.distanceMeters})),warnings:body.warnings,
 notice:'GPS와 제공기관 WGS84 좌표가 모두 확인된 주차장만 표시합니다. 거리는 실제 도로 이동거리가 아닌 직선거리입니다.'};
}
