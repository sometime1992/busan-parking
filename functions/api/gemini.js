// Gemini Function Calling bridge. Existing site files are untouched.
// Classroom demo endpoint: public access, no browser API key exposure. Apply rate limiting before wider release.
import * as search from '../../mcp/tools/searchParking.js';
import * as free from '../../mcp/tools/findAvailableParking.js';
import * as detail from '../../mcp/tools/getParkingDetail.js';
import * as nearby from '../../mcp/tools/findNearbyParking.js';
import {getParking} from '../../mcp/tools/data.js';
import {nearby as nearest,point,distanceMeters} from '../../lib/nearbyParking.js';
import {verifyParkingPlace} from '../../lib/verifyParkingPlace.js';
import {mappedParkingPlace} from '../../lib/verifiedParkingLocations.js';
import {geocodeParkingAddress} from '../../lib/geocodeParkingAddress.js';
const tools=[search,free,detail,nearby];
const map=new Map(tools.map(t=>[t.definition.name,t]));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const endpoint='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
async function generate(key,body){
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!response.ok) throw new Error('Gemini API 오류 ('+response.status+'). 프로젝트 모델 접근 권한, 사용량 또는 결제를 확인하세요.');
 return response.json();
}

const drivingRequest=async(key,origin,destination)=>{
 const url=new URL('https://apis-navi.kakaomobility.com/v1/directions');
 url.searchParams.set('origin',origin.longitude+','+origin.latitude);
 url.searchParams.set('destination',destination.lng+','+destination.lat);
 url.searchParams.set('priority','DISTANCE');
 url.searchParams.set('summary','true');
 const response=await fetch(url,{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(9000)});
 if(!response.ok) throw new Error('directionsHttp'+response.status);
 const body=await response.json();
 const route=body.routes?.[0];
 if(route?.result_code!==0 || !Number.isFinite(route?.summary?.distance) || !Number.isFinite(route?.summary?.duration)) throw new Error('directionsResult'+String(route?.result_code??'unknown'));
 return {drivingMeters:Math.round(route.summary.distance),drivingSeconds:Math.round(route.summary.duration)};
};
// Limit to 10 candidate destinations per search and 5 concurrent route requests.
const MAX_ROUTE_CANDIDATES=10;
const ROUTE_CONCURRENCY=5;
function requestedCount(question){
 const match=/(\d+)\s*(?:곳|개|군데)/.exec(question);
 return match?Math.min(10,Math.max(1,Number(match[1]))):5;
}
async function boundedRoutes(candidates,key,gps,stats){
 const results=new Array(candidates.length);
 let next=0;
 async function worker(){
  while(next<candidates.length){
   const i=next++;
   const p=candidates[i];
   if(stats)stats.routeRequests=(stats.routeRequests??0)+1;
   try {results[i]={status:'fulfilled',value:{...p,...await drivingRequest(key,gps,p.destination)}};if(stats)stats.routeSuccess=(stats.routeSuccess??0)+1;}
   catch(error){results[i]={status:'rejected',reason:error};if(stats){const label=String(error?.message??'').match(/directionsHttp\d+|directionsResult[-\d]+/)?.[0]??(error?.name==='TimeoutError'?'routeTimeout':'routeOther');stats[label]=(stats[label]??0)+1;}}
  }
 }
 await Promise.all(Array.from({length:Math.min(ROUTE_CONCURRENCY,candidates.length)},worker));
 return results;
}
export async function drivingNearby(context,gps,question,selectedCodes=null){
 const key=String(context.env.KAKAO_REST_API_KEY??'').trim();
 if(!key)return json({message:'KAKAO_REST_API_KEY 등록 후 다시 배포해 주세요.'},503);
 const limit=requestedCount(question),stats={};
 const list=await getParking(context);
 const explicit=Array.isArray(selectedCodes);
 const source=explicit?list.parkingList.filter(p=>selectedCodes.includes(String(p.parkgcd))):list.parkingList;
 const located=nearest(source,gps.latitude,gps.longitude,{
  limit:MAX_ROUTE_CANDIDATES,radius:explicit?600000:20000,
  onlyAvailable:explicit?false:!(/빈자리 상관없이|만차도|전체 주차장/.test(question))
 });
 // Auto-nearby rankings require a real location. Explicitly chosen facilities
 // can also be resolved by an independently matching official full address.
 const unlocated=explicit?source.filter(p=>!point(p))
  .map(p=>({...p,distanceMeters:null})):[];
 const candidates=[...located,...unlocated].slice(0,MAX_ROUTE_CANDIDATES);
 stats.sourceCoordinatesMissing=unlocated.length;
 if(!candidates.length)return json({
  answer:'현재 위치 주변에서 좌표가 확인되는 공영주차장을 찾지 못했습니다.',
  parkingCodes:[],parkingResults:[],routeMode:'unverified',
  routeDiagnostics:stats,toolsUsed:['findNearbyParking']
 });
 const found=new Array(candidates.length).fill(null);
 let next=0;
 await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
  while(next<candidates.length){
   const i=next++,p=candidates[i],publicPoint=point(p);
   try{
    const place=mappedParkingPlace(p)
     ??await verifyParkingPlace(p,key,context,stats)
     ??(!publicPoint?await geocodeParkingAddress(p,key,stats):null);
    found[i]={...p,verifiedPlace:place??null,
     destination:place??(publicPoint?{...publicPoint,name:p.parknm,source:'public_point'}:null),
     straightBasis:Number.isFinite(p.distanceMeters)?'public':place?'verified_location':null,
     distanceMeters:Number.isFinite(p.distanceMeters)?p.distanceMeters:
       place?Math.round(distanceMeters(gps.latitude,gps.longitude,place.lat,place.lng)):null};
   }catch{
    stats.locationOther=(stats.locationOther??0)+1;
    found[i]={...p,verifiedPlace:null,
     destination:publicPoint?{...publicPoint,name:p.parknm,source:'public_point'}:null,
     straightBasis:publicPoint?'public':null};
   }
  }
 }));
 // Do not merge distinct public parking codes onto one Kakao place id.
 const usedIds=new Map();
 for(const p of found){
  const id=p?.verifiedPlace?.placeId||p?.verifiedPlace?.placeUrl;
  if(id)usedIds.set(id,(usedIds.get(id)??0)+1);
 }
 for(const p of found){
  const id=p?.verifiedPlace?.placeId||p?.verifiedPlace?.placeUrl;
  if(!id||usedIds.get(id)<=1)continue;
  stats.duplicatePlaceIds=(stats.duplicatePlaceIds??0)+1;
  const original=point(p);
  p.verifiedPlace=null;
  p.destination=original?{...original,name:p.parknm,source:'public_point'}:null;
  if(!original){p.distanceMeters=null;p.straightBasis=null;}
 }
 const eligible=found.filter(p=>p?.destination);
 stats.matchedPlaces=eligible.filter(p=>p.verifiedPlace?.source==='kakao_verified'||p.verifiedPlace?.source==='manual_verified').length;
 stats.addressLocations=eligible.filter(p=>p.destination.source==='address_geocoded').length;
 stats.publicPointFallbacks=eligible.filter(p=>p.destination.source==='public_point').length;
 const settled=await boundedRoutes(eligible,key,gps,stats);
 const successful=settled.filter(r=>r.status==='fulfilled').map(r=>r.value)
  .sort((a,b)=>a.drivingMeters-b.drivingMeters||String(a.parkgcd).localeCompare(String(b.parkgcd)))
  .slice(0,limit);
 const succeeded=new Set(successful.map(p=>String(p.parkgcd)));
 const supplemental=found.filter(p=>!succeeded.has(String(p.parkgcd)))
  .slice(0,Math.max(0,limit-successful.length));
 const selected=[...successful,...supplemental];
 const failed=settled.filter(r=>r.status==='rejected').length;
 const reference=successful.filter(p=>p.destination?.source==='public_point').length;
 const missing=found.filter(p=>!p?.destination).length;
 const answer='자동차 주행거리 '+successful.length+'곳을 계산했습니다.'
  +(reference?' 이 중 '+reference+'곳은 공공데이터 대표 좌표 기준 참고용입니다.':'')
  +(supplemental.length?' 추가 후보 '+supplemental.length+'곳은 자동차 경로를 확인하지 못했습니다.':'');
 const notice='카카오 장소 기준 경로는 실제 차량 진입구와 다를 수 있습니다. '
  +'공공데이터 대표 좌표 또는 주소 기준 거리는 진입로까지의 정확한 거리가 아닌 참고용입니다.';
 return json({
  answer,parkingCodes:selected.map(p=>String(p.parkgcd)),
  parkingResults:selected.map(p=>{
   const routeBasis=p.destination?.source==='public_point'?'public':
    p.destination?.source==='address_geocoded'?'address':'place';
   return {code:String(p.parkgcd),name:p.parknm,availableSpaces:p.curravacnt,
    distanceMeters:Number.isFinite(p.distanceMeters)?p.distanceMeters:null,
    straightBasis:p.straightBasis??null,
    ...(Number.isFinite(p.drivingMeters)
     ?{drivingMeters:p.drivingMeters,drivingSeconds:p.drivingSeconds,
       routeBasis,...(p.verifiedPlace?{verifiedPlace:p.verifiedPlace}:{})}
     :{locationUnverified:true,routeStatus:p.destination?'route_failed':'location_unverified'})};
  }),
  toolsUsed:['findNearbyParking','kakaoLocal','kakaoDirections'],
  routeMode:successful.length?'driving':'unverified',
  routeStats:{candidates:candidates.length,verified:eligible.length,
   unverified:missing,failed,reference,limit:MAX_ROUTE_CANDIDATES},
  routeDiagnostics:stats,notice,
  partial:!!(supplemental.length||failed||missing)
 });
}

