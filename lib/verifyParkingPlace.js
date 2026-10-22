import {distanceMeters,point} from './nearbyParking.js';
// Match parking names conservatively: remove only generic parking words, not distinctive name parts.
const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/공영주차장|공영|주차장|[\s()（）,.-]/g,'');
const token=s=>String(s??'').replace(/[^0-9가-힣a-zA-Z]/g,'');
export async function verifyParkingPlace(p,key){
 const origin=point(p),name=String(p.parknm??'').trim();
 if(!origin||!name)return null;
 const queries=[name+' 공영주차장',name+' 주차장',name];
 const candidates=new Map();
 for(const query of queries){
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
   if(candidates.size>=10)break;
  }catch{ /* Try alternate query. */ }
 }
 const target=normalize(name),address=String(p.jibunAddr??p.doroAddr??'');
 const placeNumber=token(address).match(/[0-9]+(?:-[0-9]+)?$/)?.[0];
 const ranked=[...candidates.values()].flatMap(d=>{
  const lat=Number(d.y),lng=Number(d.x);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return [];
  const distance=distanceMeters(origin.lat,origin.lng,lat,lng);
  const label=normalize(d.place_name);
  const nameMatch=target.length>=3 && label.length>=3 && (label.includes(target)||target.includes(label));
  const category=d.category_group_code==='PK6'||/주차장/.test(String(d.category_name??''));
  const locality=String(d.address_name??'')+' '+String(d.road_address_name??'');
  const addressMatch=!!placeNumber && locality.includes(placeNumber);
  // Large coordinate disagreement is not automatically accepted even if the name matches.
  if(!category||!nameMatch||distance>1000||(!addressMatch&&distance>250))return [];
  return [{name:d.place_name,lat,lng,placeUrl:d.place_url,source:'kakao_verified',score:(addressMatch?100:0)+50-distance/40}];
 }).sort((a,b)=>b.score-a.score);
 if(!ranked.length||(ranked.length>1&&ranked[0].score-ranked[1].score<10))return null;
 const {score,...place}=ranked[0];
 return place;
}
