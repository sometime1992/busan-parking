// Gemini Function Calling bridge. Existing site files are untouched.
// Classroom demo endpoint: public access, no browser API key exposure. Apply rate limiting before wider release.
import * as search from '../../mcp/tools/searchParking.js';
import * as free from '../../mcp/tools/findAvailableParking.js';
import * as detail from '../../mcp/tools/getParkingDetail.js';
const tools=[search,free,detail];
const map=new Map(tools.map(t=>[t.definition.name,t]));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const endpoint='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
async function generate(key,body){
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!response.ok) throw new Error('Gemini API 오류 ('+response.status+'). 프로젝트 모델 접근 권한, 사용량 또는 결제를 확인하세요.');
 return response.json();
}
export async function onRequestPost(context){
 const key=String(context.env.GEMINI_API_KEY??'').trim();
 if(!key) return json({message:'GEMINI_API_KEY 비밀 변수가 설정되지 않았습니다.'},503);
 const raw = await context.request.text();
 if(raw.length > 2048) return json({message:'요청이 너무 깁니다.'},413);
 let input;
 try {input=JSON.parse(raw);}catch{return json({message:'JSON 요청이 필요합니다.'},400);}
 const question=String(input?.question??'').trim();
 if(!question||question.length>300) return json({message:'질문은 1~300자로 입력해 주세요.'},400);
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
 const contents=[{role:'user',parts:[{text:question}]}];
 const request={contents,systemInstruction:{parts:[{text:'당신은 부산 공영주차장 정보 안내자입니다. 주차장 빈자리·주소·요금은 반드시 도구 조회 결과로만 답하세요. 조회 불가 정보는 추측하지 마세요. 빈자리는 제공기관 갱신 당시 수치이며 현장에서 달라질 수 있음을 안내하세요. 한국어로 간결하게 답하세요. 주차장 검색 결과가 있으면 첫 문장은 사용자의 검색 조건에 맞는 한 줄 요약으로 작성하세요. 상세 목록은 UI에서 따로 보여주므로 주차장 다섯 곳을 반복 나열하지 마세요.'}]},tools:[{functionDeclarations:declarations}],generationConfig:{temperature:0.2,maxOutputTokens:800}};
 try{
  let called=[];
  let parkingCodes=[];
  let parkingResults=[];
  for(let round=0;round<2;round++){
   const output=await generate(key,request);
   const candidate=output.candidates?.[0]?.content;
   if(!candidate?.parts?.length) throw new Error('Gemini 응답 내용이 없습니다.');
   contents.push(candidate);
   const calls=candidate.parts.filter(p=>p.functionCall).map(p=>p.functionCall);
   if(!calls.length) return json({answer:candidate.parts.filter(p=>typeof p.text==='string').map(p=>p.text).join('\\n'),parkingCodes,parkingResults,toolsUsed:called,model:'gemini-3.5-flash-lite'});
   const responses=[];
   for(const c of calls.slice(0,3)){
    const t=map.get(c.name);
    const result=t?await t.run(c.args??{},context):{error:'허용되지 않은 도구'};
    if(t) {
      const rows=Array.isArray(result?.results) ? result.results : (result?.code ? [result] : []);
      for(const item of rows){
        const code=String(item?.code??'').trim();
        if(code && !parkingCodes.includes(code) && parkingCodes.length<20){
          parkingCodes.push(code);
          parkingResults.push({code,name:String(item.name??''),availableSpaces:item.availableSpaces??null});
        }
      }
    }
    called.push(c.name);
    responses.push({functionResponse:{name:c.name,response:{result},...(c.id?{id:c.id}:{})}});
   }
   contents.push({role:'user',parts:responses});
  }
  return json({message:'도구 호출 반복 제한에 도달했습니다.',toolsUsed:called,parkingCodes},502);
 }catch(error){return json({message:error instanceof Error?error.message:'Gemini 연결 오류'},502);}
}
export const onRequestGet=()=>json({message:'POST 방식으로만 테스트할 수 있습니다.'},405);
