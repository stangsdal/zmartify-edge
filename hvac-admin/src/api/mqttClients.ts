import { apiClient } from './client';
import { MqttClient, AclPreview } from '../types/api';

export const mqttClientApi = {
  list: () => apiClient.get('/mqtt/clients'),
  
  get: (id: number) => apiClient.get(`/mqtt/clients/${id}`),
  
  createHomey: (domainId: number): Promise<MqttClient> =>
    apiClient.post('/mqtt/clients/homey', { domain_id: domainId }),
  
  rotatePassword: (id: number): Promise<{ password: string }> =>
    apiClient.post(`/mqtt/clients/${id}/rotate-password`, {}),
  
  toggle: (id: number, enabled: boolean): Promise<MqttClient> =>
    apiClient.put(`/mqtt/clients/${id}`, { enabled }),
  
  delete: (id: number) => apiClient.delete(`/mqtt/clients/${id}`),
  
  getAclPreview: (clientId: string): Promise<AclPreview> =>
    apiClient.get(`/admin/acl/preview/${clientId}`),
  
  regenerateAcl: (): Promise<{ generation_timestamp: string }> =>
    apiClient.post('/admin/acl/regenerate', {}),
};
