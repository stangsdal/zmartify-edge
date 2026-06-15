import { apiClient } from './client';

export interface MobileNotification {
  notification_id: string;
  read: boolean;
  created_at: string;
  event: {
    event_id?: string;
    event_type: string;
    payload?: {
      device_id?: string;
      zone_id?: number;
      [key: string]: unknown;
    };
    created_at?: string;
  };
}

export const notificationsApi = {
  list: (params?: { limit?: number; unread_only?: boolean }): Promise<MobileNotification[]> => {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) search.set('limit', String(params.limit));
    if (params?.unread_only) search.set('unread_only', 'true');
    const query = search.toString();
    return apiClient.get(`/mobile/notifications${query ? `?${query}` : ''}`);
  },

  markRead: (notificationId: string): Promise<MobileNotification> =>
    apiClient.post(`/mobile/notifications/${notificationId}/read`, {}),

  markAllRead: (): Promise<{ updated: number }> => apiClient.post('/mobile/notifications/read-all', {}),
};
