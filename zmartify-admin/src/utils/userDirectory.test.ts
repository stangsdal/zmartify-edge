import { describe, expect, it } from 'vitest';
import { User } from '../types/api';
import { filterUsers, paginateUsers } from './userDirectory';

const users: User[] = [
  { id: 1, username: 'zoe', display_name: 'Zoe North', phone: '+45 12 34 56 78', enabled: 1, created_at: '2026-01-01', last_login_at: '2026-09-10T08:00:00Z', roles: [] },
  { id: 2, username: 'admin', display_name: 'Alex Admin', email: 'alex@example.com', enabled: 1, created_at: '2026-01-02', last_login_at: '2026-09-11T08:00:00Z', roles: ['administrator'] },
  { id: 3, username: 'disabled', display_name: 'Disabled User', enabled: 0, created_at: '2026-01-03', roles: [] },
];

describe('userDirectory', () => {
  it('combines search, status and role filters', () => {
    expect(filterUsers(users, {
      query: 'example.com', status: 'enabled', role: 'administrator', sort: 'username',
    }).map((user) => user.id)).toEqual([2]);
  });

  it('sorts users by most recent login with never last', () => {
    expect(filterUsers(users, {
      query: '', status: 'all', role: 'all', sort: 'last_login',
    }).map((user) => user.id)).toEqual([2, 1, 3]);
  });

  it('includes phone numbers in directory search', () => {
    expect(filterUsers(users, {
      query: '12 34 56', status: 'all', role: 'all', sort: 'username',
    }).map((user) => user.id)).toEqual([1]);
  });

  it('paginates without mutating the source list', () => {
    expect(paginateUsers(users, 2, 2).map((user) => user.id)).toEqual([3]);
    expect(users).toHaveLength(3);
  });
});