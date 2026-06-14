import { apiClient } from './client';
import { LoginResponse, SetupStatus, User } from '../types/api';

export const authApi = {
  setupStatus: (): Promise<SetupStatus> => apiClient.get('/setup/status'),

  login: (username: string, password: string): Promise<LoginResponse> =>
    apiClient.post('/auth/login', { username, password }),

  logout: (): Promise<{ ok: boolean }> => apiClient.post('/auth/logout', {}),

  me: (): Promise<User> => apiClient.get('/auth/me'),
};
