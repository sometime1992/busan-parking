const APIS = {
  list: ['https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2', 'serviceKey', 21600],
  realtime: ['https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingInfoList_v2', 'serviceKey', 60],
  basic: ['https://apis.data.go.kr/6260000/BusanPblcPrkngInfoService/getPblcPrkngInfo', 'ServiceKey', 21600]
};
export async function fetchAll(name, key, context) {
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
