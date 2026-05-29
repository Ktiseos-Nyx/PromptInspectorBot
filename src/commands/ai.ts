import { ChatInputCommandInteraction, AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { geminiRateLimiter, LLM_PROVIDER_PRIORITY, AVAILABLE_PROVIDERS, NSFW_PROVIDER_OVERRIDE, SCAN_LIMIT_BYTES } from '../lib/config';
import { getGuildSetting } from '../lib/guild-settings';
import { askGemini, askGroq, describeWithGemini, describeWithClaude, generateGemini, generateGroq } from '../lib/ai-providers';

// Try each provider in priority order for chat (stateful per-user session)
async function askWithPriority(userId: string, displayName: string, question: string): Promise<string> {
  for (const provider of LLM_PROVIDER_PRIORITY) {
    try {
      if (provider === 'groq')   return await askGroq(userId, displayName, question);
      if (provider === 'gemini') return await askGemini(userId, displayName, question);
    } catch (e) {
      console.warn(`${provider} failed for /ask:`, e);
    }
  }
  return '❌ All AI providers failed. Try again in a moment.';
}

// Try each provider in priority order for single-shot text generation
async function generateWithPriority(prompt: string, system: string, temperature = 0.7): Promise<string> {
  for (const provider of LLM_PROVIDER_PRIORITY) {
    try {
      if (provider === 'groq')   return await generateGroq(prompt, system, temperature);
      if (provider === 'gemini') return await generateGemini(prompt, system, temperature);
    } catch (e) {
      console.warn(`${provider} failed for text generation:`, e);
    }
  }
  throw new Error('All AI providers failed');
}

const TECHSUPPORT_PROMPT = `You are a friendly and knowledgeable IT support assistant. Your goal is to help people solve their tech problems clearly and without judgment.

APPROACH:
- Start with the simple stuff first — most problems have simple causes, and there's no shame in that
- Walk through solutions step by step
- Explain what you're doing and why, so the person learns something
- If you need more information to help, ask specific questions
- If you don't know the answer, say so honestly and suggest where to look

TONE:
- Warm and approachable, never condescending
- Encouraging when someone has already tried troubleshooting
- Patient with all skill levels
- Keep responses concise unless the problem genuinely needs detail

If the issue is outside your knowledge, say so and point them toward a useful resource.`;

const CODER_PROMPT = `You are a helpful programming assistant focused on practical, working solutions.

- Provide complete, runnable code when possible, formatted in Discord code blocks with the language specified
- Briefly explain what the code does and why, not just how
- Note any important edge cases, gotchas, or dependencies
- Use modern best practices for the language in question
- If the question is ambiguous, ask for clarification before assuming
- Keep explanations concise — lead with the solution, follow with the explanation`;

const PROMPT_SUPPORT_NATURAL = `You are a helpful assistant that writes image generation prompts in natural language for tools like Stable Diffusion, Flux, and similar AI image generators.

The user will describe what they want to create. Your job is to expand their idea into a well-structured, detailed prompt that will produce good results.

GUIDELINES:
- Write in flowing descriptive prose, not tags
- Include subject, setting, lighting, mood, and style details where relevant
- Keep it focused — don't pad with generic filler like "masterpiece" or "best quality"
- If the user's description is vague, make reasonable creative choices and briefly note what you assumed
- Output the prompt itself first, then optionally 1-2 short notes on how to adjust it

Do not add disclaimers or caveats about what AI can or can't do. Just write the prompt.`;

const PROMPT_SUPPORT_DANBOORU = `You are a helpful assistant that writes image generation prompts as Danbooru-style tag lists for tools like Stable Diffusion and similar AI image generators.

The user will describe what they want to create. Your job is to translate their idea into a well-chosen comma-separated tag list.

GUIDELINES:
- Use standard Danbooru tag conventions (underscores for multi-word tags, e.g. long_hair, blue_eyes)
- Order tags by importance: subject first, then clothing/features, then setting, then style/quality
- Include artist-style tags or medium tags if relevant (e.g. watercolor, oil_painting)
- Avoid vague quality boosters like "masterpiece" unless the user specifically wants them
- If the description is vague, make reasonable creative choices and briefly note what you filled in
- Output the tag list first, then optionally 1-2 short notes on adjustments

Do not add disclaimers. Just write the tags.`;

async function sendLong(interaction: ChatInputCommandInteraction, content: string, filename: string): Promise<void> {
  if (content.length <= 2000) {
    await interaction.followUp(content);
  } else {
    const file = new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: filename });
    await interaction.followUp({ content: 'Response too long — sent as file:', files: [file] });
  }
}

