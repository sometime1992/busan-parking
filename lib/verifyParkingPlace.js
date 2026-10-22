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
export async function verifyParkingPlace(p,key){
 const origin=point(p),name=clean(p.parknm);
 if(!origin||!name)return null;
 const addresses=[p.jibunAddr,p.doroAddr].map(clean).filter(Boolean);
 const queries=[
  name+' 공영주차장',name+' 주차장',
  ...addresses.flatMap(address=>[address+' 공영주차장',address+' 주차장']),
  name
 ].filter((q,i,a)=>a.indexOf(q)===i);
 const candidates=new Map();
 // Limit Kakao search volume to five queries per parking lot.
 for(const query of queries.slice(0,5)){
  try{
   const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
   url.searchParams.set('query',query);
   url.searchParams.set('x',String(origin.lng));
   url.searchParams.set('y',String(origin.lat));
   url.searchParams.set('radius','2000');
   url.searchParams.set('size','15');
   const response=await fetch(url,{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(4500)});
   if(!response.ok) continue;
   const body=await response.json();
   for(const d of body.documents??[]) if(d.id)candidates.set(d.id,d);
  }catch{/* Try next query. */}
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
  const parkingCategory=d.category_group_code==='PK6'||/주차/.test(String(d.category_name??''));
  if(!parkingCategory)return [];
  const evidence=addresses.map(a=>addressEvidence(a,d.address_name||d.road_address_name))
   .concat(addresses.map(a=>addressEvidence(a,d.road_address_name||d.address_name)));
  const addressMatch=evidence.some(e=>e.district&&e.neighborhood&&e.lot);
  const localityMatch=evidence.some(e=>e.district&&e.neighborhood);
  // Names may differ between public data and Kakao. Exact locality + lot is then mandatory.
  if(!nameMatch&&!addressMatch)return [];
  if(!localityMatch&&!nameMatch)return [];
  if(!addressMatch&&distance>200)return [];
  const score=(nameMatch?65:0)+(addressMatch?100:0)+(localityMatch?15:0)-distance/30;
  return [{name:d.place_name,lat,lng,placeUrl:d.place_url,source:'kakao_verified',score}];
 }).sort((a,b)=>b.score-a.score);
 if(!ranked.length||(ranked.length>1&&ranked[0].score-ranked[1].score<12))return null;
 const {score,...place}=ranked[0];
 return place;
}
