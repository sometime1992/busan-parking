import { clean, count, normalizeName } from './normalizeName.js';

const ALIASES = { A11: '부산기계공고 공영주차장', A21: '화명 공영주차장', A37: '롯데광복점 뒤 2번', A48: '대연고가도로 밑', A434: '만덕2동사 앞' };
const BASIC_FIELDS = ['mgntNum','pkNam','guNm','doroAddr','jibunAddr','tponNum','pkFm','pkCnt','svcSrtTe','svcEndTe','satSrtTe','satEndTe','hldSrtTe','hldEndTe','oprDay','feeInfo','pkBascTime','tenMin','pkAddTime','feeAdd','ftDay','ftMon','xCdnt','yCdnt','fnlDt','spclNote'];
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
