// 화면 담당: 공공데이터 API 대신 우리 통합 API만 호출합니다.
const $ = id => document.getElementById(id);
const loadButton = $('load-button');
const statusText = $('status');
const parkingList = $('parking-list');
let data = null;
let loading = false;
let timer = null;
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
function render() {
  if (!data) return;
  const query = normalize($('search').value);
  const items = data.parkingList.filter(p => normalize(p.parknm).includes(query) || normalize(p.pkNam).includes(query));
  items.sort((a,b) => {
    if ($('sort').value === 'available') {
      const diff = (b.curravacnt ?? -1) - (a.curravacnt ?? -1);
      if (diff) return diff;
    }
    return a.parknm.localeCompare(b.parknm, 'ko');
  });
  const fragment = document.createDocumentFragment();
  for (const p of items) {
    const card = element('li', undefined, 'card');
    card.append(element('h2', p.parknm), element('span', `시설공단 코드 ${p.parkgcd}`, 'code'));
    const unknown = p.curravacnt === null;
    card.append(element('p', unknown ? '빈자리 확인 불가' : p.curravacnt === 0 ? '만차 · 빈자리 0대' : `주차 가능 ${number(p.curravacnt)}`, `availability${unknown ? ' unknown' : p.curravacnt === 0 ? ' full' : ''}`));
    card.append(element('p', `현재 주차 ${number(p.parkingcnt)} · 전체 ${number(p.maxcnt)}`, 'meta'));
    card.append(element('p', `실시간 갱신: ${date(p.lastupdatetime)}`, 'meta'));
    const dl = element('dl');
    row(dl, '주소', p.doroAddr ?? p.jibunAddr);
    row(dl, '기본요금', fee(p.pkBascTime, p.tenMin));
    row(dl, '추가요금', fee(p.pkAddTime, p.feeAdd));
    row(dl, '평일 운영', hours(p.svcSrtTe, p.svcEndTe));
    row(dl, '토요일 운영', hours(p.satSrtTe, p.satEndTe));
    row(dl, '공휴일 운영', hours(p.hldSrtTe, p.hldEndTe));
    row(dl, '관리기관', p.guNm);
    row(dl, '기본정보 기준일', p.fnlDt);
    card.append(dl);
    card.append(element('p', p.basicMatched ? `기본정보 연결: ${p.matchMethod === 'alias' ? '별칭' : '정규화 이름'} · ${value(p.pkNam)}` : p.matchStatus === 'ambiguous' ? '기본정보: 중복 후보가 있어 확인 필요' : '기본정보: 연결된 자료 없음', 'meta'));
    if (p.dataIssues?.length) card.append(element('p', p.dataIssues.join(' '), 'warning'));
    const lat = Number(p.xCdnt), lon = Number(p.yCdnt);
    const coords = p.xCdnt !== null && p.yCdnt !== null && lat >= 34 && lat <= 37 && lon >= 128 && lon <= 130;
    const address = p.doroAddr ?? p.jibunAddr;
    if (coords || address) {
      const link = element('a', '지도 보기', 'map-link');
      link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords ? `${lat},${lon}` : `${p.pkNam ?? p.parknm} ${address}`)}`;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      card.append(link);
    }
    fragment.append(card);
  }
  if (!items.length) fragment.append(element('li', '검색 결과가 없습니다. 다른 주차장 이름을 입력해 주세요.', 'card'));
  parkingList.replaceChildren(fragment);
  if (!statusText.classList.contains('error')) statusText.textContent = `${data.totalCount}곳 중 ${items.length}곳 표시`;
}
async function loadParkingList() {
  if (loading) return;
  loading = true;
  loadButton.disabled = true;
  parkingList.setAttribute('aria-busy','true');
  statusText.className = '';
  statusText.textContent = '주차장 정보를 불러오는 중입니다.';
  try {
    const response = await fetch('/api/parking', { cache: 'no-store', signal: AbortSignal.timeout(90000) });
    const next = await response.json();
    if (!response.ok) throw new Error(next.message || '정보를 불러오지 못했습니다.');
    if (!Array.isArray(next.parkingList)) throw new Error('응답 형식을 확인해 주세요.');
    data = next;
    $('warnings').textContent = (data.warnings ?? []).join(' ');
    const fetched = data.sources?.realtime?.fetchedAt;
    $('summary').textContent = `기본정보 연결 ${data.matchedCount}곳 / 미연결 ${data.unmatchedCount}곳 · 마지막 조회 ${fetched ? new Date(fetched).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '실시간 조회 실패'} (한국시간)`;
    render();
  } catch (error) {
    statusText.className = 'error';
    statusText.textContent = error.name === 'TimeoutError' ? '응답이 지연됩니다. 잠시 후 다시 시도해 주세요.' : error.message;
    if (data) statusText.textContent += ' 이전 결과를 유지합니다. 갱신시간을 확인해 주세요.';
  } finally {
    loading = false; loadButton.disabled = false;
    parkingList.setAttribute('aria-busy','false');
  }
}
$('search-form').addEventListener('submit', event => { event.preventDefault(); render(); });
$('search').addEventListener('input', render);
$('sort').addEventListener('change', render);
loadButton.addEventListener('click', loadParkingList);
$('auto-refresh').addEventListener('change', () => {
  clearInterval(timer);
  timer = $('auto-refresh').checked ? setInterval(() => { if (!document.hidden) loadParkingList(); }, 300000) : null;
});
loadParkingList();
