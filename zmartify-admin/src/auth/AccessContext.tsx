import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { authApi } from '../api/auth';

export type ProductType = 'hvac' | 'irrigation' | 'weather' | 'energy';
type Permission = 'read' | 'operate' | 'configure' | 'administer';

type ProductAccess = {
  type: ProductType;
  allowed: boolean;
  permissions: Record<Permission, boolean>;
};

type SiteAccess = {
  id: number;
  uuid: string;
  name: string;
  role: 'administrator' | 'owner' | 'user' | 'viewer';
  products: ProductAccess[];
};

export type AccessContextResponse = {
  user: {
    id: number;
    uuid?: string;
    username: string;
    display_name: string;
    global_roles: string[];
  };
  is_administrator: boolean;
  sites: SiteAccess[];
};

type AccessContextValue = {
  context: AccessContextResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdministrator: boolean;
  selectedSiteId: number | null;
  siteSelectionVersion: number;
  selectSite: (siteId: number, options?: { syncRoute?: boolean }) => void;
  refresh: () => Promise<void>;
  canAccessProduct: (siteId: number, product: ProductType) => boolean;
  can: (siteId: number, product: ProductType, permission: Permission) => boolean;
};

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<AccessContextResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [siteSelectionVersion, setSiteSelectionVersion] = useState(0);

  const refresh = async () => {
    if (!localStorage.getItem('admin_api_token')) {
      setContext(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const nextContext = await authApi.accessContext();
      setContext(nextContext);
      const persistedSiteId = Number(localStorage.getItem('zmartify_selected_site_id'));
      const selectedSite = nextContext.sites.find((site) => site.id === persistedSiteId) || nextContext.sites[0];
      setSelectedSiteId(selectedSite?.id ?? null);
    } catch {
      localStorage.removeItem('admin_api_token');
      setContext(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const onAuthChanged = () => void refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'admin_api_token') {
        void refresh();
      }
    };
    window.addEventListener('zmartify-auth-changed', onAuthChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('zmartify-auth-changed', onAuthChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const can = (siteId: number, product: ProductType, permission: Permission): boolean => {
    if (context?.is_administrator) {
      return true;
    }
    return Boolean(context?.sites.find((site) => site.id === siteId)?.products.find((item) => item.type === product)?.permissions[permission]);
  };

  const value: AccessContextValue = {
    context,
    isAuthenticated: context !== null,
    isLoading,
    isAdministrator: context?.is_administrator === true,
    selectedSiteId,
    siteSelectionVersion,
    selectSite: (siteId, options) => {
      if (!context?.is_administrator && !context?.sites.some((site) => site.id === siteId)) {
        return;
      }
      localStorage.setItem('zmartify_selected_site_id', String(siteId));
      setSelectedSiteId(siteId);
      if (options?.syncRoute !== false) {
        setSiteSelectionVersion((version) => version + 1);
      }
    },
    refresh,
    canAccessProduct: (siteId, product) => can(siteId, product, 'read'),
    can,
  };

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const context = useContext(AccessContext);
  if (!context) {
    throw new Error('useAccess must be used within AccessProvider');
  }
  return context;
}