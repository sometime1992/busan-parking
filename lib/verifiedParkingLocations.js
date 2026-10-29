// Explicit parking-code mapping. Add only after manually verifying the exact place and vehicle entrance.
// Never infer a verified destination from a similarly named or nearby business.
// These five coordinates came from earlier successful Kakao Local + Directions
// responses observed for the user's actual parking-code queries (2026-10-29).
// They represent Kakao parking-place pins, NOT guaranteed vehicle entrances.
// The owner supplied the individual venue links for A22; other IDs were
// supplied by the route diagnostics. Do not infer additional coordinates.
export const verifiedParkingLocations=Object.freeze({
  A433: {name:'구남역 공영주차장',lat:35.1963911225571,lng:128.995732056113,placeUrl:'https://place.map.kakao.com/8776789',verifiedAt:'2026-10-29'},
  A35: {name:'도시철도동래역 공영주차장',lat:35.2073046541596,lng:129.078694203959,placeUrl:'https://place.map.kakao.com/491146777',verifiedAt:'2026-10-29'},
  A34: {name:'명륜역공영주차장',lat:35.21360104025045,lng:129.0805797994435,placeUrl:'https://place.map.kakao.com/8363731',verifiedAt:'2026-10-29'},
  A22: {name:'학장천복개공영주차장',lat:35.148484927983844,lng:129.00080429596719,placeUrl:'https://place.map.kakao.com/11528840',verifiedAt:'2026-10-29'},
  A32: {name:'남산역 공영주차장',lat:35.2650569435161,lng:129.092936171527,placeUrl:'https://place.map.kakao.com/10465441',verifiedAt:'2026-10-29'}
});
export function mappedParkingPlace(p){
 const code=String(p?.parkgcd??'');
 const entry=verifiedParkingLocations[code];
 if(!entry||!Number.isFinite(entry.lat)||!Number.isFinite(entry.lng)||
    entry.lat<34.5||entry.lat>36||entry.lng<128.5||entry.lng>130||
    !entry.name||!/^https:\/\/place\.map\.kakao\.com\/\d+$/.test(entry.placeUrl??''))return null;
 return {...entry,source:'manual_verified'};
}
