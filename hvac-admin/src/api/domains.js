import { apiClient } from './client';
export const domainApi = {
    list: () => apiClient.get('/domains'),
    get: (id) => apiClient.get(`/domains/${id}`),
    create: (slug, name) => apiClient.post('/domains', { slug, name }),
    update: (id, slug, name) => apiClient.put(`/domains/${id}`, { slug, name }),
    delete: (id) => apiClient.delete(`/domains/${id}`),
};
