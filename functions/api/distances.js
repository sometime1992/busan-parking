import {drivingNearby} from './gemini.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export async function onRequestPost(context){
 let body;
 try{
  const raw=await context.request.text();
  if(raw.length>2048)return json({message:'요청이 너무 깁니다.'},413);
  body=JSON.parse(raw);
 }catch{return json({message:'잘못된 요청입니다.'},400);}
 const gps=body?.location, codes=body?.parkingCodes;
 if(!gps||!Number.isFinite(gps.latitude)||!Number.isFinite(gps.longitude)||gps.latitude<34||gps.latitude>36.5||gps.longitude<128||gps.longitude>131)return json({message:'부산 지역의 GPS 정보가 필요합니다.'},400);
 if(!Array.isArray(codes)||codes.length<1||codes.length>10||codes.some(c=>typeof c!=='string'||c.length>80))return json({message:'주차장 코드는 최대 10개까지 선택해 주세요.'},400);
 try{return await drivingNearby(context,gps,'자동차 거리 '+codes.length+'곳',codes);}
 catch(error){return json({message:error instanceof Error?error.message:'경로 확인 실패'},502);}
}
