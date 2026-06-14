import { apiClient } from './client';
export const siteApi = {
    listByDomain: (domainId) => apiClient.get(`/domains/${domainId}/sites`),
    get: (id) => apiClient.get(`/sites/${id}`),
    create: (domainId, slug, name) => apiClient.post(`/domains/${domainId}/sites`, { slug, name }),
    delete: (id) => apiClient.delete(`/sites/${id}`),
};
