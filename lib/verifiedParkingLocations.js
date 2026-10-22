// Explicit parking-code mapping. Add only after manually verifying the exact place and vehicle entrance.
// Never infer a verified destination from a similarly named or nearby business.
export const verifiedParkingLocations=Object.freeze({
  // Example (do NOT activate without proof):
  // 'A123': {name:'정확한 공영주차장명',lat:35.0,lng:129.0,placeUrl:'https://place.map.kakao.com/123',verifiedAt:'YYYY-MM-DD'}
});
export function mappedParkingPlace(p){
 const code=String(p?.parkgcd??'');
 const entry=verifiedParkingLocations[code];
 if(!entry||!Number.isFinite(entry.lat)||!Number.isFinite(entry.lng)||
    entry.lat<34.5||entry.lat>36||entry.lng<128.5||entry.lng>130||
    !entry.name||!/^https:\/\/place\.map\.kakao\.com\/\d+$/.test(entry.placeUrl??''))return null;
 return {...entry,source:'manual_verified'};
}
