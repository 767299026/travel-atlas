import type { JourneySummary, RouteDay, RouteSnapshot, PlaceInput, TravelMode, Visit } from './index.js';
export interface PlanningPreferences {
  places: Record<string, PlaceInput>;
  poiIds: Record<string, string>;
  stayNotes: Record<string, string>;
  defaultModes: Record<string, TravelMode>;
}
export interface WorkspaceData { journey: JourneySummary; route: RouteSnapshot; preferences: PlanningPreferences; visits: Visit[]; confirmedSourceIds?: string[] }
export interface WorkspaceSave {
  journeyVersion: number; routeVersion: number; title: string; destinations: string[];
  status: JourneySummary['status']; days: RouteDay[]; preferences: PlanningPreferences;
  arrivalModes: Record<string, TravelMode>; clientMutationId: string;
}
