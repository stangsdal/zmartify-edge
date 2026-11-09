export type MoreLink = {
  label: string;
  description: string;
  path: string;
  document?: boolean;
};

export type MoreSection = {
  title: string;
  links: MoreLink[];
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
  { label: 'Sites', description: 'Domain locations and ownership boundaries', path: '/app/admin/sites' },
  { label: 'Systems', description: 'Controller fleet and runtime footprint', path: '/app/systems' },
  { label: 'Users', description: 'Platform accounts and global administration', path: '/app/more/users' },
  { label: 'Integrations', description: 'MQTT and external integrations', path: '/app/more/integrations' },
  { label: 'System', description: 'Diagnostics, health and platform status', path: '/app/more/system' },
  { label: 'Audit log', description: 'Administrative actions across the platform', path: '/app/admin/audit-log' },
];

export type MoreSectionsOptions = {
  canUseOwnerTools: boolean;
  isAdministrator: boolean;
  /** True when the sidebar with top-level admin entries is visible (tablet/desktop layouts). */
  hasTopLevelAdminNav: boolean;
};

export function moreSections({ canUseOwnerTools, isAdministrator, hasTopLevelAdminNav }: MoreSectionsOptions): MoreSection[] {
  const sections: MoreSection[] = [{ title: 'Personal', links: personalLinks }];

  // Administrators reach the owner tools through the Systems and Sites hubs
  // when the top-level admin navigation is visible.
  const showOwnerSection = canUseOwnerTools && !(isAdministrator && hasTopLevelAdminNav);
  if (showOwnerSection) {
    sections.push({ title: 'Site management', links: ownerLinks });
  }

  if (isAdministrator && !hasTopLevelAdminNav) {
    sections.push({ title: 'Platform administration', links: administratorLinks });
  }

  return sections;
}