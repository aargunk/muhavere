import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } from 'docx';

const NAMES = { gemini: 'Gemini', claude: 'Claude', deepseek: 'DeepSeek', moderator: 'Moderatör' };
const COLORS = { gemini: '1F5FA8', claude: '2E6B4A', deepseek: '6B3FA0', moderator: '16222B' };
const FONT = 'Calibri';

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, ...(opts.spacing || {}) },
    alignment: opts.align,
    border: opts.border,
    children: [new TextRun({ text, font: FONT, size: opts.size || 22, bold: opts.bold, italics: opts.italics, color: opts.color })],
  });
}

function messageParagraphs(m) {
  const who = NAMES[m.who] || m.who;
  const isMod = m.who === 'moderator';
  const lines = String(m.text).split(/\n+/).filter((l) => l.trim());
  return lines.map((line, i) =>
    new Paragraph({
      spacing: { after: i === lines.length - 1 ? 200 : 80 },
      children: [
        ...(i === 0 ? [new TextRun({ text: `${who}: `, font: FONT, size: 22, bold: true, color: COLORS[m.who] || '000000' })] : []),
        new TextRun({ text: line, font: FONT, size: 22, italics: isMod }),
      ],
    }),
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body) return res.status(400).send('Geçersiz istek');
  const { topic = '', personas = {}, transcript = [], models = {}, materialLabel = '' } = body || {};

  const date = new Date().toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
  const children = [
    p('Yuvarlak Masa Görüşme Notları', { size: 36, bold: true, spacing: { after: 60 } }),
    p(topic, { size: 26, italics: true, spacing: { after: 60 } }),
    p(date, { size: 20, color: '6B7880', spacing: { after: 240 } }),
  ];
  for (const id of ['gemini', 'claude', 'deepseek']) {
    if (personas[id]) children.push(p(`${NAMES[id]} rolü: ${personas[id]}`, { size: 20, color: '444444' }));
  }
  if (materialLabel) children.push(p(`Tartışma materyali: ${materialLabel}`, { size: 20, color: '444444' }));
  const used = [...new Set(transcript.map((m) => m.who))].filter((id) => models[id]).map((id) => `${NAMES[id]}: ${models[id]}`);
  if (used.length) children.push(p(`Modeller — ${used.join(', ')}`, { size: 20, color: '444444' }));
  children.push(new Paragraph({
    spacing: { after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C9D2D7', space: 4 } },
    children: [new TextRun({ text: '' })],
  }));
  transcript.forEach((m) => children.push(...messageParagraphs(m)));

  const doc = new Document({
    creator: 'Yuvarlak Masa',
    title: `Yuvarlak Masa — ${topic}`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });

  const buf = await Packer.toBuffer(doc);
  const fname = `yuvarlak-masa-${new Date().toISOString().slice(0, 10)}.docx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  return res.status(200).send(buf);
}
