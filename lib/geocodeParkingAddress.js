import {point,distanceMeters} from './nearbyParking.js';

// Address geocoding is a fallback for estimated car travel to the public-data address.
// It is NOT verification of a parking-lot entrance.
function addressParts(value){
 const text=String(value??'').trim();
 return {
  district:text.match(/([가-힣]+구|기장군)/)?.[1]??'',
  neighborhood:text.match(/([가-힣0-9]+(?:동|읍|면|리))/g)?.at(-1)??'',
  lot:text.match(/(\d+(?:-\d+)?)\s*$/)?.[1]??''
 };
}
function exactGeocodeAddress(a,b){
 const source=String(a??'').normalize('NFKC').trim();
 const target=String(b??'').normalize('NFKC').trim();
 if(!source||!target)return false;
 const canonical=v=>v.replace(/^부산(?:광역시)?\s*/,'').replace(/[\s,().·]/g,'').toLowerCase();
 if(/\d+(?:-\d+)?\s*$/.test(source)&&canonical(source)===canonical(target))return true;
 const x=addressParts(source),y=addressParts(target);
 return !!(x.district&&x.district===y.district&&
  x.neighborhood&&x.neighborhood===y.neighborhood&&
  x.lot&&x.lot===y.lot);
}
export async function geocodeParkingAddress(parking,key,stats){
 const origin=point(parking);
 const addresses=[parking.jibunAddr,parking.doroAddr].map(v=>String(v??'').trim()).filter(Boolean)
  .sort((a,b)=>Number(/\d+(?:-\d+)?\s*$/.test(b))-Number(/\d+(?:-\d+)?\s*$/.test(a))||b.length-a.length).slice(0,1);
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
   // Without source GPS, require exact full address evidence before routing.
   const matchedAddress=exactGeocodeAddress(address,d.address_name)
     ||exactGeocodeAddress(address,d.address?.address_name)
     ||exactGeocodeAddress(address,d.road_address?.address_name);
   const difference=origin?distanceMeters(origin.lat,origin.lng,lat,lng):null;
   // A loose district-level geocoder hit is not a reliable vehicle destination.
   // Exact road/parcel address is preferred; without it, require very close
   // agreement with a known public-data point.
   if(!matchedAddress&&(difference===null||difference>150)){
    if(stats)stats.geocodeNoExactAddress=(stats.geocodeNoExactAddress??0)+1;
    continue;
   }
   if(difference!==null&&difference>8000){
    if(stats)stats.geocodeFarFromSource=(stats.geocodeFarFromSource??0)+1;
    continue;
   }
   if(stats)stats.geocodeMatched=(stats.geocodeMatched??0)+1;
   return {lat,lng,name:String(parking.parknm??''),source:'address_geocoded',distanceFromSourceMeters:difference===null?null:Math.round(difference)};
  }catch(e){if(stats){const k=e?.name==='TimeoutError'?'geocodeTimeout':'geocodeNetworkFailure';stats[k]=(stats[k]??0)+1;}}
 }
 return null;
}
