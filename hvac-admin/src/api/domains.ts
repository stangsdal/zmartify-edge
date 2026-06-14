import { apiClient } from './client';
import { Domain } from '../types/api';

export const domainApi = {
  list: () => apiClient.get('/domains'),
  
  get: (id: number) => apiClient.get(`/domains/${id}`),
  
  create: (slug: string, name: string): Promise<Domain> =>
    apiClient.post('/domains', { slug, name }),
  
  update: (id: number, slug: string, name: string): Promise<Domain> =>
    apiClient.put(`/domains/${id}`, { slug, name }),
  
  delete: (id: number) => apiClient.delete(`/domains/${id}`),
};
