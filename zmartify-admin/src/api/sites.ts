import { apiClient } from './client';
import { Site } from '../types/api';

export interface GeocodedLocation {
  address: string;
  latitude: number;
  longitude: number;
}

export interface SiteLocation {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export const siteApi = {
  listByDomain: (domainId: number) =>
    apiClient.get(`/domains/${domainId}/sites`),
  
  get: (id: number) => apiClient.get(`/sites/${id}`),
  
  create: (domainId: number, slug: string, name: string, location: SiteLocation = {}): Promise<Site> =>
    apiClient.post(`/domains/${domainId}/sites`, { slug, name, ...location }),

  update: (id: number, payload: { name: string } & SiteLocation): Promise<Site> =>
    apiClient.put(`/sites/${id}`, payload),

  geocode: (payload: { address: string } | { latitude: number; longitude: number }): Promise<GeocodedLocation> =>
    apiClient.post('/sites/geocode', payload),
  
  delete: (id: number) => apiClient.delete(`/sites/${id}`),
};
