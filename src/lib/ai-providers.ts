import { geminiClient, claudeClient, GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODELS, GEMINI_MAX_RETRIES, GEMINI_RETRY_DELAY, CLAUDE_PRIMARY_MODEL } from './config';

// ── Conversation sessions (per user) ─────────────────────────────────────────
const sessions = new Map<string, any>();

// ── Gemini retry/fallback wrapper ─────────────────────────────────────────────

type GeminiCallFactory = (model: string) => () => Promise<any>;

export async function callGeminiWithRetry(
  factory: GeminiCallFactory,
  maxRetries = GEMINI_MAX_RETRIES,
  baseDelay = GEMINI_RETRY_DELAY,
  fallbackModels = GEMINI_FALLBACK_MODELS,
): Promise<any> {
  let lastError: unknown;

  for (let mi = 0; mi < fallbackModels.length; mi++) {
    const model = fallbackModels[mi];
    if (mi > 0) console.log(`Trying fallback model: ${model}`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await factory(model)();
      } catch (e: any) {
        lastError = e;
        const msg = String(e).toLowerCase();
        const isServiceError = ['503', 'service unavailable', 'overloaded', 'rate limit', '429'].some(k => msg.includes(k));

        if (isServiceError && attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt) * 1000;
          console.warn(`Gemini error (${model}, attempt ${attempt + 1}), retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        } else if (isServiceError) {
          break; // try next model
        } else {
          throw e; // non-retriable
        }
      }
    }
  }

  throw lastError;
}

// ── Ask (chat with memory) ────────────────────────────────────────────────────

export async function askGemini(userId: string, displayName: string, question: string): Promise<string> {
  if (!geminiClient) return '❌ Gemini API key is not configured.';

  try {
    if (!sessions.has(userId)) {
      sessions.set(userId, geminiClient.chats.create({
        model: GEMINI_PRIMARY_MODEL,
        config: {
          systemInstruction: `You are a helpful assistant talking to ${displayName}. Address them by name when appropriate.`,
        },
      }));
    }

    const chat = sessions.get(userId);
    const response = await chat.sendMessage({ message: question });
    return response.text ?? '❌ No response text.';
  } catch (e) {
    console.error('askGemini error:', e);
    return `❌ Error generating response: ${e}`;
  }
}

// ── Describe image (vision) ───────────────────────────────────────────────────

export async function describeWithGemini(imageData: Buffer, mimeType: string, prompt: string): Promise<string> {
  if (!geminiClient) throw new Error('Gemini not configured');
  const client = geminiClient;

  const base64 = imageData.toString('base64');
  const response = await callGeminiWithRetry(model => async () =>
    client.models.generateContent({
      model,
      contents: [
        { text: prompt },
        { inlineData: { mimeType, data: base64 } },
      ],
      config: {
        safetySettings: [
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' as any, threshold: 'BLOCK_ONLY_HIGH' as any },
          { category: 'HARM_CATEGORY_HATE_SPEECH' as any, threshold: 'BLOCK_ONLY_HIGH' as any },
          { category: 'HARM_CATEGORY_HARASSMENT' as any, threshold: 'BLOCK_ONLY_HIGH' as any },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT' as any, threshold: 'BLOCK_ONLY_HIGH' as any },
        ],
      },
    })
  );

  return response.text ?? '';
}

export async function describeWithClaude(imageData: Buffer, mimeType: string, prompt: string): Promise<string> {
  if (!claudeClient) throw new Error('Claude not configured');

  const base64 = imageData.toString('base64');
  const response = await claudeClient.messages.create({
    model: CLAUDE_PRIMARY_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  return (response.content[0] as any).text ?? '';
}

// ── Generic text generation ───────────────────────────────────────────────────

export async function generateGemini(prompt: string, systemInstruction: string, temperature = 0.7): Promise<string> {
  if (!geminiClient) throw new Error('Gemini not configured');
  const client = geminiClient;

  const response = await callGeminiWithRetry(model => async () =>
    client.models.generateContent({
      model,
      contents: prompt,
      config: { systemInstruction, temperature },
    })
  );

  return response.text ?? '';
}
