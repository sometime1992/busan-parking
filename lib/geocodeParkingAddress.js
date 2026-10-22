import {point,distanceMeters} from './nearbyParking.js';

// Address geocoding is a fallback for estimated car travel to the public-data address.
// It is NOT verification of a parking-lot entrance.
export async function geocodeParkingAddress(parking,key){
 const origin=point(parking);
 if(!origin)return null;
 const addresses=[parking.jibunAddr,parking.doroAddr].map(v=>String(v??'').trim()).filter(Boolean);
 for(const address of addresses){
  try{
   const url=new URL('https://dapi.kakao.com/v2/local/search/address.json');
   url.searchParams.set('query',address);
   const res=await fetch(url,{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(4500)});
   if(!res.ok)continue;
   const data=await res.json();
   // Require full unambiguous geocoding, rather than a loose keyword result.
   const docs=data.documents??[];
   if(docs.length!==1)continue;
   const d=docs[0],lat=Number(d.y),lng=Number(d.x);
   if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
   const difference=distanceMeters(origin.lat,origin.lng,lat,lng);
   if(difference>1500)continue;
   return {lat,lng,name:String(parking.parknm??''),source:'address_geocoded',distanceFromSourceMeters:Math.round(difference)};
  }catch{/* attempt next source address */}
 }
 return null;
}
