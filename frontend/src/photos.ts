import { photoGroupKey, photoPlaceKey, type PhotoMemory, type PhotoInput, type PhotoPlace } from '../../packages/contracts/src/index.js';
export { photoGroupKey, photoPlaceKey };
export const photoDate = (date: string | null) => date?.replaceAll('-', '.') || '时间待补充';
export const photoPlaceName = (place: PhotoPlace | null) => place ? [place.cityName.replace(/市$/, ''), place.label].filter(Boolean).join(' · ') : '地点待补充';
export const photoInput = (photo: PhotoMemory): PhotoInput => ({ mediaId: photo.mediaId, baseVersion: photo.baseVersion, takenOn: photo.takenOn, place: photo.place ? JSON.parse(JSON.stringify(photo.place)) : null, note: photo.note });
export function groupPhotos(photos: PhotoMemory[]) {
  const months = new Map<string, Map<string, PhotoMemory[]>>();
  for (const photo of photos) {
    const month = photo.takenOn?.slice(0, 7) || 'undated', key = photoPlaceKey(photo.place);
    if (!months.has(month)) months.set(month, new Map());
    const places = months.get(month)!; if (!places.has(key)) places.set(key, []); places.get(key)!.push(photo);
  }
  return [...months].map(([key, places]) => ({ key, title: key === 'undated' ? '时间待补充' : key.slice(0, 4) + ' 年 ' + Number(key.slice(5)) + ' 月', places: [...places].map(([key, photos]) => ({ key, title: photoPlaceName(photos[0]!.place), photos })) }));
}
