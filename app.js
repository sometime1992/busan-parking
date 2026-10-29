// 화면 담당: 공공데이터 API 대신 우리 통합 API만 호출합니다.
const $ = id => document.getElementById(id);
const loadButton = $('load-button');
const statusText = $('status');
const parkingList = $('parking-list');
let data = null;
let fullLoadedAt = 0;
let loading = false;
let timer = null;
let activeFilter = 'all';
let aiCodes = null;
let aiRank = new Map();
let aiDistances = new Map();
let aiStraightBasis = new Map();
let aiDistanceResults = new Map();
let aiDriving = new Map();
let aiVerifiedPlaces = new Map();
let ordinaryDistanceMode = false;
let ordinaryDistanceCodes = new Set();
let ordinaryRequestedCodes = new Set();
let ordinaryDistanceResults = new Map();
let ordinaryStraightBasis = new Map();
let ordinaryDistances = new Map();
let ordinaryDriving = new Map();
let ordinaryVerifiedPlaces = new Map();
let ordinaryDistanceRequest = 0;
const openDetails = new Set();
const mobileRefresh = $('mobile-refresh');
const mobileRefreshLabel = $('mobile-refresh-label');
const known = p => Number.isFinite(p.curravacnt) && p.curravacnt >= 0;
function resetStats() {
  for (const id of ['stat-total', 'stat-available', 'stat-full', 'stat-unknown', 'filter-count-all', 'filter-count-available', 'filter-count-full', 'filter-count-unknown']) $(id).textContent = '—';
  $('result-count').textContent = '';
}
function resetFilters() {
  clearOrdinaryDistances();
  clearAiMode();
  $('search').value = '';
  activeFilter = 'all';
  updateFilterButtons();
  render();
}
function updateFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.filter === activeFilter));
  });
}
const normalize = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/공영주차장|공영|도시철도/g, '').replace(/[\s(),，（）]/g, '');
const value = text => text === null || text === undefined || text === '' ? '정보 없음' : String(text);
const number = n => n === null || n === undefined ? '확인 불가' : `${Number(n).toLocaleString('ko-KR')}대`;
function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function row(dl, title, text) {
  const div = element('div');
  div.append(element('dt', title), element('dd', value(text)));
  dl.append(div);
}
function time(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? ''));
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  return h <= 24 && m < 60 && (h !== 24 || m === 0) ? `${String(h).padStart(2,'0')}:${match[2]}` : null;
}
function hours(start, end) {
  const s = time(start), e = time(end);
  if (!s || !e) return start || end ? '제공값 확인 필요' : '정보 없음';
  if (s === e) return `${s} ~ ${e} (운영 여부 확인 필요)`;
  return `${s} ~ ${e}`;
}
function fee(minutes, won) {
  if (minutes === null || won === null || minutes === undefined || won === undefined) return '정보 없음';
  const m = Number(minutes), w = Number(won);
  return Number.isFinite(m) && m > 0 && Number.isFinite(w) && w >= 0 ? `${m}분 ${w.toLocaleString('ko-KR')}원` : '제공값 확인 필요';
}
function date(text) {
  // 제공기관의 시각은 변환하지 않고 그대로 표시합니다.
  return value(text);
}
function routeErrorMessage(stats){
 if(!stats||typeof stats!=='object')return '';
 const total=key=>Object.entries(stats).filter(([k])=>k.endsWith(key)).reduce((sum,[,v])=>sum+(Number(v)||0),0);
 if(stats.directionsHttp401||stats.directionsHttp403)
   return '카카오모빌리티 자동차 길찾기 API가 401/403을 반환했습니다. 길찾기 API 이용 권한과 Cloudflare의 KAKAO_REST_API_KEY를 확인해 주세요. 장소 좌표만 수정해도 이 오류는 해결되지 않습니다.';
 if(stats.localHttp401||stats.localHttp403||stats.geocodeHttp401||stats.geocodeHttp403)
   return '카카오 로컬 장소·주소 검색 API가 401/403을 반환했습니다. 카카오 앱의 로컬 API 호출 권한과 Cloudflare 키 설정을 확인해 주세요.';
 if(total('Http429'))return '카카오 API 요청 제한(429)이 감지되었습니다. 요청량·쿼터를 확인해 주세요.';
 const routeCodes=Object.keys(stats).filter(k=>k.startsWith('directionsResult')&&stats[k]>0);
 if(routeCodes.length)return '카카오 자동차 길찾기에서 경로를 찾지 못한 요청이 있습니다('+routeCodes.join(', ')+'). 목적지 좌표를 확인해 주세요.';
 if(stats.routeTimeout||stats.localTimeout||stats.geocodeTimeout)return '외부 지도 API 응답 시간이 초과되었습니다. 네트워크 상태 또는 API 호출 지연을 확인해 주세요.';
 if(stats.localUnmatched||stats.geocodeNoUnique||stats.geocodeFarFromSource)return '일부 공영주차장의 카카오 등록 장소나 주소 좌표를 확인하지 못했습니다. 실제 출입구 좌표가 필요할 수 있습니다.';
 return '';
}
function render() {
  $('clear-search').hidden = !$('search').value;
  if (!data) return;
  const all = data.parkingList;
  $('stat-total').textContent = all.length;
  $('stat-available').textContent = all.filter(p => known(p) && p.curravacnt > 0).length;
  $('stat-full').textContent = all.filter(p => known(p) && p.curravacnt === 0).length;
  $('stat-unknown').textContent = all.filter(p => !known(p)).length;
  $('filter-count-all').textContent = all.length;
  $('filter-count-available').textContent = $('stat-available').textContent;
  $('filter-count-full').textContent = $('stat-full').textContent;
  $('filter-count-unknown').textContent = $('stat-unknown').textContent;
  const query = normalize($('search').value);
  const items = all.filter(p => {
    if (aiCodes && !aiCodes.has(String(p.parkgcd))) return false;
    const match = normalize(p.parknm).includes(query) || normalize(p.pkNam).includes(query);
    const state = !known(p) ? 'unknown' : p.curravacnt === 0 ? 'full' : 'available';
    return match && (activeFilter === 'all' || activeFilter === state);
  });
  items.sort((a, b) => {
    if (aiCodes) return (aiRank.get(String(a.parkgcd))??999) - (aiRank.get(String(b.parkgcd))??999);
    if ($('sort').value === 'available') {
      const diff = (known(b) ? b.curravacnt : -1) - (known(a) ? a.curravacnt : -1);
      if (diff) return diff;
    }
    return String(a.parknm ?? '').localeCompare(String(b.parknm ?? ''), 'ko');
  });
  const fragment = document.createDocumentFragment();
  for (const p of items) {
    const unknown = !known(p);
    const state = unknown ? 'unknown' : p.curravacnt === 0 ? 'full' : '';
    const card = element('li', undefined, 'card');
    const top = element('div', undefined, 'card-top');
    top.append(element('span', 'P', 'parking-symbol'));
    top.append(element('h3', value(p.parknm)), element('span', unknown ? '확인 불가' : p.curravacnt === 0 ? '만차' : '주차 가능', `badge ${state}`));
    card.append(top);
    if(aiCodes?.has(String(p.parkgcd)) || (ordinaryDistanceMode && ordinaryDistanceCodes.has(String(p.parkgcd)))) {
      const useAi=Boolean(aiCodes?.has(String(p.parkgcd)));
      const driving=(useAi?aiDriving:ordinaryDriving).get(String(p.parkgcd));
      const code=String(p.parkgcd);
      const straight=(useAi?aiDistances:ordinaryDistances).get(code);
      const basis=(useAi?aiStraightBasis:ordinaryStraightBasis).get(code);
      const routeResult=(useAi?aiDistanceResults:ordinaryDistanceResults).get(code);
      const unrequested=!useAi&&!ordinaryRequestedCodes.has(code);
      const distanceBox=element('div',undefined,'ai-distance-grid');
      const car=element('div',undefined,'ai-distance-cell');
      car.append(element('span','자동차 주행거리','ai-distance-label'));
      if(driving) {
        const distance=driving.drivingMeters<1000?driving.drivingMeters+'m':(driving.drivingMeters/1000).toFixed(1)+'km';
        car.append(element('strong',distance));
        const note=driving.routeBasis==='public'?' · 대표 좌표 기준 · 참고용':
          driving.routeBasis==='address'?' · 주소 기준 · 참고용':' · 카카오 장소 기준';
        car.append(element('small','예상 약 '+Math.max(1,Math.ceil(driving.drivingSeconds/60))+'분'+note));
      } else {
        car.append(element('strong',unrequested?'미조회':'확인 불가'));
        car.append(element('small',unrequested?'첫 10곳 외 자동차 경로 미조회':
          routeResult?.routeStatus==='route_failed'?'자동차 경로 탐색 실패':
          '차량 목적지 확인 필요'));
      }
      const line=element('div',undefined,'ai-distance-cell');
      line.append(element('span','직선거리','ai-distance-label'));
      if(Number.isFinite(straight)){
        line.append(element('strong',straight<1000?straight+'m':(straight/1000).toFixed(1)+'km'));
        line.append(element('small',basis==='verified_location'?'검증된 장소 좌표 기준':'공공데이터 좌표 기준'));
      } else {
        line.append(element('strong','확인 불가'));
        line.append(element('small','목적지 좌표 확인 필요'));
      }
      distanceBox.append(car,line);
      card.append(distanceBox);
    }
    const address = element('p', value(p.doroAddr ?? p.jibunAddr), 'address-preview');
    address.append(element('small', '주소 · 공공데이터 기준'));
    card.append(address);
    const count = element('p', undefined, `space-count ${state}`);
    count.append(element('span', '주차 가능한 빈자리'), element('strong', unknown ? '확인 불가' : String(p.curravacnt)));
    if (!unknown) count.append(element('small', '대'));
    card.append(count);
    if (!unknown && Number.isFinite(p.maxcnt) && p.maxcnt > 0 && p.curravacnt <= p.maxcnt) {
      const meter = element('div', undefined, 'meter');
      meter.setAttribute('aria-hidden', 'true');
      const fill = element('span');
      fill.style.width = `${p.curravacnt / p.maxcnt * 100}%`;
      meter.append(fill);
      card.append(meter);
    }
    card.append(element('p', `현재 주차 ${number(p.parkingcnt)} / 전체 ${number(p.maxcnt)}`, 'capacity'));
    card.append(element('p', `제공기관 갱신 · ${date(p.lastupdatetime)}`, 'card-update'));
    // 좌표가 있으면 카카오맵의 '이름,위도,경도' 링크로 주차장명을 명시합니다.
    // 검색만으로는 카카오맵이 주차장명 대신 유사 주소를 선택할 수 있습니다.
    const longitude = Number(p.xCdnt), latitude = Number(p.yCdnt);
    const validPoint = p.xCdnt != null && p.yCdnt != null
      && Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= 34.5 && latitude <= 36 && longitude >= 128.5 && longitude <= 130;
    const label = String(p.parknm ?? '').trim();
    const link = element('a', validPoint ? '카카오맵에서 주차장 위치 확인 ↗' : '카카오맵에서 주차장명 검색 ↗', 'map-link');
    const verifiedPlace=(aiCodes?aiVerifiedPlaces:ordinaryVerifiedPlaces).get(String(p.parkgcd));
    const trustedPlaceUrl = typeof verifiedPlace?.placeUrl === 'string' &&
      /^https?:\/\/place\.map\.kakao\.com\/\d+$/.test(verifiedPlace.placeUrl);
    const candidatePlaceUrl=typeof p.ownerCandidatePlaceUrl==='string' &&
      /^https:\/\/place\.map\.kakao\.com\/\d+$/.test(p.ownerCandidatePlaceUrl)
      ?p.ownerCandidatePlaceUrl:null;
    link.href = trustedPlaceUrl ? verifiedPlace.placeUrl : candidatePlaceUrl
      || `https://map.kakao.com/link/search/${encodeURIComponent('부산 '+label+' 공영주차장')}`;
    link.textContent=trustedPlaceUrl?'카카오에서 확인된 주차장 보기 ↗'
      :candidatePlaceUrl?'등록된 카카오 장소 후보 보기 ↗':'카카오맵에서 공영주차장 검색 ↗';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${p.parknm} 카카오맵에서 ${trustedPlaceUrl ? '확인된 장소 보기' : candidatePlaceUrl ? '장소 후보 보기' : '이름 검색'} (새 창)`);
    card.append(link);
    if (!trustedPlaceUrl) card.append(element('p',candidatePlaceUrl
      ?'사용자가 제공한 카카오 장소 후보입니다. API로 동일 시설 여부를 확인하기 전까지 정확한 목적지로 간주하지 않습니다.'
      :'카카오 등록 장소와 일치 여부가 검증되지 않았습니다. 지도 검색 결과를 직접 확인해 주세요.','map-location-note'));
    const details = element('details', undefined, 'card-details');
    const key = String(p.parkgcd ?? p.parknm);
    details.open = openDetails.has(key);
    details.addEventListener('toggle', () => {
      if (details.isConnected) {
        if (details.open) openDetails.add(key); else openDetails.delete(key);
      }
    });
    details.append(element('summary', '요금·운영시간·상세정보'));
    const dl = element('dl');
    row(dl, '주소(공공데이터 기준)', p.doroAddr ?? p.jibunAddr);
    row(dl, '기본요금', fee(p.pkBascTime, p.tenMin));
    row(dl, '추가요금', fee(p.pkAddTime, p.feeAdd));
    row(dl, '평일 운영', hours(p.svcSrtTe, p.svcEndTe));
    row(dl, '토요일 운영', hours(p.satSrtTe, p.satEndTe));
    row(dl, '공휴일 운영', hours(p.hldSrtTe, p.hldEndTe));
    row(dl, '관리기관', p.guNm);
    row(dl, '기본정보 기준일', p.fnlDt);
    row(dl, '시설공단 코드', p.parkgcd);
    details.append(dl);
    details.append(element('p', p.basicMatched ? `기본정보 연결: ${p.matchMethod === 'alias' ? '별칭' : '정규화 이름'} · ${value(p.pkNam)}` : p.matchStatus === 'ambiguous' ? '기본정보: 중복 후보가 있어 확인 필요' : '기본정보: 연결된 자료 없음', 'meta'));
    if (p.dataIssues?.length) details.append(element('p', p.dataIssues.join(' '), 'warning'));
    details.append(element('p', '주소는 공공데이터 기준이며 실제 위치와 다를 수 있습니다. 지도보기에서 위치를 확인하세요.', 'meta'));
    card.append(details);
    fragment.append(card);
  }
  if (!items.length) {
    const empty = element('li', undefined, 'card empty-state');
    empty.append(element('h3', '조건에 맞는 주차장이 없어요'), element('p', '검색어를 바꾸거나 전체 목록을 확인해 보세요.'));
    const reset = element('button', '전체 목록 보기');
    reset.type = 'button';
    reset.addEventListener('click', resetFilters);
    empty.append(reset);
    fragment.append(empty);
  }
  parkingList.replaceChildren(fragment);
  $('result-count').textContent = `${items.length}곳`;
  $('ai-list-mode').hidden = !aiCodes;
  if (aiCodes) $('ai-list-count').textContent = `${items.length}곳`; 
  if (!statusText.classList.contains('error')) statusText.textContent = `${all.length}곳 중 ${items.length}곳 표시 · 빈자리 수는 도착 시 달라질 수 있습니다.`;
}
// 주차장 코드로 빈자리만 갱신하고 주소·요금·운영시간은 유지합니다.
function applyRealtimeSnapshot(next) {
  if (!data || !Array.isArray(next.realtimeList) || next.sources?.realtime?.status !== 'ok') {
    throw new Error('빈자리 응답 형식을 확인해 주세요.');
  }
  const updates = new Map(next.realtimeList.map(item => [String(item.parkgcd), item]));
  data = {
    ...data,
    sources: { ...data.sources, realtime: next.sources.realtime },
    warnings: (data.warnings ?? []).filter(message => !message.startsWith('실시간 현황')),
    parkingList: data.parkingList.map(parking => {
      const update = updates.get(String(parking.parkgcd));
      return { ...parking,
        maxcnt: update?.maxcnt ?? null, parkingcnt: update?.parkingcnt ?? null,
        curravacnt: update?.curravacnt ?? null, lastupdatetime: update?.lastupdatetime ?? null,
        realtimeMatched: update?.realtimeMatched ?? false, dataIssues: update?.dataIssues ?? []
      };
    })
  };
}
async function loadParkingList() {
  if (!navigator.onLine) { showOffline(); return; }
  if (loading) return;
  loading = true;
  loadButton.disabled = true;
  mobileRefresh.disabled = true;
  loadButton.textContent = '조회 중…';
  mobileRefreshLabel.textContent = '조회 중…';
  parkingList.setAttribute('aria-busy','true');
  statusText.className = '';
  const lightweight = data !== null && Date.now() - fullLoadedAt < 6 * 60 * 60 * 1000;
  statusText.textContent = lightweight ? '빈자리만 빠르게 갱신하고 있습니다.' : '주차장 정보를 불러오는 중입니다.';
  try {
    const response = await fetch(lightweight ? '/api/parking?mode=realtime' : '/api/parking', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const next = await response.json();
    if (!response.ok) throw new Error(next.message || '정보를 불러오지 못했습니다.');
    if (!lightweight && !Array.isArray(next.parkingList)) throw new Error('응답 형식을 확인해 주세요.');
    if (!navigator.onLine) { showOffline(); return; }
    if (lightweight) {
      // 오프라인 이벤트로 결과가 지워졌다면 다음 조회는 전체 정보를 받습니다.
      if (!data) return;
      applyRealtimeSnapshot(next);
    } else {
      data = next;
      fullLoadedAt = Date.now();
    }
    $('warnings').textContent = (data.warnings ?? []).join(' ');
    $('connection-status').hidden = true;
    const fetched = data.sources?.realtime?.fetchedAt;
    const fetchedDate = fetched ? new Date(fetched) : null;
    $('last-checked').textContent = fetchedDate && !Number.isNaN(fetchedDate.getTime())
      ? `마지막 조회 ${fetchedDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 한국시간${data.sources?.realtime?.cached ? ' · 1분 이내 조회 결과' : ''}`
      : '실시간 조회 실패 · 각 주차장의 제공기관 갱신시간을 확인하세요.';
    $('summary').textContent = `기본정보 연결 ${data.matchedCount}곳 / 미연결 ${data.unmatchedCount}곳 · 마지막 조회 ${fetched ? new Date(fetched).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '실시간 조회 실패'} (한국시간)`;
    render();
  } catch (error) {
    if (!navigator.onLine) { showOffline(); return; }
    statusText.className = 'error';
    statusText.textContent = error.name === 'TimeoutError' ? '응답이 지연됩니다. 잠시 후 다시 시도해 주세요.' : error.message;
    if (data) statusText.textContent += ' 이전 결과를 유지합니다. 갱신시간을 확인해 주세요.';
  } finally {
    loading = false;
    loadButton.disabled = false;
    mobileRefresh.disabled = false;
    loadButton.textContent = '↻ 새로고침';
    mobileRefreshLabel.textContent = '새로고침';
    parkingList.setAttribute('aria-busy','false');
  }
}
function clearOrdinaryDistances(){
 ordinaryDistanceRequest++;
 ordinaryDistanceMode=false;
 ordinaryDistanceCodes=new Set();
 ordinaryRequestedCodes=new Set();
 ordinaryDistanceResults=new Map();
 ordinaryStraightBasis=new Map();
 ordinaryDistances=new Map();
 ordinaryDriving=new Map();
 ordinaryVerifiedPlaces=new Map();
 $('search-distance-status').textContent='';
}
function publicDataPoint(p){
 if(p.xCdnt===null||p.xCdnt===undefined||p.yCdnt===null||p.yCdnt===undefined)return null;
 const x=Number(p.xCdnt),y=Number(p.yCdnt);
 if(x>=128.5&&x<=130&&y>=34.5&&y<=36)return {lat:y,lng:x};
 if(y>=128.5&&y<=130&&x>=34.5&&x<=36)return {lat:x,lng:y};
 return null;
}
function straightMeters(a,b){
 const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLng=(b.lng-a.lng)*r;
 const q=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLng/2)**2;
 return Math.round(6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q)));
}
$('search-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const enabled=$('ai-use-location').checked;
 clearOrdinaryDistances();
 if(aiCodes)clearAiMode();
 render();
 if(!enabled){$('search-distance-status').textContent='거리 표시를 사용하려면 위 AI 검색 영역의 ‘현재 위치 사용’을 체크한 뒤 검색해 주세요.';return;}
 const id=ordinaryDistanceRequest,status=$('search-distance-status');
 if(!data?.parkingList?.length){status.textContent='주차장 목록을 불러온 후 다시 검색해 주세요.';return;}
 const query=normalize($('search').value);
 const selected=data.parkingList.filter(p=>{
   const match=normalize(p.parknm).includes(query)||normalize(p.pkNam).includes(query);
   const state=!known(p)?'unknown':p.curravacnt===0?'full':'available';
   return match&&(activeFilter==='all'||activeFilter===state);
 });
 selected.sort((a,b)=>$('sort').value==='available'
   ?((known(b)?b.curravacnt:-1)-(known(a)?a.curravacnt:-1)||String(a.parknm).localeCompare(String(b.parknm),'ko'))
   :String(a.parknm).localeCompare(String(b.parknm),'ko'));
 if(!selected.length){status.textContent='검색 조건에 맞는 주차장이 없습니다.';return;}
 try{
   status.textContent='현재 GPS 위치를 확인하고 있습니다.';
   if(!navigator.geolocation)throw Error('이 브라우저는 위치 기능을 지원하지 않습니다.');
   const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:30000}));
   if(id!==ordinaryDistanceRequest)return;
   const location={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
   if(!Number.isFinite(location.latitude)||!Number.isFinite(location.longitude))throw Error('위치 좌표를 확인하지 못했습니다.');
   const pointDistance=p=>{
     const pt=publicDataPoint(p);
     return pt?straightMeters({lat:location.latitude,lng:location.longitude},pt):Infinity;
   };
   const requested=selected.slice().sort((a,b)=>pointDistance(a)-pointDistance(b))
     .slice(0,10);
   ordinaryRequestedCodes=new Set(requested.map(p=>String(p.parkgcd)));
   ordinaryDistanceCodes=new Set(selected.map(p=>String(p.parkgcd)));
   ordinaryDistances=new Map(selected.flatMap(p=>{
     const coords=publicDataPoint(p);
     return coords?[[String(p.parkgcd),straightMeters({lat:location.latitude,lng:location.longitude},coords)]]:[];
   }));
   ordinaryStraightBasis=new Map([...ordinaryDistances.keys()].map(code=>[code,'public']));
   ordinaryDistanceMode=true;
   render();
   status.textContent='직선거리 '+ordinaryDistances.size+'곳 확인 · 자동차 주행거리를 조회하고 있습니다. (자동차 경로는 최대 10곳)';
   let result;
   try{
     const response=await fetch('/api/distances',{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({location,parkingCodes:requested.map(p=>String(p.parkgcd))}),
       cache:'no-store',signal:AbortSignal.timeout(55000)
     });
     result=await response.json();
     if(!response.ok)throw Error(result.message||'자동차 경로 조회에 실패했습니다.');
   }catch(error){
     if(id!==ordinaryDistanceRequest)return;
     status.textContent='직선거리 '+ordinaryDistances.size+'곳 표시 중 · 자동차 경로 '+(error.name==='TimeoutError'?'시간 초과':error.message);
     return;
   }
   if(id!==ordinaryDistanceRequest)return;
   const results=Array.isArray(result.parkingResults)?result.parkingResults:[];
   ordinaryDriving=new Map(results.filter(p=>ordinaryDistanceCodes.has(String(p.code))&&Number.isFinite(p.drivingMeters)&&Number.isFinite(p.drivingSeconds)).map(p=>[String(p.code),p]));
   ordinaryDistanceResults=new Map(results.map(p=>[String(p.code),p]));
   for(const p of results)if(ordinaryDistanceCodes.has(String(p.code))&&Number.isFinite(p.distanceMeters)){
     ordinaryDistances.set(String(p.code),p.distanceMeters);
     ordinaryStraightBasis.set(String(p.code),p.straightBasis||'public');
   }
   ordinaryVerifiedPlaces=new Map(results.filter(p=>ordinaryDistanceCodes.has(String(p.code))&&p.verifiedPlace).map(p=>[String(p.code),p.verifiedPlace]));
   status.textContent='자동차 주행거리 '+ordinaryDriving.size+'곳 · 직선거리 '+ordinaryDistances.size+'곳 표시 중';
   const references=[...ordinaryDriving.values()].filter(p=>p.routeBasis==='public').length;
   if(references)status.textContent+=' · 대표 좌표 기준 참고용 '+references+'곳';
   const failure=routeErrorMessage(result.routeDiagnostics);
   if(failure)status.textContent+=' · '+failure;
   render();
 }catch(error){
   if(id!==ordinaryDistanceRequest)return;
   status.textContent=error.code===1?'위치 권한이 거부되었습니다. 브라우저 위치 접근을 허용해 주세요.':error.name==='TimeoutError'||error.code===3?'GPS 위치 조회 시간이 초과되었습니다.':error.message;
 }
});
$('ai-use-location').addEventListener('change',()=>{clearOrdinaryDistances();render();});
$('search-distance-action').addEventListener('click',()=>{
  $('ai-use-location').checked=true;
  $('search-form').requestSubmit();
});
$('search').addEventListener('input', () => { clearOrdinaryDistances(); clearAiMode(); render(); });
$('sort').addEventListener('change', () => { clearOrdinaryDistances(); clearAiMode(); render(); });
loadButton.addEventListener('click', loadParkingList);
mobileRefresh.addEventListener('click', loadParkingList);
$('clear-search').addEventListener('click', () => {
  $('search').value = '';
  clearOrdinaryDistances();
  clearAiMode();
  render();
  $('search').focus();
});
document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => {
    clearOrdinaryDistances();
    clearAiMode();
    activeFilter = button.dataset.filter;
    updateFilterButtons();
    render();
  });
});
$('auto-refresh').addEventListener('change', () => {
  clearInterval(timer);
  timer = $('auto-refresh').checked ? setInterval(() => { if (!document.hidden) loadParkingList(); }, 300000) : null;
});
loadParkingList();

// 오프라인에서는 이전 빈자리를 현재 정보로 표시하지 않습니다.
function showOffline() {
  data = null;
  clearAiMode();
  parkingList.replaceChildren();
  resetStats();
  $('last-checked').textContent = '오프라인 · 실시간 조회 불가';
  $('warnings').textContent = '';
  $('summary').textContent = '';
  statusText.className = 'error';
  statusText.textContent = '인터넷 연결 후 새로고침해 주세요.';
  const notice = $('connection-status');
  notice.hidden = false;
  notice.textContent = '오프라인 상태입니다. 실시간 주차 정보를 확인할 수 없습니다.';
}
window.addEventListener('offline', showOffline);
window.addEventListener('online', () => {
  $('connection-status').hidden = true;
  loadParkingList();
});

// 설치 요청은 사용자가 버튼을 눌렀을 때만 표시합니다.
const installButton = $('install-button');
const installHelp = $('install-help');
const qrDialog = $('qr-install-dialog');
const qrInstallButton = $('qr-install-button');
const qrInstallStatus = $('qr-install-status');
const qrInstallVisit = new URLSearchParams(window.location.search).get('install') === '1';
let installPrompt = null;
const standalone = window.matchMedia('(display-mode: standalone)');
function updateInstallState() {
  const installed = standalone.matches || navigator.standalone === true;
  installButton.hidden = installed || !installPrompt;
  $('install-panel').hidden = installed;
  document.querySelector('.header-link').hidden = installed;
  qrInstallButton.hidden = installed || !installPrompt;
  if (installed && qrDialog.open) closeInstallDialog();
  if (installPrompt) qrInstallStatus.textContent = '설치하기 버튼을 눌러 브라우저 설치 창을 여세요.';
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  updateInstallState();
});
async function requestInstall() {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installButton.hidden = true;
  qrInstallButton.hidden = true;
  try {
    await prompt.prompt();
    const result = await prompt.userChoice;
    installHelp.textContent = result.outcome === 'accepted'
      ? '설치 요청을 완료했습니다. 기기의 설치 진행 상황을 확인하세요.'
      : '나중에 브라우저 메뉴에서 설치 또는 홈 화면 추가를 선택할 수 있습니다.';
    qrInstallStatus.textContent = installHelp.textContent;
  } catch {
    installHelp.textContent = '브라우저 메뉴에서 설치 또는 홈 화면 추가를 선택하세요.';
    qrInstallStatus.textContent = installHelp.textContent;
  }
}
installButton.addEventListener('click', requestInstall);
qrInstallButton.addEventListener('click', requestInstall);
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installButton.hidden = true;
  installHelp.textContent = '설치되었습니다. 홈 화면 아이콘으로 실행할 수 있습니다.';
  qrInstallStatus.textContent = installHelp.textContent;
  if (qrDialog.open) closeInstallDialog();
  updateInstallState();
});
standalone.addEventListener('change', updateInstallState);
updateInstallState();

// 새 버전 활성화 시 한 번만 새로고침합니다.
if ('serviceWorker' in navigator) {
  let refreshing = false;
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
    .then(registration => {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && navigator.onLine) registration.update().catch(() => {});
      });
    })
    .catch(() => {
      installHelp.textContent += ' 오프라인 실행 준비에 실패했습니다. 인터넷 연결 후 새로고침해 주세요.';
    });
}

// 고정 헤더의 현재 위치 대신 문서의 맨 위로 직접 이동합니다.
document.querySelectorAll('a[href="#top"]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  });
});

// QR 전용 접속에서는 자체 설치 안내를 먼저 엽니다.
function removeInstallQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete('install');
  window.history.replaceState(null, '', url.href);
}
function closeInstallDialog() {
  qrDialog.close();
  removeInstallQuery();
}
$('qr-install-later').addEventListener('click', closeInstallDialog);
qrDialog.addEventListener('cancel', removeInstallQuery);
if (qrInstallVisit && !standalone.matches && navigator.standalone !== true) {
  qrDialog.showModal();
} else if (qrInstallVisit) {
  removeInstallQuery();
}

// 검색 예시와 PC 보기 방식 전환.
document.querySelectorAll('[data-search]').forEach(button => {
  button.addEventListener('click', () => {
    $('search').value = button.dataset.search;
    clearOrdinaryDistances();
    clearAiMode();
    render();
    $('search').focus();
    if($('ai-use-location').checked)$('search-form').requestSubmit();
  });
});
function setView(mode) {
  parkingList.dataset.view = mode;
  $('view-grid').setAttribute('aria-pressed', String(mode === 'grid'));
  $('view-list').setAttribute('aria-pressed', String(mode === 'list'));
}
$('view-grid').addEventListener('click', () => setView('grid'));
$('view-list').addEventListener('click', () => setView('list'));

// 모바일은 QR 안내를 접어두고, PC에서는 바로 볼 수 있게 합니다.
const qrLayout = window.matchMedia('(min-width: 601px)');
function updateQRLayout() {
  $('install-qr-details').open = qrLayout.matches;
}
qrLayout.addEventListener('change', updateQRLayout);
updateQRLayout();


function clearAiMode() {
  ordinaryDistanceRequest++;
  ordinaryDistanceMode=false;
  ordinaryDistanceCodes=new Set();
  ordinaryDistances=new Map();
  ordinaryDriving=new Map();
  ordinaryVerifiedPlaces=new Map();
  $('search-distance-status').textContent='';
  aiCodes = null;
  aiRank = new Map();
  aiDistances = new Map();
  aiDriving = new Map();
  aiVerifiedPlaces = new Map();
  $('ai-list-mode').hidden = true;
}
function activateAiResults(codes) {
  const unique = [...new Set(codes.map(String).filter(Boolean))].slice(0,20);
  aiCodes = new Set(unique);
  aiRank = new Map(unique.map((code,index)=>[code,index]));
  $('search').value = '';
  activeFilter = 'all';
  updateFilterButtons();
  render();
}
$('ai-reset-list').addEventListener('click', () => { resetFilters(); $('results-title').scrollIntoView({behavior:'smooth',block:'start'}); });

// SpeechRecognition is browser-dependent. Transcription fills the existing AI input; it does not send a query automatically.
const voiceButton=$('ai-voice');
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let recognizer=null;
if(!SpeechRecognition){
  voiceButton.disabled=true;
  voiceButton.title='이 브라우저에서는 음성인식을 지원하지 않습니다.';
  voiceButton.setAttribute('aria-label','음성인식 미지원 브라우저');
} else {
  recognizer=new SpeechRecognition();
  recognizer.lang='ko-KR';
  recognizer.interimResults=false;
  recognizer.maxAlternatives=1;
  recognizer.continuous=false;
  recognizer.addEventListener('start',()=>{
    voiceButton.setAttribute('aria-pressed','true');
    $('ai-status').textContent='듣고 있습니다. 주차장 질문을 말씀해 주세요.';
  });
  recognizer.addEventListener('result',event=>{
    const transcript=Array.from(event.results).map(result=>result[0]?.transcript??'').join(' ').trim();
    if(transcript){
      $('ai-question').value=transcript.slice(0,300);
      $('ai-status').textContent='음성 입력 완료 · 내용을 확인한 뒤 AI 검색을 눌러주세요.';
      $('ai-question').focus();
    }
  });
  recognizer.addEventListener('error',event=>{
    const messages={'not-allowed':'마이크 권한이 거부되었습니다. 브라우저 권한을 확인해 주세요.','no-speech':'음성을 인식하지 못했습니다. 다시 시도해 주세요.',network:'음성인식 연결에 실패했습니다. 키보드 검색은 계속 사용할 수 있습니다.','audio-capture':'마이크를 사용할 수 없습니다.'};
    $('ai-status').textContent=messages[event.error]||'음성인식을 완료하지 못했습니다. 다시 시도해 주세요.';
  });
  recognizer.addEventListener('end',()=>voiceButton.setAttribute('aria-pressed','false'));
  voiceButton.addEventListener('click',()=>{
    try{
      if(voiceButton.getAttribute('aria-pressed')==='true') recognizer.stop();
      else recognizer.start();
    }catch{ $('ai-status').textContent='음성인식을 다시 시작해 주세요.'; }
  });
}

// 개인 과제용 AI 검색: 브라우저는 Gemini API 키를 전달받지 않습니다.
const aiForm = $('ai-form');
aiForm.addEventListener('submit', async event => {
  event.preventDefault();
  const question = $('ai-question').value.trim();
  const useLocation=$('ai-use-location').checked || /내 위치|현재 위치|내 주변|가까운|근처|주변 주차장/.test(question);
  const submit = $('ai-submit');
  const answer = $('ai-answer');
  const status = $('ai-status');
  if (!question) return;
  submit.disabled = true;
  submit.textContent = '답변 생성 중…';
  answer.hidden = true;
  status.textContent = 'Gemini가 주차장 정보를 확인하고 있습니다.';
  try {
    let location;
    if(useLocation){
      status.textContent='위치 권한을 확인하고 있습니다.';
      if(!navigator.geolocation) throw new Error('이 브라우저는 위치 기능을 지원하지 않습니다.');
      const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:0}));
      location={latitude:position.coords.latitude,longitude:position.coords.longitude};
      $('ai-use-location').checked=true;
      status.textContent='현재 위치 주변 주차장을 검색하고 있습니다.';
    }
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({question,...(location?{location}:{})}),
      cache:'no-store',
      signal:AbortSignal.timeout(45000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'AI 검색에 실패했습니다.');
    const codes = Array.isArray(result.parkingCodes) ? result.parkingCodes.filter(code=>typeof code==='string' && code.length>0) : [];
    const summary = String(result.answer??'').trim();
    const matched = codes.length ? codes.filter(code=>data?.parkingList?.some(p=>String(p.parkgcd)===code)) : [];
    answer.replaceChildren();
    const title = element('h3', matched.length ? '주차장 검색 결과' : 'AI 답변', 'ai-answer-title');
    answer.append(title);
    const brief = summary.split(/\\n|\n/).map(v=>v.trim()).find(Boolean)?.replace(/\*\*/g,'').replace(/^#+\s*/,'') ?? '';
    const text = element('p', matched.length ? (brief && brief.length<=190 ? brief : `질문에 맞는 주차장 ${matched.length}곳을 찾았습니다. 아래에서 상세정보를 확인하세요.`) : summary || '답변을 생성하지 못했습니다.', 'ai-summary');
    answer.append(text);
    if(matched.length) {
      activateAiResults(matched);
      aiDistances=new Map((result.parkingResults??[]).filter(p=>Number.isFinite(p.distanceMeters)).map(p=>[String(p.code),p.distanceMeters]));
      aiStraightBasis=new Map((result.parkingResults??[]).map(p=>[String(p.code),p.straightBasis||'public']));
      aiDistanceResults=new Map((result.parkingResults??[]).map(p=>[String(p.code),p]));
      aiDriving=new Map((result.parkingResults??[]).filter(p=>Number.isFinite(p.drivingMeters)&&Number.isFinite(p.drivingSeconds)).map(p=>[String(p.code),p]));
      aiVerifiedPlaces=new Map((result.parkingResults??[]).filter(p=>p.verifiedPlace).map(p=>[String(p.code),p.verifiedPlace]));
      render();
      const button = element('button', `검색 결과 ${matched.length}곳 보기 ↓`, 'ai-results-button');
      button.type='button';
      button.addEventListener('click',()=> $('results-title').scrollIntoView({behavior:'smooth',block:'start'}));
      answer.append(button);
    } else {
      clearAiMode();
      render();
      if(codes.length && !data) answer.append(element('p','주차장 목록을 아직 불러오지 못했습니다. 인터넷 연결 후 새로고침해 주세요.','ai-meta'));
    }
    answer.append(element('p', result.routeMode==='driving' ? '카카오 자동차 최단거리 경로 기준 · 예상 시간은 교통 상황에 따라 달라지며 실제 주차장 진입로 위치와 차이가 있을 수 있습니다. 빈자리는 도착 시 달라질 수 있습니다.' : 'AI 안내는 제공기관의 조회 자료를 기준으로 하며, 빈자리는 도착 시 달라질 수 있습니다.', 'ai-meta'));
    if(result.notice) answer.append(element('p',result.notice,'ai-meta'));
    const routeFailure=routeErrorMessage(result.routeDiagnostics);
    if(routeFailure)answer.append(element('p',routeFailure,'ai-meta'));
    if(result.routeMode==='driving' && result.routeStats?.unverified>0) answer.append(element('p',`주차장 ${result.routeStats.unverified}곳은 위치 일치 여부를 확인할 수 없어 자동차 경로 계산에서 제외했습니다.`,'ai-meta'));
    if(result.routeMode==='driving' && result.routeStats?.failed>0) answer.append(element('p',`후보 ${result.routeStats.failed}곳은 자동차 경로 조회에 실패해 순위에서 제외했습니다.`,'ai-meta'));
    if(result.partial && matched.length && result.routeMode!=='driving' && result.routeMode!=='unverified') answer.append(element('p','일부 정보만 확인되어 조회 가능한 결과를 표시합니다.','ai-meta'));
    answer.hidden = false;
    status.textContent = '답변 완료' + (result.toolsUsed?.length ? ' · 주차장 데이터 조회 사용' : ' · 주차장 목록 변경 없음');
  } catch (error) {
    status.textContent = error.code===1 ? '위치 권한이 거부되었습니다. 브라우저 위치 접근을 허용해 주세요.' : error.code===3 ? 'GPS 위치 조회 시간이 초과되었습니다.' : error.name === 'TimeoutError' ? '응답 시간이 초과되었습니다.' : error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'AI 검색';
  }
});
