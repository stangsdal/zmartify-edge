import { apiClient } from './client';
import {
  CreateInviteBulkRequest,
  CreateInviteBulkResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  InviteListItem,
} from '../types/api';

export const invitesApi = {
  createRegistrationInvite: (payload: CreateInviteRequest): Promise<CreateInviteResponse> =>
    apiClient.post('/admin/invites/register', payload),

  createRegistrationInvitesBulk: (payload: CreateInviteBulkRequest): Promise<CreateInviteBulkResponse> =>
    apiClient.post('/admin/invites/register/bulk', payload),

  listRegistrationInvites: (limit: number = 200): Promise<InviteListItem[]> =>
    apiClient.get(`/admin/invites/register?limit=${Math.max(1, Math.trunc(limit))}`),
};
