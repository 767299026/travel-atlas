import type { Location } from './index.js';
export interface PlaceInput { countryCode: string; areaCode?: string; cityName?: string }
export interface AtlasPlace { key: string; countryCode: string; countryName: string; provinceCode: string | null; provinceName: string | null; cityCode: string | null; cityName: string | null; name: string; center: [number, number] | null }
export interface AtlasCatalog { countries: { code: string; name: string }[]; provinces: { code: string; name: string }[]; cities: { code: string; name: string; provinceCode: string }[] }
export interface AtlasCover { url: string; diaryId: string; title: string; kind: 'journey' }
export interface AtlasCity { place: AtlasPlace; records: number; journeys: number; firstRecordedOn: string | null; lastVisitedOn: string | null; wished: boolean; diaries: number; photos: number; cover: AtlasCover | null }
export interface AtlasConnection { id: string; journeyId: string; from: AtlasPlace; to: AtlasPlace }
export interface AtlasOverview { year: string; years: string[]; countries: number; provinces: number; cities: number; records: number; wishes: number; unassigned: number; places: AtlasCity[]; connections: AtlasConnection[] }
export interface AtlasRecord { id: string; source: 'journey' | 'manual' | 'wish'; version: number; label: string; place: AtlasPlace | null; visitedOn: string | null; note: string; journeyId: string | null; routeId: string | null; detached: boolean }
export interface AtlasDetail { place: AtlasPlace; records: AtlasRecord[]; nextCursor: number | null; journeys: { id: string; title: string }[]; plans: { id: string; title: string }[]; diaries: { id: string; title: string; occurredOn: string | null; status: 'draft' | 'written'; coverUrl: string | null }[] }
export interface AtlasGeometry { code: string; name: string; center: [number, number] | null; geometry: { type: string; coordinates: unknown[] } }
export interface AtlasMap { features: AtlasGeometry[]; attribution: string; sourceUrl: string }
export interface PlaceRecordInput { kind: 'visited' | 'wish'; place: PlaceInput; visitedOn: string | null; note: string }
export interface PersonalProfile { username: string; displayName: string; version: number }
export const placeInputFor = (place: AtlasPlace): PlaceInput => place.countryCode === 'CHN' ? { countryCode: 'CHN', areaCode: place.cityCode ?? place.provinceCode!, ...(!place.cityCode && place.cityName ? { cityName: place.cityName } : {}) } : { countryCode: place.countryCode, cityName: place.cityName! };
export interface AtlasCityLayer {
  place: AtlasPlace;
  points: { id: string; label: string; visitedOn: string; location: Location; journeyId: string; routeId: string }[];
  paths: { id: string; journeyId: string; title: string; fromLabel: string; toLabel: string; visitedOn: string; mode: import('./index.js').TravelMode; lengthM: number; sourceKind: 'manual' | 'imported_reference' | 'routing'; geometry: import('./maps.js').RouteGeometry; reviewStatus: string }[];
  withoutLocation: number; truncated: boolean; sampled: boolean;
}
