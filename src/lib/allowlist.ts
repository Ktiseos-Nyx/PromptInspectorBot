// Returns true only when an allowlist is configured AND this guild is not on it.
// An empty allowlist means "open" — the bot never auto-leaves.
export function shouldLeaveGuild(guildId: string, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return false;
  return !allowlist.has(guildId);
}
