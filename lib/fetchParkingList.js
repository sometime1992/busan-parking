import { fetchAll } from './fetchUpstream.js';
export const fetchParkingList = (key, context) => fetchAll('list', key, context);
