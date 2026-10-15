import { fetchAll } from './fetchUpstream.js';
export const fetchRealtime = (key, context) => fetchAll('realtime', key, context);
