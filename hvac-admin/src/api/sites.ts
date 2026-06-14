import { apiClient } from './client';
import { Site } from '../types/api';

export const siteApi = {
  listByDomain: (domainId: number) =>
    apiClient.get(`/domains/${domainId}/sites`),
  
  get: (id: number) => apiClient.get(`/sites/${id}`),
  
  create: (domainId: number, slug: string, name: string): Promise<Site> =>
    apiClient.post(`/domains/${domainId}/sites`, { slug, name }),
  
  delete: (id: number) => apiClient.delete(`/sites/${id}`),
};
