import { apiClient } from './client';
export const mqttClientApi = {
    list: () => apiClient.get('/mqtt/clients'),
    get: (id) => apiClient.get(`/mqtt/clients/${id}`),
    createHomey: (domainId) => apiClient.post('/mqtt/clients/homey', { domain_id: domainId }),
    rotatePassword: (id) => apiClient.post(`/mqtt/clients/${id}/rotate-password`, {}),
    toggle: (id, enabled) => apiClient.put(`/mqtt/clients/${id}`, { enabled }),
    delete: (id) => apiClient.delete(`/mqtt/clients/${id}`),
    getAclPreview: (clientId) => apiClient.get(`/admin/acl/preview/${clientId}`),
    regenerateAcl: () => apiClient.post('/admin/acl/regenerate', {}),
};
