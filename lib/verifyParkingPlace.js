import {distanceMeters,point} from './nearbyParking.js';

const normalize=s=>String(s??'').normalize('NFKC').toLowerCase()
 .replace(/공영주차장|공영|주차장|[\s()（）,.-]/g,'');
const clean=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ');
function addressParts(value) {
 const text=clean(value);
 const district=text.match(/(?:부산광역시\s*)?([가-힣]+구|기장군)/)?.[1]??'';
 const neighborhood=text.match(/([가-힣0-9]+(?:동|읍|면|리))/g)?.at(-1)??'';
 // Match a full lot number (not an arbitrary substring of an address).
 const lot=text.match(/(?:산\s*)?(\d+(?:-\d+)?)\s*$/)?.[1]??'';
 return {district,neighborhood,lot};
}
function addressEvidence(source,candidate) {
 const a=addressParts(source),b=addressParts(candidate);
 const district=a.district&&b.district&&a.district===b.district;
 const neighborhood=a.neighborhood&&b.neighborhood&&a.neighborhood===b.neighborhood;
 const lot=a.lot&&b.lot&&a.lot===b.lot;
 return {district:Boolean(district),neighborhood:Boolean(neighborhood),lot:Boolean(lot)};
}
export async function verifyParkingPlace(p,key,context,stats){
 const origin=point(p),name=clean(p.parknm);
 if(!origin||!name)return null;
 const cache=globalThis.caches?.default;
 const cacheKey=new URL('/__parking_cache/verified-location/v1/'+encodeURIComponent(String(p.parkgcd??''))+'/'+encodeURIComponent(name+'|'+String(p.jibunAddr??'')+'|'+String(p.doroAddr??'')+'|'+origin.lat+','+origin.lng),context?.request?.url??'https://localhost').href;
 if(cache){try{const hit=await cache.match(cacheKey);if(hit)return await hit.json();}catch{/* continue verification */}}
 const addresses=[p.jibunAddr,p.doroAddr].map(clean).filter(Boolean);
 // Cloudflare Free has a strict outgoing request budget. Keep this to two targeted lookups.
 const queryAddress=addresses[0]??'';
 const queries=[name+' 공영주차장',
   queryAddress ? (queryAddress.includes('부산')?queryAddress:'부산광역시 '+queryAddress)+' 공영주차장' : name+' 주차장'
 ].filter((q,i,a)=>a.indexOf(q)===i);
 const candidates=new Map();
 // Maximum two Local API calls per candidate, including empty results.
 for(const query of queries){
  try{
   const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
   url.searchParams.set('query',query);
   url.searchParams.set('x',String(origin.lng));
   url.searchParams.set('y',String(origin.lat));
   url.searchParams.set('radius','2000');
   url.searchParams.set('size','15');
   if(stats)stats.localRequests=(stats.localRequests??0)+1;
   const response=await fetch(url,{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(3500)});
   if(!response.ok){if(stats){const k='localHttp'+response.status;stats[k]=(stats[k]??0)+1;}continue;}
   const body=await response.json();
   for(const d of body.documents??[]) if(d.id)candidates.set(d.id,d);
  }catch(error){if(stats){const k=error?.name==='TimeoutError'?'localTimeout':'localNetworkFailure';stats[k]=(stats[k]??0)+1;}}
 }
 const target=normalize(name);
 const ranked=[...candidates.values()].flatMap(d=>{
  const lat=Number(d.y),lng=Number(d.x);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return [];
  const distance=distanceMeters(origin.lat,origin.lng,lat,lng);
  if(distance>1000)return [];
  const candidateName=normalize(d.place_name);
  const nameMatch=target.length>=3&&candidateName.length>=3
   &&(candidateName.includes(target)||target.includes(candidateName));
  // Kakao is a location-verification source, not a source of additional parking lots.
  // A Kakao place can omit the word "공영" even when the public dataset lists it as public.
  const parkingCategory=d.category_group_code==='PK6'||/주차/.test(String(d.category_name??''));
  if(!parkingCategory)return [];
  const publicPlace=/공영|시영|구영/.test(String(d.place_name??'')+' '+String(d.category_name??''));
  const evidence=addresses.map(a=>addressEvidence(a,d.address_name||d.road_address_name))
   .concat(addresses.map(a=>addressEvidence(a,d.road_address_name||d.address_name)));
  const addressMatch=evidence.some(e=>e.district&&e.neighborhood&&e.lot);
  const localityMatch=evidence.some(e=>e.district&&e.neighborhood);
  // Names may differ between public data and Kakao. Exact locality + lot is then mandatory.
  if(!nameMatch&&!addressMatch)return [];
  // Matching an address alone can incorrectly pick a private lot on the same parcel.
  // When names differ, only accept clearly public Kakao places with exact address evidence.
  if(!nameMatch && (!addressMatch || !publicPlace))return [];
  if(!localityMatch&&!nameMatch)return [];
  if(!addressMatch&&distance>200)return [];
  const score=(nameMatch?65:0)+(addressMatch?100:0)+(localityMatch?15:0)+(publicPlace?10:0)-distance/30;
  return [{name:d.place_name,lat,lng,placeUrl:d.place_url,source:'kakao_verified',score}];
 }).sort((a,b)=>b.score-a.score);
 if(!ranked.length||(ranked.length>1&&ranked[0].score-ranked[1].score<12)){if(stats)stats.localUnmatched=(stats.localUnmatched??0)+1;return null;}
 const {score,...place}=ranked[0];
 if(stats)stats.localMatched=(stats.localMatched??0)+1;
 if(cache){
  const response=new Response(JSON.stringify(place),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=86400'}});
  const writing=cache.put(cacheKey,response).catch(()=>{});
  if(context?.waitUntil)context.waitUntil(writing);else await writing;
 }
 return place;
}
