// MCP와 웹은 동일한 Cloudflare Pages /api/parking 핸들러를 사용합니다.
import { onRequestGet } from '../../functions/api/parking.js';

export async function getParking(context) {
  const url = new URL('/api/parking', context.request.url);
  const response = await onRequestGet({ ...context, request: new Request(url) });
  const body = await response.json();
  if (!response.ok || !Array.isArray(body.parkingList)) throw new Error(body.message || '주차장 정보를 조회하지 못했습니다.');
  return body;
}
export const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/공영주차장|공영|도시철도/g, '').replace(/[\s(),，（）]/g, '');
export const limitOf = value => Number.isInteger(value) ? Math.min(20, Math.max(1,value)) : 10;
export const available = p => Number.isFinite(p.curravacnt) && p.curravacnt > 0;
export function summarize(p) {
  return { code:p.parkgcd, name:p.parknm, availableSpaces:p.curravacnt, totalSpaces:p.maxcnt,
    updatedAt:p.lastupdatetime, address:p.doroAddr ?? p.jibunAddr ?? null,
    mapSearchUrl:'https://map.kakao.com/link/search/'+encodeURIComponent('부산 '+p.parknm) };
}
