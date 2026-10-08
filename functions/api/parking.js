// 서버 담당: 인증키를 읽고 시설공단 주차장 목록 API를 호출합니다.
// 다음 단계에서 실시간 현황, 부산시 기본정보를 이 파일에 추가합니다.
const LIST_API = "https://apis.data.go.kr/B552587/ParkingInfoService_v2/getParkingList_v2";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function onRequestGet(context) {
  const apiKey = context.env.DATA_API_KEY;
  if (!apiKey) {
    return json({ message: "Cloudflare에 DATA_API_KEY 비밀 변수를 등록한 뒤 다시 배포해 주세요." }, 503);
  }

  try {
    // Decoding 키를 권장합니다. Encoding 키도 중복 인코딩하지 않습니다.
    let decodedKey = apiKey;
    try { decodedKey = decodeURIComponent(apiKey); } catch { /* Decoding 키 그대로 사용 */ }
    const parkingList = [];
    // 첫 응답의 totalCount를 확인해 다음 페이지가 있으면 함께 가져옵니다.
    for (let page = 1; page <= 10; page++) {
      const url = new URL(LIST_API);
      url.searchParams.set("serviceKey", decodedKey);
      url.searchParams.set("pageNo", String(page));
      url.searchParams.set("numOfRows", "100");
      url.searchParams.set("resultType", "json");
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("API_HTTP_ERROR");
      const data = await response.json();
      const header = data?.response?.header;
      const body = data?.response?.body;
      if (!["00", "0"].includes(String(header?.resultCode)) || !body) {
        return json({ message: "공공데이터 API가 요청을 승인하지 않았습니다. 인증키·활용승인·호출한도를 확인해 주세요." }, 502);
      }
      const rawItems = body.items?.item;
      const items = Array.isArray(rawItems) ? rawItems : rawItems && typeof rawItems === "object" ? [rawItems] : [];
      const totalCount = Number(body.totalCount);
      const hasTotal = body.totalCount != null && String(body.totalCount).trim() !== "" && Number.isInteger(totalCount) && totalCount >= 0;
      if (!items.length && (!hasTotal || parkingList.length < totalCount)) throw new Error("INCOMPLETE_RESPONSE");
      parkingList.push(...items.map(item => ({
        parkgcd: String(item.parkgcd ?? ""),
        parknm: String(item.parknm ?? "이름 없음")
      })));
      if ((hasTotal && parkingList.length >= totalCount) || (!hasTotal && items.length < 100)) {
        return json({ parkingList });
      }
    }
    throw new Error("TOO_MANY_PAGES");
  } catch {
    // 요청 URL·인증키·제공기관 원문 오류는 브라우저에 보내지 않습니다.
    return json({ message: "주차장 목록을 불러오지 못했습니다. 인증키와 공공데이터 API 연결 상태를 확인한 뒤 다시 시도해 주세요." }, 502);
  }
}

export function onRequest(context) {
  return context.request.method === "GET"
    ? onRequestGet(context)
    : json({ message: "GET 요청만 지원합니다." }, 405);
}
