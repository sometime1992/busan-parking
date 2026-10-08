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
const openDetails = new Set();
const mobileRefresh = $('mobile-refresh');
const mobileRefreshLabel = $('mobile-refresh-label');
const known = p => Number.isFinite(p.curravacnt) && p.curravacnt >= 0;
function resetStats() {
  for (const id of ['stat-total', 'stat-available', 'stat-full', 'stat-unknown', 'filter-count-all', 'filter-count-available', 'filter-count-full', 'filter-count-unknown']) $(id).textContent = '—';
  $('result-count').textContent = '';
}
function resetFilters() {
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
    const match = normalize(p.parknm).includes(query) || normalize(p.pkNam).includes(query);
    const state = !known(p) ? 'unknown' : p.curravacnt === 0 ? 'full' : 'available';
    return match && (activeFilter === 'all' || activeFilter === state);
  });
  items.sort((a, b) => {
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
    const link = element('a', '카카오맵에서 위치 확인 ↗', 'map-link');
    link.href = `https://map.kakao.com/link/search/${encodeURIComponent(`부산 ${p.parknm}`)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${p.parknm} 카카오맵에서 위치 확인 (새 창)`);
    card.append(link);
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
$('search-form').addEventListener('submit', event => { event.preventDefault(); render(); });
$('search').addEventListener('input', render);
$('sort').addEventListener('change', render);
loadButton.addEventListener('click', loadParkingList);
mobileRefresh.addEventListener('click', loadParkingList);
$('clear-search').addEventListener('click', () => {
  $('search').value = '';
  render();
  $('search').focus();
});
document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click', () => {
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
    render();
    $('search').focus();
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
