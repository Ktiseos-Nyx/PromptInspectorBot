import { geminiClient, claudeClient, groqClient, GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODELS, GEMINI_MAX_RETRIES, GEMINI_RETRY_DELAY, CLAUDE_PRIMARY_MODEL, GROQ_PRIMARY_MODEL, GROQ_FALLBACK_MODEL } from './config';

// ── Conversation sessions (per user) ─────────────────────────────────────────
const sessions = new Map<string, any>();

// Groq doesn't have a stateful chat object — maintain history manually
type GroqMessage = { role: 'user' | 'assistant' | 'system'; content: string };
const groqSessions = new Map<string, GroqMessage[]>();

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
  if (!geminiClient) throw new Error('Gemini not configured');

  if (!sessions.has(userId)) {
    sessions.set(userId, geminiClient.chats.create({
      model: GEMINI_PRIMARY_MODEL,
      config: {
        systemInstruction: `You are a helpful assistant talking to ${displayName}. Address them by name when appropriate.`,
      },
    }));
  }

  try {
    const chat = sessions.get(userId);
    const response = await chat.sendMessage({ message: question });
    return response.text ?? '';
  } catch (e) {
    sessions.delete(userId); // clear broken session so next call starts fresh
    throw e;
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

// ── Groq: chat with history ───────────────────────────────────────────────────

export async function askGroq(userId: string, displayName: string, question: string): Promise<string> {
  if (!groqClient) throw new Error('Groq not configured');

  if (!groqSessions.has(userId)) {
    groqSessions.set(userId, [{
      role: 'system',
      content: `You are a helpful assistant talking to ${displayName}. Address them by name when appropriate.`,
    }]);
  }

  const history = groqSessions.get(userId)!;
  history.push({ role: 'user', content: question });

  const trim = () => { if (history.length > 21) history.splice(1, history.length - 21); };

  try {
    const response = await groqClient.chat.completions.create({ model: GROQ_PRIMARY_MODEL, messages: history });
    const reply = response.choices[0]?.message?.content ?? '';
    history.push({ role: 'assistant', content: reply });
    trim();
    return reply;
  } catch {
    // Try fallback model once before giving up
    try {
      const response = await groqClient.chat.completions.create({
        model: GROQ_FALLBACK_MODEL,
        messages: history.slice(0, -1),
      });
      const reply = response.choices[0]?.message?.content ?? '';
      history.push({ role: 'assistant', content: reply });
      trim();
      return reply;
    } catch (e) {
      history.pop(); // remove the unanswered user message
      throw e;      // let askWithPriority try the next provider
    }
  }
}

// ── Claude: chat with history ─────────────────────────────────────────────────

type ClaudeMessage = { role: 'user' | 'assistant'; content: string };
const claudeSessions = new Map<string, ClaudeMessage[]>();

export async function askClaude(userId: string, displayName: string, question: string): Promise<string> {
  if (!claudeClient) throw new Error('Claude not configured');

  if (!claudeSessions.has(userId)) claudeSessions.set(userId, []);
  const history = claudeSessions.get(userId)!;
  history.push({ role: 'user', content: question });

  try {
    const response = await claudeClient.messages.create({
      model: CLAUDE_PRIMARY_MODEL,
      max_tokens: 1024,
      system: `You are a helpful assistant talking to ${displayName}. Address them by name when appropriate.`,
      messages: history,
    });
    const reply = (response.content[0] as any).text ?? '';
    history.push({ role: 'assistant', content: reply });
    if (history.length > 20) history.splice(0, history.length - 20);
    return reply;
  } catch (e) {
    history.pop();
    throw e;
  }
}

// ── Claude: single text generation ───────────────────────────────────────────

export async function generateClaude(prompt: string, systemInstruction: string): Promise<string> {
  if (!claudeClient) throw new Error('Claude not configured');

  const response = await claudeClient.messages.create({
    model: CLAUDE_PRIMARY_MODEL,
    max_tokens: 2048,
    system: systemInstruction,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as any).text ?? '';
}

// ── Groq: single text generation (no history) ────────────────────────────────

export async function generateGroq(prompt: string, systemInstruction: string, temperature = 0.7): Promise<string> {
  if (!groqClient) throw new Error('Groq not configured');

  const response = await groqClient.chat.completions.create({
    model: GROQ_PRIMARY_MODEL,
    temperature,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user',   content: prompt },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
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
