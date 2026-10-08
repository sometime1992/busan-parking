// 서버 담당: 세 공공데이터 API를 호출하고 통합합니다. 인증키는 환경변수만 사용합니다.
const APIS = {
  list: ['https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2', 'serviceKey', 21600],
  realtime: ['https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2', 'serviceKey', 60],
  basic: ['https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo', 'ServiceKey', 21600]
};
// 첨부 문서의 참고 프로젝트에서 확인한 별칭. 대상 이름이 유일할 때만 연결합니다.
const ALIASES = { A11: '부산기계공고 공영주차장', A21: '화명 공영주차장', A37: '롯데광복점 뒤 2번', A48: '대연고가도로 밑', A434: '만덕2동사 앞' };
const BASIC_FIELDS = ['mgntNum','pkNam','guNm','doroAddr','jibunAddr','tponNum','pkFm','pkCnt','svcSrtTe','svcEndTe','satSrtTe','satEndTe','hldSrtTe','hldEndTe','oprDay','feeInfo','pkBascTime','tenMin','pkAddTime','feeAdd','ftDay','ftMon','xCdnt','yCdnt','fnlDt','spclNote'];
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export function clean(value) {
  const text = String(value ?? '').trim();
  return !text || ['-', 'null', 'undefined'].includes(text.toLowerCase()) ? null : text;
}
export function count(value) {
  const text = clean(value);
  if (text === null) return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/공영주차장|공영|도시철도/g, '').replace(/[\s(),，（）]/g, '');
}
// 같은 이름이 여러 번 나타나면 임의로 첫 번째 항목을 고르지 않습니다.
function group(items, field, normalize = String) {
  const map = new Map();
  for (const item of items) {
    const key = normalize(item[field] ?? '');
    if (key) map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}
export function mergeParkingData(list, realtime, basic) {
  const rtMap = group(realtime, 'parkgcd');
  const basicMap = group(basic, 'pkNam', normalizeName);
  return list.map(parking => {
    const code = String(parking.parkgcd ?? '');
    const rtCandidates = rtMap.get(code) ?? [];
    const rt = rtCandidates.length === 1 ? rtCandidates[0] : null;
    let candidates = basicMap.get(normalizeName(parking.parknm)) ?? [];
    let method = 'exact';
    if (!candidates.length && ALIASES[code]) {
      candidates = basicMap.get(normalizeName(ALIASES[code])) ?? [];
      method = 'alias';
    }
    const b = candidates.length === 1 ? candidates[0] : null;
    const result = {
      parkgcd: code, parknm: clean(parking.parknm) ?? '이름 없음',
      maxcnt: count(rt?.maxcnt), parkingcnt: count(rt?.parkingcnt), curravacnt: count(rt?.curravacnt),
      lastupdatetime: clean(rt?.lastupdatetime), realtimeMatched: !!rt,
      basicMatched: !!b, matchMethod: b ? method : 'none',
      matchStatus: b ? 'matched' : candidates.length > 1 ? 'ambiguous' : 'unmatched',
      candidateCount: candidates.length
    };
    for (const field of BASIC_FIELDS) result[field] = clean(b?.[field]);
    result.dataIssues = [];
    if (result.maxcnt !== null && result.curravacnt !== null && result.curravacnt > result.maxcnt) {
      result.curravacnt = null;
      result.dataIssues.push('주차가능대수가 전체 면수보다 커 확인이 필요합니다.');
    }
    return result;
  });
}
async function fetchAll(name, key, context) {
  const [endpoint, keyName, ttl] = APIS[name];
  // 캐시에는 인증키 원문을 넣지 않습니다. 키가 바뀌면 캐시도 분리합니다.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2,'0')).join('');
  const cacheUrl = new URL(`/__parking_cache/v1/${name}/${hash}`, context.request.url).href;
  const cache = globalThis.caches?.default;
  if (cache) {
    try { const hit = await cache.match(cacheUrl); if (hit) return { ...await hit.json(), cached: true }; } catch { /* 캐시 실패는 조회에 영향 없음 */ }
  }
  // 전체 페이지 조회가 12초를 넘지 않도록 동일한 신호를 공유합니다.
  const signal = AbortSignal.timeout(12000);
  const rows = name === 'basic' ? 1000 : 100;
  const items = [];
  const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const url = new URL(endpoint);
    url.searchParams.set(keyName, key);
    url.searchParams.set('pageNo', String(page));
    url.searchParams.set('numOfRows', String(rows));
    url.searchParams.set('resultType', 'json');
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('UPSTREAM_HTTP');
    const data = await response.json();
    const envelope = data.response ?? data.getPblcPrkngInfo ?? data;
    const body = envelope.body;
    if (!['00','0'].includes(String(envelope.header?.resultCode)) || !body) throw new Error('UPSTREAM_REJECTED');
    const raw = body.items && typeof body.items === 'object' && 'item' in body.items ? body.items.item : body.items;
    const batch = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Object.keys(raw).length ? [raw] : [];
    const total = count(body.totalCount);
    if (total !== 0 && !batch.length && (total === null || items.length < total)) throw new Error('INCOMPLETE');
    const signature = JSON.stringify(batch);
    if (batch.length && seen.has(signature)) throw new Error('REPEATED_PAGE');
    seen.add(signature);
    items.push(...batch);
    if ((total !== null && items.length >= total) || (total === null && batch.length < rows)) {
      const result = { items, fetchedAt: new Date().toISOString() };
      if (cache) {
        const write = cache.put(cacheUrl, new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } })).catch(() => {});
        if (context.waitUntil) context.waitUntil(write); else await write;
      }
      return { ...result, cached: false };
    }
  }
  throw new Error('PAGE_LIMIT');
}
export async function onRequestGet(context) {
  let key = String(context.env.DATA_API_KEY ?? '').trim();
  if (!key) return json({ message: 'Cloudflare에 DATA_API_KEY 비밀 변수를 등록한 뒤 다시 배포해 주세요.' }, 503);
  try { key = decodeURIComponent(key); } catch { /* Decoding 키 그대로 사용 */ }
  // 새로고침에서는 주소·요금을 다시 받지 않고 빈자리만 전달합니다.
  if (new URL(context.request.url).searchParams.get('mode') === 'realtime') {
    try {
      const result = await fetchAll('realtime', key, context);
      const codes = [...new Set(result.items.map(item => String(item.parkgcd ?? '')).filter(Boolean))];
      const merged = mergeParkingData(codes.map(parkgcd => ({ parkgcd })), result.items, []);
      const realtimeList = merged.map(({ parkgcd, maxcnt, parkingcnt, curravacnt, lastupdatetime, realtimeMatched, dataIssues }) => ({
        parkgcd, maxcnt, parkingcnt, curravacnt, lastupdatetime, realtimeMatched, dataIssues
      }));
      return json({ success: true, mode: 'realtime', realtimeList,
        sources: { realtime: { status: 'ok', fetchedAt: result.fetchedAt, cached: result.cached } } });
    } catch {
      return json({ message: '빈자리 갱신에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, 502);
    }
  }
  const names = ['list','realtime','basic'];
  const results = await Promise.allSettled(names.map(name => fetchAll(name, key, context)));
  if (results[0].status !== 'fulfilled') return json({ message: '주차장 목록을 불러오지 못했습니다. 인증키·활용승인·호출한도를 확인해 주세요.' }, 502);
  const warnings = [];
  const sources = {};
  const sets = results.map((r, i) => {
    sources[names[i]] = { status: r.status === 'fulfilled' ? 'ok' : 'error', fetchedAt: r.status === 'fulfilled' ? r.value.fetchedAt : null, cached: r.status === 'fulfilled' ? r.value.cached : false };
    if (r.status === 'fulfilled') return r.value.items;
    warnings.push(i === 1 ? '실시간 현황 조회에 실패했습니다. 빈자리는 확인 불가로 표시합니다.' : '부산시 기본정보 조회에 실패했습니다. 활용승인·인증키·호출한도를 확인해 주세요.');
    return [];
  });
  const all = mergeParkingData(...sets);
  const matchedCount = all.filter(x => x.basicMatched).length;
  const query = normalizeName(new URL(context.request.url).searchParams.get('name') ?? '');
  const parkingList = query ? all.filter(x => normalizeName(x.parknm).includes(query) || normalizeName(x.pkNam).includes(query)) : all;
  return json({ success: true, totalCount: all.length, resultCount: parkingList.length, basicDataCount: sets[2].length,
    matchedCount, exactMatchedCount: all.filter(x => x.matchMethod === 'exact').length,
    aliasMatchedCount: all.filter(x => x.matchMethod === 'alias').length, unmatchedCount: all.length - matchedCount,
    sources, warnings, parkingList });
}
export function onRequest(context) {
  return context.request.method === 'GET' ? onRequestGet(context) : json({ message: 'GET 요청만 지원합니다.' }, 405);
}
