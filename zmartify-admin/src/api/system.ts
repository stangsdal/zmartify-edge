import { apiClient } from './client';
import { SystemStatus } from '../types/api';

export const systemApi = {
  getStatus: (): Promise<SystemStatus> => apiClient.get('/health'),
  
  getRegistryStatus: () => apiClient.get('/registry/status'),
  
  getAclStatus: () => apiClient.get('/admin/acl/status'),
};
