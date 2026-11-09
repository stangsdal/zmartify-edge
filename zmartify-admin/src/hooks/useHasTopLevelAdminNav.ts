import { useEffect, useState } from 'react';

/** Matches the breakpoint where the tablet/desktop sidebar replaces the mobile tab bar. */
const TOP_LEVEL_NAV_QUERY = '(min-width: 768px)';

export function useHasTopLevelAdminNav(): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(TOP_LEVEL_NAV_QUERY).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(TOP_LEVEL_NAV_QUERY);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  return matches;
}
