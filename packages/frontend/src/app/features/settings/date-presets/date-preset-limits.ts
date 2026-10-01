import type { DatePresetLimits } from '@hibiscus-frontend/shared/contracts/user-settings';

// The backend's limits, typed against the shared `DatePresetLimits` contract so they cannot drift:
// a differing value fails typecheck. The backend stays the authority; these only keep the form
// from offering what it would reject.
export const DATE_PRESET_LIMITS: DatePresetLimits = {
  maxPresets: 50,
  maxIdLength: 64,
  maxNameLength: 80,
  minCount: 1,
  maxCount: 366,
  maxAgo: 100,
};
