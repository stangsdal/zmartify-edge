import { apiClient } from './client';

export type SiteMembership = {
  id: number;
  uuid: string;
  user_id: number;
  username: string;
  display_name: string;
  email: string | null;
  role: 'owner' | 'user' | 'viewer';
  status: 'invited' | 'active' | 'disabled';
  product_types: string[];
  created_at: string;
  updated_at: string | null;
};

export type SiteMembershipCandidate = {
  id: number;
  username: string;
  display_name: string;
  email: string | null;
};

export type SiteInvitation = {
  id: number;
  uuid: string;
  email: string;
  site_id: number;
  site_name: string;
  role: 'owner' | 'user' | 'viewer';
  product_types: string[];
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

export const siteMembersApi = {
  list: (siteId: number): Promise<SiteMembership[]> => apiClient.get(`/api/v2/sites/${siteId}/members`),
  candidates: (siteId: number): Promise<SiteMembershipCandidate[]> => apiClient.get(`/api/v2/sites/${siteId}/member-candidates`),
  create: (siteId: number, payload: { user_id: number; role: string; product_types: string[] }): Promise<SiteMembership> =>
    apiClient.post(`/api/v2/sites/${siteId}/members`, payload),
  update: (siteId: number, membershipId: number, payload: { role?: string; status?: string; product_types?: string[] }): Promise<SiteMembership> =>
    apiClient.put(`/api/v2/sites/${siteId}/members/${membershipId}`, payload),
  delete: (siteId: number, membershipId: number): Promise<null> => apiClient.delete(`/api/v2/sites/${siteId}/members/${membershipId}`),
  invitations: (siteId: number): Promise<SiteInvitation[]> => apiClient.get(`/api/v2/sites/${siteId}/invitations`),
  invite: (siteId: number, payload: { email: string; role: string; product_types: string[]; expires_hours?: number }): Promise<SiteInvitation> =>
    apiClient.post(`/api/v2/sites/${siteId}/invitations`, payload),
};