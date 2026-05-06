import { ChatInputCommandInteraction, EmbedBuilder, Colors, SlashCommandBuilder } from 'discord.js';
import fs from 'fs';
import { getGuildSetting } from '../lib/guild-settings';

const GOODNIGHT_GENERIC = [
  'Goodnight everyone! Sweet dreams! 💤',
  'Time to sleep! Goodnight all! 🌙',
  'Off to dreamland! Goodnight! ✨',
  'Sleep tight everyone! 🛏️',
  'Goodnight! May your dreams be filled with adventure! 🌠',
  'Sweet dreams everyone! See you tomorrow! 🌃',
];

const GOODNIGHT_TARGETED = [
  '{user} wishes {target} a goodnight! Sweet dreams! 💤',
  '{user} says goodnight to {target}! Sleep well! 🌙',
  '{target}, {user} hopes you have the sweetest dreams! ✨',
  'Goodnight {target}! {user} hopes you sleep tight! 🛏️',
  'Sweet dreams {target}! {user} wishes you a restful night! 🌃',
];

const GOODNIGHT_GIFS = [
  'https://media.tenor.com/5dYf85c-I_0AAAAC/goodnight-sleep-well.gif',
  'https://media.tenor.com/eKOYx8x-xdYAAAAC/good-night-sweet-dreams.gif',
  'https://media.tenor.com/m3qV4147lMcAAAAC/good-night.gif',
  'https://media.tenor.com/X3kYPj2SzMcAAAAC/goodnight-moon.gif',
  'https://media.tenor.com/VxQr5oQvJwEAAAAC/goodnight-sleep-tight.gif',
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function funEnabled(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.guild) return true;
  return getGuildSetting(interaction.guildId!, 'fun_commands', true);
}

// ── /decide ───────────────────────────────────────────────────────────────────

export const decideCommand = {
  data: new SlashCommandBuilder()
    .setName('decide')
    .setDescription('Let the bot pick for you')
    .addStringOption(o => o.setName('choices').setDescription('Comma-separated options').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!funEnabled(interaction)) return interaction.reply({ content: '❌ Fun commands are not enabled on this server.', ephemeral: true });

    const options = interaction.options.getString('choices', true).split(',').map(s => s.trim()).filter(Boolean);
    if (options.length < 2) return interaction.reply({ content: '❌ Provide at least 2 choices separated by commas.', ephemeral: true });
    if (options.length > 20) return interaction.reply({ content: '❌ Maximum 20 choices.', ephemeral: true });

    const chosen = pick(options);
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('🎲 Decision Made!')
      .setDescription(`I choose: **${chosen}**`)
      .addFields({ name: 'Options', value: options.map(o => `\`${o}\``).join(', ') })
      .setFooter({ text: `Requested by ${interaction.user.displayName}` });

    await interaction.reply({ embeds: [embed] });
  },
};

// ── /poll ─────────────────────────────────────────────────────────────────────

export const pollCommand = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create a quick poll')
    .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption(o =>
      o.setName('type').setDescription('Poll type').setRequired(true)
        .addChoices({ name: 'Yes/No', value: 'yesno' }, { name: 'A or B', value: 'ab' })
    )
    .addStringOption(o => o.setName('option_a').setDescription('Option A (for A/B polls)'))
    .addStringOption(o => o.setName('option_b').setDescription('Option B (for A/B polls)')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!funEnabled(interaction)) return interaction.reply({ content: '❌ Fun commands are not enabled on this server.', ephemeral: true });

    const question = interaction.options.getString('question', true);
    const type = interaction.options.getString('type', true);
    const optA = interaction.options.getString('option_a');
    const optB = interaction.options.getString('option_b');

    if (type === 'ab' && (!optA || !optB)) {
      return interaction.reply({ content: '❌ A/B polls require both option_a and option_b.', ephemeral: true });
    }

    const embed = new EmbedBuilder().setColor(Colors.Blue).setTitle('📊 Poll').setDescription(`**${question}**`);
    const reactions = type === 'yesno'
      ? (embed.addFields({ name: 'Options', value: '✅ Yes\n❌ No' }), ['✅', '❌'])
      : (embed.addFields({ name: '🇦', value: optA!, inline: true }, { name: '🇧', value: optB!, inline: true }), ['🇦', '🇧']);

    embed.setFooter({ text: `Poll by ${interaction.user.displayName}` });

    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();
    for (const r of reactions) await msg.react(r);
  },
};

// ── /wildcard ─────────────────────────────────────────────────────────────────

