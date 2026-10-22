import { api } from './api';
import type { AtlasCatalog } from '../../packages/contracts/src/index.js';
let pending: Promise<AtlasCatalog> | undefined;
export function loadAtlasCatalog() { return pending ??= api<AtlasCatalog>('/atlas/catalog').catch(e => { pending = undefined; throw e; }); }
