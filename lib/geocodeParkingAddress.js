import {point,distanceMeters} from './nearbyParking.js';

// Address geocoding is a fallback for estimated car travel to the public-data address.
// It is NOT verification of a parking-lot entrance.
export async function geocodeParkingAddress(parking,key,stats){
 const origin=point(parking);
 if(!origin)return null;
 const addresses=[parking.jibunAddr,parking.doroAddr].map(v=>String(v??'').trim()).filter(Boolean).slice(0,1);
 for(const address of addresses){
  try{
   const url=new URL('https://dapi.kakao.com/v2/local/search/address.json');
   url.searchParams.set('query',address.includes('부산')?address:'부산광역시 '+address);
   if(stats) stats.geocodeRequests=(stats.geocodeRequests??0)+1;
   const res=await fetch(url,{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(4500)});
   if(!res.ok){if(stats){const k='geocodeHttp'+res.status;stats[k]=(stats[k]??0)+1;}continue;}
   const data=await res.json();
   // Require full unambiguous geocoding, rather than a loose keyword result.
   const docs=data.documents??[];
   if(docs.length!==1){if(stats)stats.geocodeNoUnique=(stats.geocodeNoUnique??0)+1;continue;}
   const d=docs[0],lat=Number(d.y),lng=Number(d.x);
   if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
   const difference=distanceMeters(origin.lat,origin.lng,lat,lng);
   if(difference>3500){if(stats)stats.geocodeFarFromSource=(stats.geocodeFarFromSource??0)+1;continue;}
   if(stats)stats.geocodeMatched=(stats.geocodeMatched??0)+1;
   return {lat,lng,name:String(parking.parknm??''),source:'address_geocoded',distanceFromSourceMeters:Math.round(difference)};
  }catch(e){if(stats){const k=e?.name==='TimeoutError'?'geocodeTimeout':'geocodeNetworkFailure';stats[k]=(stats[k]??0)+1;}}
 }
 return null;
}
