import type { GuildEntry } from '../lib/settings-types';
import { buildModerationPanel } from './moderation';
import { buildAiPanel } from './ai';
import { buildTrustPanel } from './trust';
import { buildFunPanel } from './fun';

export type Page = 'moderation' | 'ai' | 'trust' | 'fun';

export function buildSettingsPanel(state: GuildEntry, page: Page) {
  switch (page) {
    case 'moderation':
      return buildModerationPanel(state);
    case 'ai':
      return buildAiPanel(state);
    case 'trust':
      return buildTrustPanel(state);
    case 'fun':
      return buildFunPanel(state);
    default:
      return buildModerationPanel(state);
  }
}
