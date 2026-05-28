import { Client, Events, ChatInputCommandInteraction, MessageContextMenuCommandInteraction, REST, Routes } from 'discord.js';
import { askCommand, techsupportCommand, coderCommand, describeCommand, promptSupportCommand } from './ai';
import { metadataCommand } from './metadata';
import { decideCommand, pollCommand, wildcardCommand, interactCommand, goodnightCommand } from './fun';
import { qotdCommand } from './qotd';
import { remindCommand } from './reminders';
import { settingsCommand } from './settings';
import { banregistryCommand } from './banregistry';
import { reportCommand } from './report';
import { viewPromptCommand } from './contextmenu';

const slashCommands = [
  metadataCommand,
  askCommand, describeCommand, promptSupportCommand, coderCommand, techsupportCommand,
  decideCommand, pollCommand, wildcardCommand, interactCommand, goodnightCommand,
  qotdCommand, remindCommand,
  settingsCommand, banregistryCommand, reportCommand,
];

const contextMenus = [viewPromptCommand];

export function registerCommands(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const cmd = slashCommands.find(c => c.data.name === interaction.commandName);
      if (cmd) await cmd.execute(interaction as ChatInputCommandInteraction).catch(console.error);
    } else if (interaction.isMessageContextMenuCommand()) {
      const cmd = contextMenus.find(c => c.data.name === interaction.commandName);
      if (cmd) await cmd.execute(interaction as MessageContextMenuCommandInteraction).catch(console.error);
    }
  });

  client.once(Events.ClientReady, async (c) => {
    const rest = new REST().setToken(process.env.BOT_TOKEN!);
    const body = [
      ...slashCommands.map(c => c.data.toJSON()),
      ...contextMenus.map(c => c.data.toJSON()),
    ];
    await rest.put(Routes.applicationCommands(c.user.id), { body });
    console.log(`Synced ${body.length} commands (${slashCommands.length} slash + ${contextMenus.length} context menu)`);
  });
}