export async function onRequestPost(context){
 const key=String(context.env.GEMINI_API_KEY??'').trim();
 if(!key) return json({message:'GEMINI_API_KEY 비밀 변수가 설정되지 않았습니다.'},503);
 const raw = await context.request.text();
 if(raw.length > 2048) return json({message:'요청이 너무 깁니다.'},413);
 let input;
 try {input=JSON.parse(raw);}catch{return json({message:'JSON 요청이 필요합니다.'},400);}
 const question=String(input?.question??'').trim();
 const gps=input?.location;
 const validGps=gps&&Number.isFinite(gps.latitude)&&Number.isFinite(gps.longitude)&&gps.latitude>=33&&gps.latitude<=39.5&&gps.longitude>=124&&gps.longitude<=132;
 if(!question||question.length>300) return json({message:'질문은 1~300자로 입력해 주세요.'},400);
 if(validGps && /내 위치|현재 위치|내 주변|가까운|근처|주변 주차장/.test(question)) {
   try { return await drivingNearby(context,gps,question); }
   catch(error) { return json({message:error instanceof Error?error.message:'자동차 길찾기 오류'},502); }
 }
 // MCP inputSchema is JSON Schema; Gemini function declarations accept a smaller subset.
 // Do not send MCP-specific additionalProperties (can cause INVALID_ARGUMENT).
 const declarations=tools.map(({definition:d})=>({
   name:d.name,
   description:d.description,
   parameters:{
     type:'object',
     properties:Object.fromEntries(Object.entries(d.inputSchema.properties??{}).map(([name,schema])=>
       [name,{type:schema.type,description:schema.description??''}]
     )),
     ...(d.inputSchema.required?.length?{required:d.inputSchema.required}:{})
   }
 }));
 const contents=[{role:'user',parts:[{text:validGps ? question+' (사용자가 허용한 GPS 위치: latitude='+gps.latitude+', longitude='+gps.longitude+'. 근처 주차장 요청에는 findNearbyParking 도구를 사용하세요.)' : question}]}];
 const request={contents,systemInstruction:{parts:[{text:'당신은 부산 공영주차장 정보 안내자입니다. 주차장 빈자리·주소·요금은 반드시 도구 조회 결과로만 답하세요. 조회 불가 정보는 추측하지 마세요. 빈자리는 제공기관 갱신 당시 수치이며 현장에서 달라질 수 있음을 안내하세요. 한국어로 간결하게 답하세요. 주차장 검색 결과가 있으면 첫 문장은 사용자의 검색 조건에 맞는 한 줄 요약으로 작성하세요. 상세 목록은 UI에서 따로 보여주므로 주차장 다섯 곳을 반복 나열하지 마세요.'}]},tools:[{functionDeclarations:declarations}],generationConfig:{temperature:0.2,maxOutputTokens:800}};
 try{
  let called=[];
  let parkingCodes=[];
  let parkingResults=[];
  const toolCache=new Map();
  const MAX_TOOL_CALLS=8;
  let totalCalls=0;
  const fallback=(reason)=>json({answer:parkingCodes.length ? `조회된 주차장 ${parkingCodes.length}곳을 아래 목록에서 확인할 수 있습니다. AI 답변은 ${reason} 완료되지 않았습니다.` : `조회 결과를 완성하지 못했습니다. ${reason} 질문을 바꿔 다시 시도해 주세요.`,parkingCodes,parkingResults,toolsUsed:called,partial:true,model:'gemini-3.5-flash-lite'});
  for(let round=0;round<4;round++){
   let output;
   try { output=await generate(key,request); }
   catch(error) { if(parkingCodes.length) return fallback('Gemini 응답 오류로'); throw error; }
   const candidate=output.candidates?.[0]?.content;
   if(!candidate?.parts?.length) { if(parkingCodes.length) return fallback('응답 내용이 없어'); throw new Error('Gemini 응답 내용이 없습니다.'); }
   contents.push(candidate);
   const calls=candidate.parts.filter(p=>p.functionCall).map(p=>p.functionCall);
   if(!calls.length) return json({answer:candidate.parts.filter(p=>typeof p.text==='string').map(p=>p.text).join('\\n'),parkingCodes,parkingResults,toolsUsed:called,model:'gemini-3.5-flash-lite'});
   const responses=[];
   for(const c of calls.slice(0,3)){
    const t=map.get(c.name);
    if(c.name==='findNearbyParking' && !validGps) { responses.push({functionResponse:{name:c.name,response:{error:'사용자 위치 권한이 필요합니다.'}}}); continue; }
    if(c.name==='findNearbyParking') c.args={...c.args,latitude:gps.latitude,longitude:gps.longitude};
    const cacheKey=JSON.stringify([c.name,c.args??{}]);
    let result;
    if(toolCache.has(cacheKey)) result=toolCache.get(cacheKey);
    else if(totalCalls>=MAX_TOOL_CALLS) result={error:'도구 호출 횟수 제한'};
    else {
      totalCalls++;
      try { result=t?await t.run(c.args??{},context):{error:'허용되지 않은 도구'}; }
      catch(error) { result={error:error instanceof Error?error.message:'조회 실패'}; }
      toolCache.set(cacheKey,result);
    }
    if(t) {
      const rows=Array.isArray(result?.results) ? result.results : (result?.code ? [result] : []);
      for(const item of rows){
        const code=String(item?.code??'').trim();
        if(code && !parkingCodes.includes(code) && parkingCodes.length<20){
          parkingCodes.push(code);
          parkingResults.push({code,name:String(item.name??''),availableSpaces:item.availableSpaces??null,distanceMeters:item.distanceMeters??null});
        }
      }
    }
    called.push(c.name);
    responses.push({functionResponse:{name:c.name,response:{result},...(c.id?{id:c.id}:{})}});
   }
   contents.push({role:'user',parts:responses});
  }
  return fallback('도구 호출 반복 제한으로');
 }catch(error){return json({message:error instanceof Error?error.message:'Gemini 연결 오류'},502);}
}
export const onRequestGet=()=>json({message:'POST 방식으로만 테스트할 수 있습니다.'},405);
