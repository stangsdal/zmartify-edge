import { DeviceDiscovery } from '../types/api';

export interface OnboardingFlowState {
  baseUrl: string;
  discovery?: DeviceDiscovery;
  mode?: 'new' | 'reclaim';
  claimToken?: string;
  displayName?: string;
  selectedDomainId?: number;
  selectedSiteId?: number;
  claimResult?: any;
}

const KEY = 'zmartify_onboarding_flow_v1';

export const onboardingFlow = {
  load(): OnboardingFlowState {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { baseUrl: 'http://192.168.10.57' };
      const parsed = JSON.parse(raw) as OnboardingFlowState;
      return {
        ...parsed,
        baseUrl: parsed.baseUrl || 'http://192.168.10.57',
      };
    } catch {
      return { baseUrl: 'http://192.168.10.57' };
    }
  },

  save(next: OnboardingFlowState): void {
    localStorage.setItem(KEY, JSON.stringify(next));
  },

  patch(partial: Partial<OnboardingFlowState>): OnboardingFlowState {
    const current = this.load();
    const next = { ...current, ...partial };
    this.save(next);
    return next;
  },

  clear(): void {
    localStorage.removeItem(KEY);
  },
};
