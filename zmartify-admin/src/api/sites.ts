import { apiClient } from './client';
import { Site } from '../types/api';

export const siteApi = {
  listByDomain: (domainId: number) =>
    apiClient.get(`/domains/${domainId}/sites`),
  
  get: (id: number) => apiClient.get(`/sites/${id}`),
  
  create: (domainId: number, slug: string, name: string, address?: string): Promise<Site> =>
    apiClient.post(`/domains/${domainId}/sites`, { slug, name, address: address || null }),

  update: (id: number, payload: { name: string; address?: string | null }): Promise<Site> =>
    apiClient.put(`/sites/${id}`, payload),
  
  delete: (id: number) => apiClient.delete(`/sites/${id}`),
};
