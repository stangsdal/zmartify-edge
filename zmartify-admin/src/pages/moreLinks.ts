export type MoreLink = {
  label: string;
  description: string;
  path: string;
  document?: boolean;
};

const personalLinks: MoreLink[] = [
  { label: 'Profile', description: 'Account identity and session details', path: '/app/more/profile' },
  { label: 'Notifications', description: 'Read, filter and clear notifications', path: '/app/more/notifications' },
  { label: 'Settings', description: 'Theme, property and client preferences', path: '/app/more/settings' },
];

const ownerLinks: MoreLink[] = [
  { label: 'Controllers', description: 'Onboarding, fleet operations and firmware releases', path: '/app/more/controllers' },
  { label: 'Firmware library', description: 'Published OTA and USB recovery releases', path: '/app/more/firmware' },
  { label: 'Site members', description: 'Manage roles and product access for your sites', path: '/app/more/members' },
];

const administratorLinks: MoreLink[] = [
  { label: 'Users', description: 'Platform accounts and global administration', path: '/app/more/users' },
  { label: 'Integrations', description: 'MQTT and external integrations', path: '/app/more/integrations' },
  { label: 'System', description: 'Diagnostics, health and platform status', path: '/app/more/system' },
];

export function moreLinks(canUseOwnerTools: boolean, isAdministrator: boolean): MoreLink[] {
  return [
    ...personalLinks,
    ...(canUseOwnerTools ? ownerLinks : []),
    ...(isAdministrator ? administratorLinks : []),
  ];
}