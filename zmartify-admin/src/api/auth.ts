import { apiClient } from './client';
import { InviteValidateResponse, LoginResponse, RegisterByInviteRequest, SetupStatus, User } from '../types/api';
import type { AccessContextResponse } from '../auth/AccessContext';

export type SiteInvitationValidateResponse = {
  valid: boolean;
  site_name?: string | null;
  role?: string | null;
  product_types: string[];
  expires_at?: string | null;
  reason?: string | null;
};

export const authApi = {
  setupStatus: (): Promise<SetupStatus> => apiClient.get('/setup/status'),

  login: (username: string, password: string): Promise<LoginResponse> =>
    apiClient.post('/auth/login', { username, password }),

  validateInvite: (token: string): Promise<InviteValidateResponse> =>
    apiClient.get(`/auth/invite/validate?token=${encodeURIComponent(token)}`),

  registerByInvite: (payload: RegisterByInviteRequest): Promise<LoginResponse> =>
    apiClient.post('/auth/register', payload),

  logout: (): Promise<{ ok: boolean }> => apiClient.post('/auth/logout', {}),

  me: (): Promise<User> => apiClient.get('/auth/me'),

  accessContext: (): Promise<AccessContextResponse> => apiClient.get('/api/v2/me/context'),

  validateSiteInvitation: (token: string): Promise<SiteInvitationValidateResponse> =>
    apiClient.get(`/api/v2/site-invitations/validate?token=${encodeURIComponent(token)}`),

  acceptSiteInvitation: (token: string): Promise<unknown> =>
    apiClient.post('/api/v2/site-invitations/accept', { token }),

  registerBySiteInvitation: (payload: { token: string; username: string; display_name: string; password: string }): Promise<LoginResponse> =>
    apiClient.post('/api/v2/site-invitations/register', payload),
};
