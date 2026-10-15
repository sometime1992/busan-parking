// Cloudflare Pages에서 동작하는 읽기 전용 stateless Streamable HTTP MCP 서버.
// Gemini의 Remote MCP 연결은 /mcp 엔드포인트를 지정합니다.
import * as search from './tools/searchParking.js';
import * as availability from './tools/findAvailableParking.js';
import * as detail from './tools/getParkingDetail.js';
const toolMap = new Map([search,availability,detail].map(t=>[t.definition.name,t]));
const protocol='2025-06-18';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers});
const rpc=(id,result)=>({jsonrpc:'2.0',id,result});
const err=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
export async function handleMcp(context) {
  const method=context.request.method;
  if(method==='GET') return new Response('MCP endpoint: POST JSON-RPC messages to /mcp.',{status:405,headers:{Allow:'POST, OPTIONS'}});
  if(method==='OPTIONS') return new Response(null,{status:204,headers:{Allow:'POST, OPTIONS'}});
  if(method!=='POST') return reply(err(null,-32600,'Unsupported method'),405);
  if(Number(context.request.headers.get('content-length'))>32768) return reply(err(null,-32600,'Request too large'),413);
  let input;
  try { const raw=await context.request.text(); if(raw.length>32768) throw new Error(); input=JSON.parse(raw); }
  catch { return reply(err(null,-32700,'Invalid JSON'),400); }
  if(!input || Array.isArray(input) || input.jsonrpc!=='2.0' || typeof input.method!=='string') return reply(err(input?.id??null,-32600,'Invalid Request'),400);
  if(!Object.hasOwn(input,'id')) return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
  const id=input.id;
  if(input.method==='initialize') return reply(rpc(id,{protocolVersion:protocol,capabilities:{tools:{listChanged:false}},serverInfo:{name:'busan_parking',version:'1.0.0'}}));
  if(input.method==='ping') return reply(rpc(id,{}));
  if(input.method==='tools/list') return reply(rpc(id,{tools:[...toolMap.values()].map(t=>t.definition)}));
  if(input.method==='tools/call') {
    const tool=toolMap.get(input.params?.name);
    if(!tool) return reply(err(id,-32602,'Unknown tool'));
    const args=input.params?.arguments??{};
    if(!args || Array.isArray(args) || typeof args!=='object') return reply(err(id,-32602,'Invalid arguments'));
    try {
      const result=await tool.run(args,context);
      return reply(rpc(id,{content:[{type:'text',text:JSON.stringify(result)}],isError:false}));
    } catch(error) {
      return reply(rpc(id,{content:[{type:'text',text:error instanceof Error?error.message:'조회 실패'}],isError:true}));
    }
  }
  return reply(err(id,-32601,'Method not found'));
}
