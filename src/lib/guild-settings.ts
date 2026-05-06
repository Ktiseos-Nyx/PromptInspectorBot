import fs from 'fs';

const FILE = 'guild_settings.json';

const DEFAULTS: Record<string, boolean> = {
  ask: false,
  metadata: true,
  describe: true,
  techsupport: false,
  coder: false,
  fun_commands: true,
  qotd: false,
  interact: true,
};

type Settings = Record<string, Record<string, boolean>>;

function load(): Settings {
  if (!fs.existsSync(FILE)) return { _defaults: DEFAULTS };
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { _defaults: DEFAULTS };
  }
}

function save(settings: Settings): void {
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
}

export function getGuildSetting(guildId: string, setting: string, fallback = false): boolean {
  const settings = load();
  const guild = settings[guildId];
  if (guild && setting in guild) return guild[setting];
  const defaults = settings['_defaults'] ?? DEFAULTS;
  if (setting in defaults) return defaults[setting];
  return fallback;
}

export function setGuildSetting(guildId: string, setting: string, value: boolean): void {
  const settings = load();
  if (!settings[guildId]) settings[guildId] = {};
  settings[guildId][setting] = value;
  save(settings);
}

export function getAllGuildSettings(guildId: string): Record<string, boolean> {
  const settings = load();
  return { ...DEFAULTS, ...(settings['_defaults'] ?? {}), ...(settings[guildId] ?? {}) };
}
