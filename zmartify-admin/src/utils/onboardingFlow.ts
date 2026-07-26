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
const DEFAULT_ONBOARDING_URL = 'http://zmartify-irrigation.local';

export const onboardingFlow = {
  load(): OnboardingFlowState {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { baseUrl: DEFAULT_ONBOARDING_URL };
      const parsed = JSON.parse(raw) as OnboardingFlowState;
      return {
        ...parsed,
        baseUrl: parsed.baseUrl || DEFAULT_ONBOARDING_URL,
      };
    } catch {
      return { baseUrl: DEFAULT_ONBOARDING_URL };
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