export const askCommand = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask a question to the bot')
    .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.guild && !getGuildSetting(interaction.guildId!, 'ask')) {
      return interaction.reply({ content: '❌ `/ask` is not enabled in this server.', ephemeral: true });
    }
    if (geminiRateLimiter.isRateLimited(interaction.user.id)) {
      return interaction.reply({ content: '⏰ Slow down! 1 request per 10 seconds.', ephemeral: true });
    }

    const question = interaction.options.getString('question', true);
    if (question.length > 2000) return interaction.reply({ content: '❌ Question too long (max 2000 chars).', ephemeral: true });

    await interaction.deferReply();
    const response = await askWithPriority(interaction.user.id, interaction.user.displayName, question);
    await sendLong(interaction, response, 'response.txt');
  },
};

export const techsupportCommand = {
  data: new SlashCommandBuilder()
    .setName('techsupport')
    .setDescription('Get IT help with personality')
    .addStringOption(o => o.setName('issue').setDescription('Describe your issue').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.guild && !getGuildSetting(interaction.guildId!, 'techsupport')) {
      return interaction.reply({ content: '❌ `/techsupport` is not enabled in this server.', ephemeral: true });
    }
    if (geminiRateLimiter.isRateLimited(interaction.user.id)) {
      return interaction.reply({ content: '⏰ Slow down! 1 request per 10 seconds.', ephemeral: true });
    }

    const issue = interaction.options.getString('issue', true);
    if (issue.length > 2000) return interaction.reply({ content: '❌ Issue description too long.', ephemeral: true });

    await interaction.deferReply();
    try {
      const response = await generateWithPriority(issue, TECHSUPPORT_PROMPT, 0.8);
      await sendLong(interaction, `🛠️ **Tech Support:**\n\n${response}`, 'techsupport.txt');
    } catch (e) {
      await interaction.followUp('❌ My troubleshooting brain just crashed. Try again in a sec.');
    }
  },
};

export const coderCommand = {
  data: new SlashCommandBuilder()
    .setName('coder')
    .setDescription('Get coding help and solutions')
    .addStringOption(o => o.setName('question').setDescription('Your coding question').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.guild && !getGuildSetting(interaction.guildId!, 'coder')) {
      return interaction.reply({ content: '❌ `/coder` is not enabled in this server.', ephemeral: true });
    }
    if (geminiRateLimiter.isRateLimited(interaction.user.id)) {
      return interaction.reply({ content: '⏰ Slow down! 1 request per 10 seconds.', ephemeral: true });
    }

    const question = interaction.options.getString('question', true);
    if (question.length > 2000) return interaction.reply({ content: '❌ Question too long.', ephemeral: true });

    await interaction.deferReply();
    try {
      const response = await generateWithPriority(question, CODER_PROMPT, 0.7);
      await sendLong(interaction, `💻 **Coding Help:**\n\n${response}`, 'coder.txt');
    } catch (e) {
      await interaction.followUp('❌ Error generating code solution. Please try again.');
    }
  },
};

