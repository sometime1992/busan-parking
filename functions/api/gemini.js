// Gemini Function Calling bridge. Existing site files are untouched.
// Classroom demo endpoint: public access, no browser API key exposure. Apply rate limiting before wider release.
import * as search from '../../mcp/tools/searchParking.js';
import * as free from '../../mcp/tools/findAvailableParking.js';
import * as detail from '../../mcp/tools/getParkingDetail.js';
import * as nearby from '../../mcp/tools/findNearbyParking.js';
import {getParking} from '../../mcp/tools/data.js';
import {nearby as nearest,point} from '../../lib/nearbyParking.js';
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
 if(!response.ok) throw new Error('자동차 길찾기 API 오류 ('+response.status+')');
 const body=await response.json();
 const route=body.routes?.[0];
 if(route?.result_code!==0 || !Number.isFinite(route?.summary?.distance) || !Number.isFinite(route?.summary?.duration)) throw new Error('자동차 경로를 찾지 못했습니다.');
 return {drivingMeters:Math.round(route.summary.distance),drivingSeconds:Math.round(route.summary.duration)};
};
// 자동차 경로 요청은 1회 검색당 최대 20건, 동시 최대 5건으로 제한합니다.
const MAX_ROUTE_CANDIDATES=20;
const ROUTE_CONCURRENCY=5;
function requestedCount(question){
 const match=/(\d+)\s*(?:곳|개|군데)/.exec(question);
 return match?Math.min(10,Math.max(1,Number(match[1]))):5;
}
async function boundedRoutes(candidates,key,gps){
 const results=new Array(candidates.length);
 let next=0;
 async function worker(){
  while(next<candidates.length){
   const i=next++;
   const p=candidates[i];
   try {results[i]={status:'fulfilled',value:{...p,...await drivingRequest(key,gps,p.verifiedPlace??point(p))}};}
   catch(error){results[i]={status:'rejected',reason:error};}
  }
 }
 await Promise.all(Array.from({length:Math.min(ROUTE_CONCURRENCY,candidates.length)},worker));
 return results;
}
export async function drivingNearby(context,gps,question,selectedCodes=null){
 const key=String(context.env.KAKAO_REST_API_KEY??'').trim();
 if(!key) return json({message:'KAKAO_REST_API_KEY 등록 후 다시 배포해 주세요.'},503);
 const limit=requestedCount(question);
 const list=await getParking(context);
 // 후보는 직선거리로만 1차 선별합니다. 최종 순위는 반드시 실제 자동차 경로로 계산합니다.
 const source=Array.isArray(selectedCodes)?list.parkingList.filter(p=>selectedCodes.includes(String(p.parkgcd))):list.parkingList;
 const candidates=nearest(source,gps.latitude,gps.longitude,{
  limit:MAX_ROUTE_CANDIDATES,radius:20000,
  onlyAvailable:Array.isArray(selectedCodes)?false:!(/빈자리 상관없이|만차도|전체 주차장/.test(question))
 });
 if(!candidates.length) return json({answer:'GPS 좌표와 주차장 좌표가 확인되는 주변 주차장을 찾지 못했습니다.',parkingCodes:[],parkingResults:[],toolsUsed:['findNearbyParking'],routeMode:'driving'});
 // Match against Kakao's registered parking places; never route to unverified source coordinates.
 const verified=new Array(candidates.length).fill(null);
 let verifyIndex=0;
 await Promise.all(Array.from({length:Math.min(5,candidates.length)},async()=>{
  while(verifyIndex<candidates.length){
   const i=verifyIndex++;
   const p=candidates[i];
   try{const place=mappedParkingPlace(p)??await verifyParkingPlace(p,key,context)??await geocodeParkingAddress(p,key);if(place)verified[i]={...p,verifiedPlace:place};}
   catch{/* 카카오 장소 미확인: 공공데이터 좌표로 길찾기를 강행하지 않습니다. */}
  }
 }));
 const verifiedCandidates=verified.filter(Boolean);
 if(!verifiedCandidates.length)return json({
  answer:'주차장 위치를 충분히 검증하지 못해 자동차 주행거리는 제공하지 않습니다. 대신 공공데이터 기준으로 가까운 후보를 표시합니다.',
  parkingCodes:candidates.slice(0,limit).map(p=>String(p.parkgcd)),
  parkingResults:candidates.slice(0,limit).map(p=>({code:String(p.parkgcd),name:p.parknm,availableSpaces:p.curravacnt,distanceMeters:p.distanceMeters,locationUnverified:true})),
  toolsUsed:['findNearbyParking','kakaoLocal'],routeMode:'unverified',
  notice:'자동차 주행거리는 목적지를 확인하지 못해 표시하지 않습니다. 직선거리는 공공데이터 대표 좌표를 기준으로 계산하므로 실제 주차장 입구와 다를 수 있습니다.',
  partial:true
 });
 const settled=await boundedRoutes(verifiedCandidates,key,gps);
 const successful=settled.filter(r=>r.status==='fulfilled').map(r=>r.value)
   .sort((a,b)=>a.drivingMeters-b.drivingMeters || String(a.parkgcd).localeCompare(String(b.parkgcd)))
   .slice(0,limit);
 // Fill missing slots with clearly labeled unverified candidates, without assigning driving distances.
 const selected=new Set(successful.map(p=>String(p.parkgcd)));
 const supplemental=candidates.filter(p=>!selected.has(String(p.parkgcd))).slice(0,Math.max(0,limit-successful.length));
 const display=[...successful,...supplemental];
 if(!display.length) return json({message:'표시할 주차장 후보가 없습니다.'},404);
 const failed=settled.filter(r=>r.status==='rejected').length;
 const partial=supplemental.length>0||successful.length<limit||failed>0||verifiedCandidates.length<candidates.length;
 const notice=`주변 후보 ${candidates.length}곳 중 목적지 좌표를 확인한 ${verifiedCandidates.length}곳의 자동차 경로를 계산했습니다. 주소 기준 거리는 주차장 진입로까지의 거리와 다를 수 있습니다. 미확인 후보 ${supplemental.length}곳은 공공데이터 기준 직선거리만 표시합니다.`;
 return json({
  answer:`자동차 경로가 확인된 ${successful.length}곳과 추가 주차장 후보 ${supplemental.length}곳을 찾았습니다.`,
  parkingCodes:display.map(p=>String(p.parkgcd)),
  parkingResults:display.map(p=>({code:String(p.parkgcd),name:p.parknm,availableSpaces:p.curravacnt,distanceMeters:p.distanceMeters,...(Number.isFinite(p.drivingMeters)?{drivingMeters:p.drivingMeters,drivingSeconds:p.drivingSeconds,verifiedPlace:p.verifiedPlace,routeBasis:p.verifiedPlace?.source==='address_geocoded'?'address':'place'}  :{locationUnverified:true})})),
  toolsUsed:['findNearbyParking','kakaoDirections'],routeMode:'driving',
  routeStats:{candidates:candidates.length,verified:verifiedCandidates.length,unverified:candidates.length-verifiedCandidates.length,failed,limit:MAX_ROUTE_CANDIDATES},
  notice,partial
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
 const validGps=gps&&Number.isFinite(gps.latitude)&&Number.isFinite(gps.longitude)&&gps.latitude>=34&&gps.latitude<=36.5&&gps.longitude>=128&&gps.longitude<=131;
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
