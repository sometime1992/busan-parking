import { fetchAll } from './fetchUpstream.js';
export const fetchBasicInfo = (key, context) => fetchAll('basic', key, context);
