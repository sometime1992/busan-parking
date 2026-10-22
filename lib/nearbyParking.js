// WGS84 only: reject projected / missing coordinates rather than pretending accuracy.
export function point(p) {
 const x=Number(p.xCdnt), y=Number(p.yCdnt);
 if(!p.xCdnt || !p.yCdnt) return null;
 if(x>=128.5&&x<=130&&y>=34.5&&y<=36) return {lat:y,lng:x};
 if(y>=128.5&&y<=130&&x>=34.5&&x<=36) return {lat:x,lng:y};
 return null;
}
export function distanceMeters(lat1,lng1,lat2,lng2) {
 const rad=Math.PI/180, dLat=(lat2-lat1)*rad, dLon=(lng2-lng1)*rad;
 const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
 return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
export function nearby(list,lat,lng,{limit=5,onlyAvailable=true,radius=10000}={}) {
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<33||lat>39.5||lng<124||lng>132) throw new Error('대한민국 범위의 GPS 좌표가 필요합니다.');
 return list.flatMap(p=>{
  const coordinates=point(p);
  if(!coordinates || (onlyAvailable && !(Number.isFinite(p.curravacnt)&&p.curravacnt>0)))return [];
  const distance=Math.round(distanceMeters(lat,lng,coordinates.lat,coordinates.lng));
  return distance<=radius?[{...p,distanceMeters:distance}]:[];
 }).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,Math.min(20,Math.max(1,limit)));
}
