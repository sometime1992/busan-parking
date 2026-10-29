// V2: 통합 API는 요청 조율과 응답만 담당합니다.
import { normalizeName } from '../../lib/normalizeName.js';
import { mergeParkingData } from '../../lib/mergeParkingData.js';
import { fetchParkingList } from '../../lib/fetchParkingList.js';
import { fetchRealtime } from '../../lib/fetchRealtime.js';
import { fetchBasicInfo } from '../../lib/fetchBasicInfo.js';
import { suppliedPlaceFor } from '../../lib/suppliedParkingPlaces.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export async function onRequestGet(context) {
  let key = String(context.env.DATA_API_KEY ?? '').trim();
  if (!key) return json({ message: 'Cloudflare에 DATA_API_KEY 비밀 변수를 등록한 뒤 다시 배포해 주세요.' }, 503);
  try { key = decodeURIComponent(key); } catch { /* Decoding 키 그대로 사용 */ }
  // 새로고침에서는 주소·요금을 다시 받지 않고 빈자리만 전달합니다.
  if (new URL(context.request.url).searchParams.get('mode') === 'realtime') {
    try {
      const result = await fetchRealtime(key, context);
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
  const results = await Promise.allSettled([fetchParkingList(key, context), fetchRealtime(key, context), fetchBasicInfo(key, context)]);
  if (results[0].status !== 'fulfilled') return json({ message: '주차장 목록을 불러오지 못했습니다. 인증키·활용승인·호출한도를 확인해 주세요.' }, 502);
  const warnings = [];
  const sources = {};
  const sets = results.map((r, i) => {
    sources[names[i]] = { status: r.status === 'fulfilled' ? 'ok' : 'error', fetchedAt: r.status === 'fulfilled' ? r.value.fetchedAt : null, cached: r.status === 'fulfilled' ? r.value.cached : false };
    if (r.status === 'fulfilled') return r.value.items;
    warnings.push(i === 1 ? '실시간 현황 조회에 실패했습니다. 빈자리는 확인 불가로 표시합니다.' : '부산시 기본정보 조회에 실패했습니다. 활용승인·인증키·호출한도를 확인해 주세요.');
    return [];
  });
  const all = mergeParkingData(...sets).map(p => {
    const supplied = suppliedPlaceFor(p);
    return supplied ? { ...p, ownerCandidatePlaceUrl: supplied.placeUrl } : p;
  });
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
