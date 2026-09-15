import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 900;          // Claude: yalnızca görünür cevap
const GEMINI_MAX_TOKENS = 4096;  // Gemini: düşünme tokenları da bu bütçeden düşer
const GEMINI_THINKING = process.env.GEMINI_THINKING || 'low'; // minimal | low | medium | high
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const NAMES = { gemini: 'Gemini', claude: 'Claude', deepseek: 'DeepSeek', moderator: 'Moderatör' };
const MODELS = { gemini: GEMINI_MODEL, claude: CLAUDE_MODEL, deepseek: DEEPSEEK_MODEL };
const ENV_KEYS = { gemini: 'GEMINI_API_KEY', claude: 'CLAUDE_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };
const AI_IDS = ['gemini', 'claude', 'deepseek'];
const MATERIAL_MAX = 60000; // karakter; her istekte tüm materyal gider

function systemPrompt(topic, persona, who, participants, material) {
  const others = participants.filter((p) => p !== who).map((p) => NAMES[p]).join(', ');
  const mat = material ? `\n\n=== TARTIŞMA MATERYALİ (moderatörün masaya koyduğu belge) ===\n${material.slice(0, MATERIAL_MAX)}\n=== MATERYAL SONU ===\nTartışmada bu materyale somut atıf yap; iddialarını materyaldeki ifadelere dayandır.` : '';
  return `${persona || 'Bilgili, açık fikirli bir tartışmacısın.'}

Bu bir yuvarlak masa tartışmasıdır. Katılımcılar: Moderatör (insan, tartışmayı yönetir), ${others} ve sen.
Sen ${NAMES[who]}'sın. Tartışma konusu: "${topic}"

Kurallar:
- Geçmiş konuşmada mesajlar "Ad: metin" biçiminde etiketlidir. Sen kendi adını başa yazma, doğrudan konuş.
- Diğer katılımcıların söylediklerine somut atıf yap; katılıyorsan neden, katılmıyorsan nerede ayrıldığını söyle.
- Moderatörün son yönlendirmesine öncelik ver.
- Kısa ve öz ol: en fazla 2-3 paragraf. Liste ve başlık kullanma; konuşma dilinde yaz.${mat}`;
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

async function* streamGemini({ topic, persona, transcript, key, participants, material }, signal) {
  const ai = new GoogleGenAI({ apiKey: key || process.env.GEMINI_API_KEY });
  const contents = historyFor(transcript, topic, 'gemini').map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.text }],
  }));
  const stream = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: systemPrompt(topic, persona, 'gemini', participants, material),
      maxOutputTokens: GEMINI_MAX_TOKENS,
      thinkingConfig: { thinkingLevel: GEMINI_THINKING },
      abortSignal: signal,
    },
  });
  let finish;
  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
    finish = chunk.candidates?.[0]?.finishReason || finish;
  }
  if (finish && finish !== 'STOP') yield `\n\n[Gemini cevabı burada kesildi: ${finish}]`;
}

async function* streamClaude({ topic, persona, transcript, key, participants, material }, signal) {
  const anthropic = new Anthropic({ apiKey: key || process.env.CLAUDE_API_KEY });
  const messages = historyFor(transcript, topic, 'claude').map((t) => ({ role: t.role, content: t.text }));
  const stream = anthropic.messages.stream(
    { model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, system: systemPrompt(topic, persona, 'claude', participants, material), messages },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
  }
}

async function* streamDeepSeek({ topic, persona, transcript, key, participants }, signal) {
  const messages = [
    { role: 'system', content: systemPrompt(topic, persona, 'deepseek', participants, material) },
    ...historyFor(transcript, topic, 'deepseek').map((t) => ({ role: t.role, content: t.text })),
  ];
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key || process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, max_tokens: MAX_TOKENS, stream: true, thinking: { type: 'disabled' } }),
    signal,
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      const delta = JSON.parse(data).choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

const STREAMERS = { gemini: streamGemini, claude: streamClaude, deepseek: streamDeepSeek };

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const configured = Object.fromEntries(AI_IDS.map((id) => [id, Boolean(process.env[ENV_KEYS[id]])]));
    return res.status(200).json({ models: MODELS, configured, needsCode: Boolean(process.env.ACCESS_CODE) });
  }
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const { who, topic, persona, transcript, keys = {}, participants, material = '' } = body || {};
  if (!AI_IDS.includes(who) || !topic || !Array.isArray(transcript)) {
    return res.status(400).send('Eksik alan: who, topic, transcript');
  }

  const ownKey = (keys[who] || '').trim();
  // Kendi anahtarını getiren giriş kodundan muaf; site sahibinin anahtarı için kod zorunlu (tanımlıysa).
  if (process.env.ACCESS_CODE && !ownKey && req.headers['x-access-code'] !== process.env.ACCESS_CODE) {
    return res.status(401).send('Giriş kodu geçersiz. Kurulum bölümünden kodu gir ya da kendi API anahtarını kullan.');
  }
  if (!ownKey && !process.env[ENV_KEYS[who]]) {
    return res.status(500).send(`${NAMES[who]} için API anahtarı tanımlı değil (Vercel ortam değişkenleri).`);
  }

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (obj) => res.write(JSON.stringify(obj) + '\n');

  const active = Array.isArray(participants) && participants.length ? participants.filter((p) => AI_IDS.includes(p)) : AI_IDS;
  const gen = STREAMERS[who]({ topic, persona, transcript, key: ownKey, participants: active, material: String(material || '') }, ac.signal);

  try {
    for await (const piece of gen) send({ t: piece });
    send({ done: true });
  } catch (err) {
    if (!ac.signal.aborted) send({ error: `${NAMES[who]} hatası: ${err.message}` });
  } finally {
    res.end();
  }
}
