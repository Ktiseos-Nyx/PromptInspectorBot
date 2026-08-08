// Re-exports from the modular panels under src/panels/ — kept for backward
// compatibility while callers migrate. New code should import from
// src/panels/index.ts and src/panels/shared.ts directly.
export {
  buildSettingsPanel,
  type Page,
} from '../panels/index';
export {
  applyToggleSelection,
  type Feature,
  navRow,
  fmtChannel, fmtRoles, fmtChannels, fmtUsers,
  TRUSTED_USERS_MAX, TRUSTED_ROLES_MAX,
} from '../panels/shared';
export { AI_FEATURES } from '../panels/ai';
export { FUN_FEATURES } from '../panels/fun';
