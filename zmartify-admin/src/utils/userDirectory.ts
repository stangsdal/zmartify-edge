import { User } from '../types/api';

export type UserStatusFilter = 'all' | 'enabled' | 'disabled';
export type UserRoleFilter = 'all' | 'administrator' | 'standard';
export type UserSort = 'username' | 'display_name' | 'last_login';

export type UserDirectoryFilters = {
  query: string;
  status: UserStatusFilter;
  role: UserRoleFilter;
  sort: UserSort;
};

export function filterUsers(users: User[], filters: UserDirectoryFilters): User[] {
  const query = filters.query.trim().toLowerCase();
  const filtered = users.filter((user) => {
    const searchable = [user.username, user.display_name, user.email, user.phone, ...(user.roles || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const isAdministrator = user.roles?.includes('administrator');
    const matchesStatus = filters.status === 'all'
      || (filters.status === 'enabled' ? Boolean(user.enabled) : !user.enabled);
    const matchesRole = filters.role === 'all'
      || (filters.role === 'administrator' ? isAdministrator : !isAdministrator);
    return (!query || searchable.includes(query)) && matchesStatus && matchesRole;
  });

  return [...filtered].sort((left, right) => {
    if (filters.sort === 'last_login') {
      return (Date.parse(right.last_login_at || '') || 0) - (Date.parse(left.last_login_at || '') || 0);
    }
    return (filters.sort === 'display_name' ? left.display_name : left.username)
      .localeCompare(filters.sort === 'display_name' ? right.display_name : right.username, undefined, { sensitivity: 'base' });
  });
}

export function paginateUsers(users: User[], page: number, pageSize: number): User[] {
  const safePage = Math.max(1, page);
  return users.slice((safePage - 1) * pageSize, safePage * pageSize);
}