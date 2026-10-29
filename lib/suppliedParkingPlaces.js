// Kakao place links supplied by the site owner on 2026-10-29.
// These are candidate PLACE IDS, not validated destination coordinates.
// The matcher must confirm the SAME ID, category, location/name/address via
// Kakao Local API before promoting to a vehicle-routing destination.
// 'review' links are deliberately not auto-promoted because the name or
// numbered parking-zone association is ambiguous.
export const suppliedParkingPlaces = Object.freeze([
  {
    "siteName": "반여도서관 앞",
    "placeId": "19713792",
    "code": "A13"
  },
  {
    "siteName": "요트경기장 앞 1구역",
    "placeId": "17060014",
    "code": "A41"
  },
  {
    "siteName": "반송1, 3동 공영",
    "placeId": "11521130",
    "code": "A01"
  },
  {
    "siteName": "중동역",
    "placeId": "11528880",
    "code": "A24"
  },
  {
    "siteName": "수변어린이공원",
    "placeId": "20513380",
    "code": "A03"
  },
  {
    "siteName": "주례역주변복개",
    "placeId": "1984223667",
    "code": "A268"
  },
  {
    "siteName": "반여2배수지",
    "placeId": "20516424",
    "code": "A40"
  },
  {
    "siteName": "학장천 복개",
    "placeId": "11528840",
    "code": "A22"
  },
  {
    "siteName": "신선3동",
    "placeId": "19713751",
    "code": "A15"
  },
  {
    "siteName": "부산대남측",
    "placeId": "8327526"
  },
  {
    "siteName": "구서역",
    "placeId": "263942410"
  },
  {
    "siteName": "대우1차아파트앞",
    "placeId": "20563663"
  },
  {
    "siteName": "중앙공원",
    "placeId": "19713851"
  },
  {
    "siteName": "대연고가밑",
    "placeId": "27156240",
    "code": "A48"
  },
  {
    "siteName": "요트경기장 앞 2구역",
    "placeId": "187703135"
  },
  {
    "siteName": "장산역2번",
    "placeId": "25627728"
  },
  {
    "siteName": "해운대광장",
    "placeId": "18080733"
  },
  {
    "siteName": "두산위브 뒤",
    "placeId": "1457423895"
  },
  {
    "siteName": "좌1동",
    "placeId": "26834464"
  },
  {
    "siteName": "미포공영",
    "placeId": "11521129"
  },
  {
    "siteName": "삼락천로",
    "placeId": "21827874"
  },
  {
    "siteName": "부산기계공고후문",
    "placeId": "1683226443",
    "stage": "review"
  },
  {
    "siteName": "부전복개도로1",
    "placeId": "27430006",
    "stage": "review"
  },
  {
    "siteName": "롯데 광복점 뒤(2)",
    "placeId": "1234623815",
    "code": "A37"
  },
  {
    "siteName": "부전복개도로2",
    "placeId": "1230352811"
  },
  {
    "siteName": "영선대로지하",
    "placeId": "1717709048"
  },
  {
    "siteName": "하단역",
    "placeId": "20587277"
  },
  {
    "siteName": "해운대 센텀시티",
    "placeId": "1616660267"
  },
  {
    "siteName": "삼락재첩거리",
    "placeId": "25920691"
  },
  {
    "siteName": "민락수변공원",
    "placeId": "20590061",
    "stage": "review"
  },
  {
    "siteName": "골드테마거리",
    "placeId": "1310527564"
  },
  {
    "siteName": "노포역",
    "placeId": "11528871"
  },
  {
    "siteName": "동대신동",
    "placeId": "20515343"
  },
  {
    "siteName": "수안동주차빌딩",
    "placeId": "24831156"
  },
  {
    "siteName": "동백사거리",
    "placeId": "19713770"
  },
  {
    "siteName": "중동이마트 옆",
    "placeId": "1204171174",
    "stage": "review"
  }
]);

const key=value=>String(value??'').normalize('NFKC').toLowerCase()
  .replace(/부산광역시|^부산(?=[가-힣])/g,'')
  .replace(/공영주차장|공영|주차장|도시철도/g,'')
  .replace(/[\\s(),，（）.·_-]/g,'');

export function suppliedPlaceFor(parking) {
 const code=String(parking?.parkgcd??'');
 const name=key(parking?.parknm);
 if(!code||!name)return null;
 // Only accept a known facility code, or one exact normalized official name.
 // Never fuzzy-match a different parking zone or attach a new parking facility.
 const matches=suppliedParkingPlaces.filter(entry=>entry.stage!=='review'
   &&(entry.code?entry.code===code:key(entry.siteName)===name));
 return matches.length===1?{...matches[0],placeUrl:'https://place.map.kakao.com/'+matches[0].placeId}:null;
}