export const describeCommand = {
  data: new SlashCommandBuilder()
    .setName('describe')
    .setDescription('Describe an image using AI')
    .addStringOption(o =>
      o.setName('style')
        .setDescription('Description style')
        .setRequired(true)
        .addChoices(
          { name: 'Danbooru Tags', value: 'danbooru' },
          { name: 'Natural Language', value: 'natural' },
        )
    )
    .addAttachmentOption(o => o.setName('image').setDescription('Image to describe'))
    .addBooleanOption(o => o.setName('private').setDescription('Only you can see the response')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (interaction.guild && !getGuildSetting(interaction.guildId!, 'describe', true)) {
      return interaction.reply({ content: '❌ `/describe` is not enabled in this server.', ephemeral: true });
    }
    if (geminiRateLimiter.isRateLimited(interaction.user.id)) {
      return interaction.reply({ content: '⏰ Slow down! 1 request per 10 seconds.', ephemeral: true });
    }

    const style = interaction.options.getString('style', true);
    const image = interaction.options.getAttachment('image');
    const ephemeral = interaction.options.getBoolean('private') ?? false;

    if (!image) return interaction.reply({ content: '❌ Please attach an image.', ephemeral: true });
    if (!image.contentType?.startsWith('image/')) return interaction.reply({ content: '❌ Please provide a valid image file.', ephemeral: true });
    if (image.size > SCAN_LIMIT_BYTES) return interaction.reply({ content: `❌ File too large (max ${SCAN_LIMIT_BYTES / 1024 / 1024}MB).`, ephemeral: true });

    await interaction.deferReply({ ephemeral });

    const prompt = style === 'danbooru'
      ? "Describe this image using Danbooru-style tags in comma-separated format. Output ONLY the tags separated by commas, no explanations. Focus on character, clothing, pose, background, and art style. Exclude quality meta-tags."
      : "Describe this image in natural, descriptive language.";

    try {
      const imageData = Buffer.from(await (await fetch(image.url)).arrayBuffer());
      let description: string | undefined;
      let providerUsed = '';

      const providers = NSFW_PROVIDER_OVERRIDE && AVAILABLE_PROVIDERS.includes(NSFW_PROVIDER_OVERRIDE)
        ? [NSFW_PROVIDER_OVERRIDE]
        : LLM_PROVIDER_PRIORITY;

      for (const provider of providers) {
        try {
          if (provider === 'gemini') {
            description = await describeWithGemini(imageData, image.contentType!, prompt);
            providerUsed = 'Gemini';
          } else if (provider === 'claude') {
            description = await describeWithClaude(imageData, image.contentType!, prompt);
            providerUsed = 'Claude';
          }
          if (description) break;
        } catch (e) {
          console.warn(`${provider} failed for /describe:`, e);
        }
      }

      if (!description) {
        return interaction.followUp('❌ All AI providers failed. Try again or try a different image.');
      }

      const styleName = style === 'danbooru' ? 'Danbooru Tags' : 'Natural Language';
      const content = `🎨 **Image Description (${styleName})** _via ${providerUsed}_\n\n${description}`;
      await sendLong(interaction, content, 'description.txt');
    } catch (e) {
      await interaction.followUp(`❌ Error generating description: ${e}`);
    }
  },
};

export const promptSupportCommand = {
  data: new SlashCommandBuilder()
    .setName('promptsupport')
    .setDescription('Get help writing an AI image generation prompt')
    .addStringOption(o =>
      o.setName('style')
        .setDescription('Prompt style')
        .setRequired(true)
        .addChoices(
          { name: 'Natural Language', value: 'natural' },
          { name: 'Danbooru Tags', value: 'danbooru' },
        )
    )
    .addStringOption(o =>
      o.setName('description')
        .setDescription('Describe what you want to create')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (geminiRateLimiter.isRateLimited(interaction.user.id)) {
      return interaction.reply({ content: '⏰ Slow down! 1 request per 10 seconds.', ephemeral: true });
    }

    const style = interaction.options.getString('style', true);
    const description = interaction.options.getString('description', true);

    if (description.length > 2000) {
      return interaction.reply({ content: '❌ Description too long (max 2000 characters).', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const systemPrompt = style === 'danbooru' ? PROMPT_SUPPORT_DANBOORU : PROMPT_SUPPORT_NATURAL;
      const styleName = style === 'danbooru' ? 'Danbooru Tags' : 'Natural Language';

      const result = await generateWithPriority(description, systemPrompt, 0.8);
      const content = `✨ **Prompt Suggestion (${styleName})**\n\n${result}`;
      await sendLong(interaction, content, 'prompt.txt');
    } catch (e) {
      await interaction.followUp(`❌ Error generating prompt suggestion: ${e}`);
    }
  },
};
