import { apiClient } from './client';
import { InviteValidateResponse, LoginResponse, RegisterByInviteRequest, SetupStatus, User } from '../types/api';

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
};
