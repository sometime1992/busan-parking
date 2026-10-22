import {distanceMeters,point} from './nearbyParking.js';
const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/공영주차장|공영|주차장|복개|\s|[()（）,.-]/g,'');
const number=s=>String(s??'').replace(/[^0-9]/g,'');
const area=s=>String(s??'').replace(/\s+/g,'');
export async function verifyParkingPlace(p,key){
 const origin=point(p);
 const query=String(p.parknm??'').trim();
 if(!query || !origin) return null;
 const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
 url.searchParams.set('query',query+' 주차장');
 url.searchParams.set('x',String(origin.lng));
 url.searchParams.set('y',String(origin.lat));
 url.searchParams.set('radius','1500');
 url.searchParams.set('size','10');
 const response=await fetch(url,{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(4500)});
 if(!response.ok) return null;
 const body=await response.json();
 const originalName=normalize(query);
 const address=String(p.jibunAddr??p.doroAddr??'');
 const matched=(body.documents??[]).flatMap(d=>{
  const lat=Number(d.y),lng=Number(d.x);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return [];
  const distance=distanceMeters(origin.lat,origin.lng,lat,lng);
  if(distance>750) return [];
  const candidateName=normalize(d.place_name);
  const nameMatch=originalName.length>=3 && candidateName.length>=3 && (candidateName.includes(originalName)||originalName.includes(candidateName));
  const parkingCategory=/주차/.test(String(d.category_name??''))||d.category_group_code==='PK6';
  const addressCheck=number(address);
  const placeAddress=number(d.address_name||d.road_address_name);
  const addressMatch=addressCheck.length>=3 && placeAddress.length>=3 && (addressCheck===placeAddress);
  if(!parkingCategory || !nameMatch || (!addressMatch && distance>120)) return [];
  return [{name:d.place_name,lat,lng,placeUrl:d.place_url,score:(addressMatch?100:0)+(nameMatch?50:0)-distance/100,source:'kakao_verified'}];
 }).sort((a,b)=>b.score-a.score);
 if(!matched.length || (matched.length>1 && matched[0].score-matched[1].score<15))return null;
 const {score,...result}=matched[0];
 return result;
}
