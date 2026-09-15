// Link veya dosyadan düz metin çıkarır: HTML, PDF, DOCX, TXT/MD.
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const MAX_CHARS = 80000;

function htmlToText(html) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '';
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return { title, text: t };
}

async function fromBuffer(buf, kind) {
  if (kind === 'pdf') return { text: (await pdfParse(buf)).text };
  if (kind === 'docx') return { text: (await mammoth.extractRawText({ buffer: buf })).value };
  if (kind === 'html') return htmlToText(buf.toString('utf8'));
  return { text: buf.toString('utf8') };
}

function kindOf(name = '', contentType = '') {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || contentType.includes('pdf')) return 'pdf';
  if (n.endsWith('.docx') || contentType.includes('wordprocessingml')) return 'docx';
  if (contentType.includes('html') || n.endsWith('.html') || n.endsWith('.htm')) return 'html';
  return 'text';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body) return res.status(400).send('Geçersiz istek');

  try {
    let result, label;
    if (body.url) {
      const url = String(body.url).trim();
      if (!/^https?:\/\//i.test(url)) return res.status(400).send('Link http:// veya https:// ile başlamalı.');
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (YuvarlakMasa)' }, redirect: 'follow' });
      if (!r.ok) return res.status(400).send(`Link alınamadı: ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      result = await fromBuffer(buf, kindOf(url, r.headers.get('content-type') || ''));
      label = result.title ? `${result.title} — ${url}` : url;
    } else if (body.base64 && body.name) {
      const buf = Buffer.from(body.base64, 'base64');
      result = await fromBuffer(buf, kindOf(body.name));
      label = body.name;
    } else {
      return res.status(400).send('url ya da (name + base64) gerekli.');
    }
    let text = (result.text || '').replace(/\r/g, '').trim();
    if (!text) return res.status(422).send('Metin çıkarılamadı (taranmış PDF veya boş sayfa olabilir).');
    const truncated = text.length > MAX_CHARS;
    if (truncated) text = text.slice(0, MAX_CHARS);
    return res.status(200).json({ text, label, chars: text.length, truncated });
  } catch (err) {
    return res.status(500).send('Çıkarma hatası: ' + err.message);
  }
}
