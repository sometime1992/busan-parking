import {distanceMeters,point} from './nearbyParking.js';

// Kakao is only used to verify the locations of facilities already in public parking data.
// It must never add a private or unrelated lot to the result list.
const clean=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const normalizedName=value=>clean(value).toLowerCase()
 .replace(/공영주차장|공영|주차장|[\s()（）,.-]/g,'');
function addressParts(value){
 const text=clean(value);
 return {
  district:text.match(/(?:부산광역시\s*)?([가-힣]+구|기장군)/)?.[1]??'',
  neighborhood:text.match(/([가-힣0-9]+(?:동|읍|면|리))/g)?.at(-1)??'',
  lot:text.match(/(?:산\s*)?(\d+(?:-\d+)?)\s*$/)?.[1]??''
 };
}
const neighborhoodRoot=s=>s.replace(/\d+(?=동$)/g,'');
function addressEvidence(source,candidate){
 const a=addressParts(source),b=addressParts(candidate);
 const district=!!(a.district&&b.district&&a.district===b.district);
 const neighborhood=!!(district&&a.neighborhood&&b.neighborhood&&
  neighborhoodRoot(a.neighborhood)===neighborhoodRoot(b.neighborhood));
 const exactLot=!!(neighborhood&&a.lot&&b.lot&&a.lot===b.lot);
 return {district,neighborhood,exactLot};
}
function maxEvidence(p,d){
 // Keep lot-number comparisons within the same address type. Road numbers and
 // parcel numbers are not interchangeable.
 const pairs=[
  [p.jibunAddr,d.address_name],
  [p.doroAddr,d.road_address_name]
 ];
 return pairs.reduce((best,[source,candidate])=>{
  const e=addressEvidence(source,candidate);
  return {district:best.district||e.district,
   neighborhood:best.neighborhood||e.neighborhood,
   exactLot:best.exactLot||e.exactLot};
 },{district:false,neighborhood:false,exactLot:false});
}
export async function verifyParkingPlace(p,key,context,stats){
 const origin=point(p),name=clean(p.parknm);
 if(!name)return null;
 const cache=globalThis.caches?.default;
 const cacheUrl=new URL('/__parking_cache/verified-location/v2/'
  +encodeURIComponent(String(p.parkgcd??''))+'/'
  +encodeURIComponent(name+'|'+String(p.jibunAddr??'')+'|'+String(p.doroAddr??'')
  +'|'+(origin?.lat??'none')+','+(origin?.lng??'none')),
  context?.request?.url??'https://localhost').href;
 if(cache){try{const hit=await cache.match(cacheUrl);if(hit){if(stats)stats.cachedPlaces=(stats.cachedPlaces??0)+1;return await hit.json();}}catch{/* Try Kakao. */}}
 const addresses=[p.jibunAddr,p.doroAddr].map(clean).filter(Boolean);
 const address=addresses[0]??'';
 const queries=[name+' 공영주차장',
  address ? (address.includes('부산')?address:'부산광역시 '+address)+' 공영주차장' : name+' 주차장'
 ].filter((q,i,a)=>a.indexOf(q)===i);
 const candidates=new Map();
 // At most two Kakao Local requests for this parking record.
 for(const query of queries){
  try{
   const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
   url.searchParams.set('query',query);
   if(origin){
    url.searchParams.set('x',String(origin.lng));
    url.searchParams.set('y',String(origin.lat));
    url.searchParams.set('radius','3500');
   }
   url.searchParams.set('size','15');
   if(stats)stats.localRequests=(stats.localRequests??0)+1;
   const response=await fetch(url,{headers:{Authorization:'KakaoAK '+key},
    signal:AbortSignal.timeout(3500)});
   if(!response.ok){
    if(stats){const k='localHttp'+response.status;stats[k]=(stats[k]??0)+1;}
    continue;
   }
   const body=await response.json();
   for(const d of body.documents??[])if(d.id)candidates.set(String(d.id),d);
  }catch(error){
   if(stats){const k=error?.name==='TimeoutError'?'localTimeout':'localNetworkFailure';stats[k]=(stats[k]??0)+1;}
  }
 }
 const target=normalizedName(name);
 const ranked=[...candidates.values()].flatMap(d=>{
  const lat=Number(d.y),lng=Number(d.x);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||
    lat<34.5||lat>36||lng<128.5||lng>130)return [];
  const category=d.category_group_code==='PK6'||/주차장/.test(String(d.category_name??''));
  if(!category)return [];
  const distance=origin?distanceMeters(origin.lat,origin.lng,lat,lng):null;
  if(distance!==null&&distance>3500)return [];
  const label=normalizedName(d.place_name);
  const exactName=target.length>=3&&target===label;
  const partialName=target.length>=4&&label.length>=4&&
   (label.includes(target)||target.includes(label));
  const publicPlace=/공영|시영|구영/.test(String(d.place_name??'')+' '+String(d.category_name??''));
  const evidence=maxEvidence(p,d);
  // Strong name + same locality is safe even if the public source coordinate
  // describes the lot's area rather than its vehicle entrance.
  const closeExactName=exactName&&distance!==null&&distance<=250;
  const localityName=exactName&&evidence.district&&evidence.neighborhood;
  const partialLocality=partialName&&evidence.neighborhood&&distance!==null&&distance<=1500;
  const exactPublicAddress=evidence.exactLot&&publicPlace;
  if(!(closeExactName||localityName||partialLocality||exactPublicAddress))return [];
  if(!origin&&!((exactName&&evidence.neighborhood)||exactPublicAddress))return [];
  const score=(exactName?120:partialName?65:0)+
   (evidence.exactLot?105:0)+(evidence.neighborhood?35:0)+
   (evidence.district?10:0)+(publicPlace?15:0)-
   (distance??500)/120;
  return [{name:d.place_name,lat,lng,placeUrl:d.place_url,
   source:'kakao_verified',score}];
 }).sort((a,b)=>b.score-a.score);
 if(!ranked.length||(ranked.length>1&&
    ranked[0].score-ranked[1].score<15&&
    distanceMeters(ranked[0].lat,ranked[0].lng,ranked[1].lat,ranked[1].lng)>60)){
  if(stats)stats.localUnmatched=(stats.localUnmatched??0)+1;
  return null;
 }
 const {score,...place}=ranked[0];
 if(stats)stats.localMatched=(stats.localMatched??0)+1;
 if(cache){
  const response=new Response(JSON.stringify(place),
   {headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=86400'}});
  const writing=cache.put(cacheUrl,response).catch(()=>{});
  if(context?.waitUntil)context.waitUntil(writing);else await writing;
 }
 return place;
}
