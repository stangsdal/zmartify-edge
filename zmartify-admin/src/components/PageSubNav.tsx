import { NavLink, useLocation } from 'react-router-dom';

export type PageSubNavItem = {
  label: string;
  path: string;
  /** Alternative route that also renders this page (kept for backwards-compatible URLs). */
  altPath?: string;
};

export function PageSubNav({ items }: { items: PageSubNavItem[] }) {
  const location = useLocation();
  return (
    <nav className="page-subnav" aria-label="Section navigation">
      {items.map((item) => {
        const active = location.pathname === item.path || (!!item.altPath && location.pathname === item.altPath);
        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={`page-subnav__link${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

export const systemsHubNav: PageSubNavItem[] = [
  { label: 'Overview', path: '/app/systems' },
  { label: 'Controllers', path: '/app/more/controllers' },
  { label: 'Firmware library', path: '/app/more/firmware' },
];

export const sitesHubNav: PageSubNavItem[] = [
  { label: 'Overview', path: '/app/admin/sites' },
  { label: 'Site members', path: '/app/more/members' },
];

export const systemHubNav: PageSubNavItem[] = [
  { label: 'Overview', path: '/app/admin/system', altPath: '/app/more/system' },
  { label: 'Audit log', path: '/app/admin/audit-log' },
];
