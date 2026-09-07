import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 900;
const NAMES = { gemini: 'Gemini', claude: 'Claude', moderator: 'Moderatör' };

function systemPrompt(topic, persona, who) {
  return `${persona || 'Bilgili, açık fikirli bir tartışmacısın.'}

Bu bir yuvarlak masa tartışmasıdır. Katılımcılar: Moderatör (insan, tartışmayı yönetir), Gemini ve Claude.
Sen ${NAMES[who]}'sın. Tartışma konusu: "${topic}"

Kurallar:
- Geçmiş konuşmada mesajlar "Ad: metin" biçiminde etiketlidir. Sen kendi adını başa yazma, doğrudan konuş.
- Diğer katılımcıların söylediklerine somut atıf yap; katılıyorsan neden, katılmıyorsan nerede ayrıldığını söyle.
- Moderatörün son yönlendirmesine öncelik ver.
- Kısa ve öz ol: en fazla 2-3 paragraf. Liste ve başlık kullanma; konuşma dilinde yaz.`;
}

// Transkripti konuşacak modelin gözünden user/assistant sırasına çevirir.
function historyFor(transcript, topic, who) {
  const turns = [];
  for (const m of transcript) {
    const role = m.who === who ? 'assistant' : 'user';
    const text = role === 'assistant' ? m.text : `${NAMES[m.who] || m.who}: ${m.text}`;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += '\n\n' + text;
    else turns.push({ role, text });
  }
  if (turns.length === 0 || turns[0].role === 'assistant') {
    turns.unshift({ role: 'user', text: `Moderatör: Tartışma konusu: ${topic}` });
  }
  if (turns[turns.length - 1].role === 'assistant') {
    turns.push({ role: 'user', text: 'Moderatör: Devam et, eklemek istediğin bir şey var mı?' });
  }
  return turns;
}

async function* streamGemini({ topic, persona, transcript, key }, signal) {
  const ai = new GoogleGenAI({ apiKey: key || process.env.GEMINI_API_KEY });
  const contents = historyFor(transcript, topic, 'gemini').map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.text }],
  }));
  const stream = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents,
    config: { systemInstruction: systemPrompt(topic, persona, 'gemini'), maxOutputTokens: MAX_TOKENS, abortSignal: signal },
  });
  for await (const chunk of stream) if (chunk.text) yield chunk.text;
}

async function* streamClaude({ topic, persona, transcript, key }, signal) {
  const anthropic = new Anthropic({ apiKey: key || process.env.CLAUDE_API_KEY });
  const messages = historyFor(transcript, topic, 'claude').map((t) => ({ role: t.role, content: t.text }));
  const stream = anthropic.messages.stream(
    { model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(topic, persona, 'claude'), messages },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
  }
}

export default async function handler(request) {
  if (request.method === 'GET') {
    return Response.json({ models: { gemini: GEMINI_MODEL, claude: CLAUDE_MODEL }, needsCode: Boolean(process.env.ACCESS_CODE) });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body;
  try { body = await request.json(); } catch { return new Response('Geçersiz istek', { status: 400 }); }
  const { who, topic, persona, transcript, keys = {} } = body || {};
  const ownKey = (keys[who] || '').trim();
  // Kendi anahtarını getiren giriş kodundan muaf; site sahibinin anahtarı için kod zorunlu (tanımlıysa).
  if (process.env.ACCESS_CODE && !ownKey && request.headers.get('x-access-code') !== process.env.ACCESS_CODE) {
    return new Response('Giriş kodu geçersiz. Kurulum bölümünden kodu gir ya da kendi API anahtarını kullan.', { status: 401 });
  }
  if (!['gemini', 'claude'].includes(who) || !topic || !Array.isArray(transcript)) {
    return new Response('Eksik alan: who, topic, transcript', { status: 400 });
  }

  const gen = who === 'gemini'
    ? streamGemini({ topic, persona, transcript, key: ownKey }, request.signal)
    : streamClaude({ topic, persona, transcript, key: ownKey }, request.signal);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      try {
        for await (const piece of gen) send({ t: piece });
        send({ done: true });
      } catch (err) {
        if (!request.signal?.aborted) send({ error: `${NAMES[who]} hatası: ${err.message}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
