import { atlasCatalog, atlasMap } from '../atlas-catalog.js';
try { const catalog = await atlasCatalog(), china = await atlasMap('100000'); console.log(JSON.stringify({ countries: catalog.countries.length, provinces: catalog.provinces.length, cities: catalog.cities.length, mapFeatures: china.features.length, storage: 'data/atlas; reference metadata and map cache only' })); }
catch { console.error('地区目录准备未完成，未输出私有数据。'); process.exitCode = 1; }
