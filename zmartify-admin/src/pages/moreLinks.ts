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
  { label: 'Controller onboarding', description: 'Connect and assign a new controller', path: '/app/onboarding/discover' },
  { label: 'Firmware library', description: 'Latest firmware for Zmartify controllers', path: '/app/firmware/index.html', document: true },
  { label: 'AHC9000 USB installer', description: 'Recover or reset an AHC9000 controller over USB', path: '/app/firmware/ahc9000/index.html', document: true },
  { label: 'Site members', description: 'Manage roles and product access for your sites', path: '/app/more/members' },
];

const administratorLinks: MoreLink[] = [
  { label: 'Devices', description: 'Device inventory and details', path: '/app/more/devices' },
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