export const wildcardCommand = {
  data: new SlashCommandBuilder()
    .setName('wildcard')
    .setDescription('Generate a random art prompt'),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!funEnabled(interaction)) return interaction.reply({ content: '❌ Fun commands are not enabled on this server.', ephemeral: true });

    if (!fs.existsSync('wildcards.json')) {
      return interaction.reply({ content: '❌ Wildcards file not found.', ephemeral: true });
    }

    const w = JSON.parse(fs.readFileSync('wildcards.json', 'utf8'));
    const subject = pick(w.subjects);
    const style   = pick(w.styles);
    const setting = pick(w.settings);
    const lighting = pick(w.lighting);
    const mood    = pick(w.moods);
    const action  = pick(w.actions);
    const detail  = pick(w.details ?? ['highly detailed']);

    const prompt = `${subject} ${action}, ${detail}, ${style} style, ${setting}, ${lighting}, ${mood} mood`;

    const embed = new EmbedBuilder()
      .setColor(Colors.Purple)
      .setTitle('🎨 Random Art Prompt')
      .setDescription(`\`\`\`${prompt}\`\`\``)
      .addFields(
        { name: 'Subject',  value: String(subject),  inline: true },
        { name: 'Action',   value: String(action),   inline: true },
        { name: 'Style',    value: String(style),    inline: true },
        { name: 'Setting',  value: String(setting),  inline: true },
        { name: 'Lighting', value: String(lighting), inline: true },
        { name: 'Mood',     value: String(mood),     inline: true },
      )
      .setFooter({ text: `Generated for ${interaction.user.displayName} • Roll again for a new prompt!` });

    await interaction.reply({ embeds: [embed] });
  },
};

// ── /interact ─────────────────────────────────────────────────────────────────

export const interactCommand = {
  data: new SlashCommandBuilder()
    .setName('interact')
    .setDescription('Interact with another user')
    .addStringOption(o =>
      o.setName('action').setDescription('Action').setRequired(true)
        .addChoices(
          { name: '🤗 Hug',        value: 'hug' },
          { name: '👉 Poke',       value: 'poke' },
          { name: '😤 Taunt',      value: 'taunt' },
          { name: '⭐ Pat',        value: 'pat' },
          { name: '🙌 High-five',  value: 'highfive' },
        )
    )
    .addUserOption(o => o.setName('user').setDescription('Who to interact with').setRequired(true))
    .addStringOption(o => o.setName('system_member').setDescription('PluralKit system member name')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.guild && !getGuildSetting(interaction.guildId!, 'interact', true)) {
      return interaction.reply({ content: '❌ /interact is not enabled on this server.', ephemeral: true });
    }

    if (!fs.existsSync('interactions.json')) {
      return interaction.reply({ content: '❌ Interactions file not found.', ephemeral: true });
    }

    const action = interaction.options.getString('action', true);
    const target = interaction.options.getUser('user', true);
    const sysMember = interaction.options.getString('system_member');
    const data = JSON.parse(fs.readFileSync('interactions.json', 'utf8'));
    const actionData = data[action];
    if (!actionData) return interaction.reply({ content: '❌ Unknown action.', ephemeral: true });

    let message: string;
    if (target.id === interaction.user.id) {
      message = (actionData.self as string).replace('{user}', interaction.user.toString());
    } else if (sysMember) {
      message = (actionData.system_member as string)
        .replace('{user}', interaction.user.toString())
        .replace('{target}', target.toString())
        .replace('{system_member}', sysMember)
        .replace('{taunt_text}', action === 'taunt' ? pick(actionData.messages ?? ['']) : '');
    } else {
      message = (actionData.target as string)
        .replace('{user}', interaction.user.toString())
        .replace('{target}', target.toString())
        .replace('{taunt_text}', action === 'taunt' ? pick(actionData.messages ?? ['']) : '');
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Fuchsia)
      .setDescription(message)
      .setThumbnail(target.displayAvatarURL())
      .setFooter({ text: `From ${interaction.user.displayName}` });

    const gifs: string[] = actionData.gifs ?? [];
    if (gifs.length) embed.setImage(pick(gifs));

    await interaction.reply({ embeds: [embed] });
  },
};

// ── /goodnight ────────────────────────────────────────────────────────────────

export const goodnightCommand = {
  data: new SlashCommandBuilder()
    .setName('goodnight')
    .setDescription('Say goodnight to everyone or someone special')
    .addUserOption(o => o.setName('user').setDescription('Who to say goodnight to'))
    .addStringOption(o => o.setName('message').setDescription('Custom goodnight message')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!funEnabled(interaction)) return interaction.reply({ content: '❌ Fun commands are not enabled on this server.', ephemeral: true });

    const target = interaction.options.getUser('user');
    const custom = interaction.options.getString('message');

    let text: string;
    if (custom) {
      text = target
        ? `${interaction.user} says to ${target}: ${custom} 💤`
        : `${interaction.user} says: ${custom} 💤`;
    } else if (target) {
      text = pick(GOODNIGHT_TARGETED)
        .replace('{user}', interaction.user.toString())
        .replace('{target}', target.toString());
    } else {
      text = `${interaction.user} says: ${pick(GOODNIGHT_GENERIC)}`;
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Purple)
      .setDescription(text)
      .setImage(pick(GOODNIGHT_GIFS))
      .setFooter({ text: `Goodnight from ${interaction.user.displayName} 🌙` });

    await interaction.reply({ embeds: [embed] });
  },
};
