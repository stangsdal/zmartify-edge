import { apiClient } from './client';
import { AuditLogEntry, User } from '../types/api';

export interface UserSiteAccess {
  user_id: number;
  site_ids: number[];
}

export const usersApi = {
  list: (): Promise<User[]> => apiClient.get('/users'),

  get: (id: number): Promise<User> => apiClient.get(`/users/${id}`),

  create: (payload: {
    username: string;
    display_name: string;
    password: string;
    email?: string;
    roles?: string[];
  }): Promise<User> => apiClient.post('/users', payload),

  disable: (id: number): Promise<User> => apiClient.post(`/users/${id}/disable`, {}),

  enable: (id: number): Promise<User> => apiClient.post(`/users/${id}/enable`, {}),

  resetPassword: (id: number, password: string): Promise<User> =>
    apiClient.post(`/users/${id}/reset-password`, { password }),

  setRoles: (id: number, roles: string[]): Promise<User> =>
    apiClient.post(`/users/${id}/roles`, { roles }),

  getSiteAccess: (id: number): Promise<UserSiteAccess> => apiClient.get(`/users/${id}/site-access`),

  setSiteAccess: (id: number, siteIds: number[]): Promise<UserSiteAccess> =>
    apiClient.post(`/users/${id}/site-access`, { site_ids: siteIds }),

  delete: (id: number): Promise<null> => apiClient.delete(`/users/${id}`),

  auditLog: (limit = 200): Promise<AuditLogEntry[]> =>
    apiClient.get(`/admin/audit-log?limit=${limit}`),
};
