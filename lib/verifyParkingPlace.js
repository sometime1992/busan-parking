import {distanceMeters,point} from './nearbyParking.js';
import {suppliedPlaceFor} from './suppliedParkingPlaces.js';

// Match ONLY locations already present in the public parking dataset.
// A nearby PK6 place is not necessarily the same facility or the same numbered zone.
const clean=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const nameKey=s=>clean(s).toLowerCase()
 .replace(/도시철도|공영주차장|공영|주차장|[,\s().·_-]/g,'');
const zoneOf=s=>{
 const v=clean(s).replace(/제\s*/g,'');
 const m=v.match(/(?:^|[^0-9])([1-9]\d?)\s*(?:구역|(?:공영)?주차장|주차구역|주차구획)/);
 return m?Number(m[1]):null;
};
const comparableName=(a,b)=>{
 const x=nameKey(a),y=nameKey(b);
 if(!x||!y)return {exact:false,partial:false};
 const exact=x===y;
 const partial=!exact&&Math.min(x.length,y.length)>=4&&(x.includes(y)||y.includes(x));
 return {exact,partial};
};
const addressPart=s=>{
 const text=clean(s);
 return {district:text.match(/([가-힣]+구|기장군)/)?.[1]??'',
  locality:text.match(/([가-힣0-9]+(?:동|읍|면|리))/g)?.at(-1)??'',
  number:text.match(/(?:산\s*)?(\d+(?:-\d+)?)\s*$/)?.[1]??''};
};
const root=s=>s.replace(/\d+(?=동$)/g,'');
function evidence(p,d){
 let best={district:false,locality:false,full:false};
 for(const [from,to] of [[p.jibunAddr,d.address_name],[p.doroAddr,d.road_address_name]]){
  const a=addressPart(from),b=addressPart(to);
  const district=!!(a.district&&a.district===b.district);
  const locality=!!(district&&a.locality&&root(a.locality)===root(b.locality));
  const full=!!(locality&&a.number&&a.number===b.number);
  best={district:best.district||district,locality:best.locality||locality,full:best.full||full};
 }
 return best;
}
function acceptable(p,d,origin,ownerIdConfirmed=false){
 const lat=Number(d.y),lng=Number(d.x);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||
    lat<34.5||lat>36||lng<128.5||lng>130)return null;
 if(!(d.category_group_code==='PK6'||/주차장/.test(String(d.category_name??''))))return null;
 const pubZone=zoneOf(p.parknm),kakaoZone=zoneOf(d.place_name);
 if(pubZone!==null&&kakaoZone!==null&&pubZone!==kakaoZone)return null;
 const ev=evidence(p,d),name=comparableName(p.parknm,d.place_name);
 const isPublic=/공영|시영|구영/.test(String(d.place_name??'')+' '+String(d.category_name??''));
 const gap=origin?distanceMeters(origin.lat,origin.lng,lat,lng):null;
 // A matching public address can be further from an imprecise source point.
 if(gap!==null&&gap>(ev.full&&isPublic?8000:3500))return null;
 const zoneMissing=pubZone!==null&&kakaoZone===null;
 // With no source coordinates AND no official address, accept only a distinctive
 // exact public-parking name; selectGroup still rejects distant competing matches.
 const busanPlaceAddress=/부산/.test(String(d.address_name??'')+' '+String(d.road_address_name??''));
 const uniqueNamedPublic=!origin&&!clean(p.jibunAddr)&&!clean(p.doroAddr)
  &&name.exact&&nameKey(p.parknm).length>=6&&isPublic&&busanPlaceAddress;
 // The owner supplied the EXACT Kakao place ID. When the API also returns
 // this ID, an exact same public-parking name + Busan address can resolve short
 // names such as '중동역' that normal automatic searches must reject.
 const suppliedExact=ownerIdConfirmed&&name.exact&&nameKey(p.parknm).length>=3
  &&isPublic&&busanPlaceAddress;
 // A site-wide Kakao pin is not proof of which numbered sub-zone it serves.
 // Resolve those numbered zones via exact official address (reference basis) instead.
 if(zoneMissing)return null;
 const strongAddress=ev.full&&isPublic;
 const strongName=name.exact&&ev.locality;
 const localName=name.partial&&ev.locality&&gap!==null&&gap<=1500;
 const veryCloseName=name.exact&&gap!==null&&gap<=180;
 if(!(strongAddress||strongName||localName||veryCloseName||uniqueNamedPublic||suppliedExact))return null;
 // Named zones must not be merged into an unnumbered map place by name alone.
 if(zoneMissing&&!strongAddress&&!(gap!==null&&gap<=130&&strongName))return null;
 // Without public coordinates, require solid official address or exact name and locality.
 if(!origin&&!strongAddress&&!strongName&&!uniqueNamedPublic&&!suppliedExact)return null;
 const score=(strongAddress?115:0)+(name.exact?90:name.partial?38:0)+
  (ev.locality?25:0)+(ev.district?8:0)+(isPublic?12:0)+
  (kakaoZone!==null&&kakaoZone===pubZone?40:0)+(uniqueNamedPublic?20:0)+(suppliedExact?40:0)-(gap??500)/150;
 return {id:String(d.id),name:d.place_name,lat,lng,
  placeUrl:d.place_url,source:'kakao_verified',score};
}
function selectGroup(candidates){
 // Multiple Kakao IDs in the same very small area can represent the same
 // facility. Keep their IDs, but never coalesce distant or conflicting zones.
 const ranked=candidates.sort((a,b)=>b.score-a.score);
 if(!ranked.length)return null;
 const top=ranked[0];
 const close=ranked.filter(d=>distanceMeters(top.lat,top.lng,d.lat,d.lng)<=85);
 const farRivals=ranked.slice(1).filter(d=>!close.includes(d)&&top.score-d.score<22);
 if(farRivals.length)return null;
 const relatedPlaceIds=close.map(d=>d.id).filter(Boolean).slice(0,15);
 return {name:top.name,lat:top.lat,lng:top.lng,placeUrl:top.placeUrl,
   placeId:top.id,relatedPlaceIds,source:'kakao_verified'};
}
export async function verifyParkingPlace(p,key,context,stats){
 const origin=point(p),name=clean(p.parknm);
 const ownerPlace=suppliedPlaceFor(p);
 if(!name)return null;
 const cache=globalThis.caches?.default;
 const cacheUrl=new URL('/__parking_cache/verified-location/v5/'
   +encodeURIComponent(String(p.parkgcd??''))+'/'
   +encodeURIComponent(name+'|'+String(p.jibunAddr??'')+'|'+String(p.doroAddr??'')+
    '|'+(origin?.lat??'none')+','+(origin?.lng??'none')),
    context?.request?.url??'https://localhost').href;
 if(cache){try{const hit=await cache.match(cacheUrl);if(hit){
  if(stats)stats.cachedPlaces=(stats.cachedPlaces??0)+1;
  return await hit.json();
 }}catch{/* Kakao lookup remains available */}}
 // Optional durable cache across Cloudflare locations. No binding is required:
 // without PARKING_LOCATIONS_KV, the existing edge cache remains the fallback.
 const kv=context?.env?.PARKING_LOCATIONS_KV;
 let kvKey=null;
 if(kv&&typeof kv.get==='function'){
  try{
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cacheUrl));
   kvKey='verified-poi-v5:'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
   const stored=await kv.get(kvKey,'json');
   if(stored&&stored.source==='kakao_verified'&&Number.isFinite(stored.lat)&&Number.isFinite(stored.lng)&&stored.placeId){
    if(stats)stats.kvCachedPlaces=(stats.kvCachedPlaces??0)+1;
    return stored;
   }
  }catch{/* Continue without KV. */}
 }
 const addresses=[p.jibunAddr,p.doroAddr].map(clean).filter(Boolean);
 const district=addresses.map(a=>addressPart(a).district).find(Boolean)??'부산';
 const queryAddress=addresses.slice().sort((a,b)=>b.length-a.length)[0]??'';
 // The owner-supplied place name must be queried first; searching only the
 // public-data name often does not return the supplied place ID at all.
 const targetName=ownerPlace?.siteName??name;
 const queries=[(ownerPlace?'부산 ':'')+targetName+' 공영주차장',
   queryAddress?(queryAddress.includes('부산')?queryAddress:'부산광역시 '+queryAddress)+' 주차장'
    :district+' '+name+' 주차장'
 ].filter((q,i,a)=>a.indexOf(q)===i);
 const raw=new Map();
 // Two targeted queries, one spatial when the official position is known,
 // one address-based without proximity bias; collect all returned aliases.
 for(const [i,query] of queries.entries()){
  try{
   const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
   url.searchParams.set('query',query);
   url.searchParams.set('size','15');
   // Some valid Kakao parking listings do not carry PK6; validate category after lookup.
   if(origin&&i===0&&!ownerPlace){
    url.searchParams.set('x',String(origin.lng));
    url.searchParams.set('y',String(origin.lat));
    url.searchParams.set('radius','3500');
   }
   if(stats)stats.localRequests=(stats.localRequests??0)+1;
   const response=await fetch(url,{headers:{Authorization:'KakaoAK '+key},
    signal:AbortSignal.timeout(3500)});
   if(!response.ok){
    if(stats){const k='localHttp'+response.status;stats[k]=(stats[k]??0)+1;}
    continue;
   }
   const data=await response.json();
   for(const d of data.documents??[])if(d.id)raw.set(String(d.id),d);
  }catch(error){
   if(stats){const k=error?.name==='TimeoutError'?'localTimeout':'localNetworkFailure';
    stats[k]=(stats[k]??0)+1;}
  }
 }
 const candidates=[...raw.values()].map(d=>acceptable(p,d,origin)).filter(Boolean);
 // The supplied URL identifies a preferred Kakao place candidate, not a
 // verified destination. Only adopt it when Kakao itself returns the same ID
 // and the place passes our category/name/address/zone/geography checks.
 const rawPreferred=ownerPlace?raw.get(ownerPlace.placeId):null;
 const preferred=rawPreferred?(acceptable(p,rawPreferred,origin,true)
  ??(ownerPlace.code===String(p.parkgcd)
    ?acceptable({...p,parknm:ownerPlace.siteName},rawPreferred,origin,true):null)):null;
 let selected;
 if(preferred){
  const nearbyAliases=candidates.filter(c=>c.id!==preferred.id&&
    distanceMeters(preferred.lat,preferred.lng,c.lat,c.lng)<=85);
  selected={
   name:preferred.name,lat:preferred.lat,lng:preferred.lng,
   placeId:preferred.id,placeUrl:ownerPlace.placeUrl,
   relatedPlaceIds:[preferred.id,...nearbyAliases.map(c=>c.id)].slice(0,15),
   source:'kakao_verified'
  };
  if(stats)stats.ownerPlaceIdValidated=(stats.ownerPlaceIdValidated??0)+1;
 }else{
  selected=selectGroup(candidates);
  if(ownerPlace&&stats){
   const k=rawPreferred?'ownerPlaceIdRejected':'ownerPlaceIdNotReturned';
   stats[k]=(stats[k]??0)+1;
  }
 }
 if(!selected){if(stats)stats.localUnmatched=(stats.localUnmatched??0)+1;return null;}
 if(stats){stats.localMatched=(stats.localMatched??0)+1;
  stats.localAliasCount=(stats.localAliasCount??0)+selected.relatedPlaceIds.length;}
 if(cache){
  const response=new Response(JSON.stringify(selected),{headers:{
   'Content-Type':'application/json','Cache-Control':'public, max-age=604800'}});
  const writing=cache.put(cacheUrl,response).catch(()=>{});
  if(context?.waitUntil)context.waitUntil(writing);else await writing;
 }
 if(kvKey&&typeof kv?.put==='function'){
  const writing=kv.put(kvKey,JSON.stringify(selected),{expirationTtl:604800}).catch(()=>{});
  if(context?.waitUntil)context.waitUntil(writing);else await writing;
 }
 return selected;
}
