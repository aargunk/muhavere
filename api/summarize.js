// Uzun tartışma materyalini masaya konacak yapılandırılmış bir özete indirger.
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const ENV_KEYS = { gemini: 'GEMINI_API_KEY', claude: 'CLAUDE_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };
const ORDER = ['claude', 'deepseek', 'gemini']; // özetleyici tercihi
const INPUT_MAX = 120000;

const PROMPT = `Aşağıdaki belgeyi, bir yuvarlak masa tartışmasında katılımcıların referans alacağı bir özete dönüştür. Türkçe yaz. Belgedeki ifadelere sadık kal, yorum ekleme, olmayan bilgi uydurma.

Biçim (düz metin, başlıklar büyük harf):
ANA TEZ: 2-3 cümle.
TEMEL İDDİALAR: 5-8 madde; her madde tek cümle.
SOMUT VERİLER VE İFADELER: belgedeki sayılar, tarihler, isimler, alıntı değerindeki kısa ifadeler (tırnak içinde, kısa).
VARSAYIMLAR VE BOŞLUKLAR: belgenin dayandığı ama kanıtlamadığı 3-5 nokta.
TARTIŞMAYA AÇIK SORULAR: 3-5 soru.

Toplam 350-550 kelime.`;

async function viaClaude(text, key) {
  const c = new Anthropic({ apiKey: key });
  const r = await c.messages.create({ model: CLAUDE_MODEL, max_tokens: 1800, messages: [{ role: 'user', content: `${PROMPT}\n\n=== BELGE ===\n${text}` }] });
  return r.content.find((b) => b.type === 'text')?.text || '';
}
async function viaDeepSeek(text, key) {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, max_tokens: 1800, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: `${PROMPT}\n\n=== BELGE ===\n${text}` }] }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()).choices?.[0]?.message?.content || '';
}
async function viaGemini(text, key) {
  const ai = new GoogleGenAI({ apiKey: key });
  const r = await ai.models.generateContent({ model: GEMINI_MODEL, contents: `${PROMPT}\n\n=== BELGE ===\n${text}`, config: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'low' } } });
  return r.text || '';
}
const VIA = { claude: viaClaude, deepseek: viaDeepSeek, gemini: viaGemini };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const { text, keys = {} } = body || {};
  if (!text || typeof text !== 'string') return res.status(400).send('text gerekli');

  const hasCode = !process.env.ACCESS_CODE || req.headers['x-access-code'] === process.env.ACCESS_CODE;
  // Kendi anahtarı olan sağlayıcı önce; yoksa site anahtarı (giriş kodu geçerliyse).
  let chosen = null;
  for (const id of ORDER) if ((keys[id] || '').trim()) { chosen = { id, key: keys[id].trim() }; break; }
  if (!chosen && hasCode) for (const id of ORDER) if (process.env[ENV_KEYS[id]]) { chosen = { id, key: process.env[ENV_KEYS[id]] }; break; }
  if (!chosen) return res.status(401).send('Özet için kullanılabilir bir API anahtarı yok (giriş kodu ya da kendi anahtarın gerekli).');

  try {
    const summary = (await VIA[chosen.id](text.slice(0, INPUT_MAX), chosen.key)).trim();
    if (!summary) throw new Error('boş özet döndü');
    return res.status(200).json({ summary, by: chosen.id, chars: summary.length });
  } catch (err) {
    return res.status(500).send(`Özetleme hatası (${chosen.id}): ${err.message}`);
  }
}
