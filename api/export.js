import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } from 'docx';

const NAMES = { gemini: 'Gemini', claude: 'Claude', moderator: 'Moderatör' };
const COLORS = { gemini: '1F5FA8', claude: '2E6B4A', moderator: '16222B' };
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

export default async function handler(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await request.json(); } catch { return new Response('Geçersiz istek', { status: 400 }); }
  const { topic = '', personas = {}, transcript = [], models = {} } = body || {};

  const date = new Date().toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
  const children = [
    p('Yuvarlak Masa Görüşme Notları', { size: 36, bold: true, spacing: { after: 60 } }),
    p(topic, { size: 26, italics: true, spacing: { after: 60 } }),
    p(date, { size: 20, color: '6B7880', spacing: { after: 240 } }),
  ];
  if (personas.gemini) children.push(p(`Gemini rolü: ${personas.gemini}`, { size: 20, color: '444444' }));
  if (personas.claude) children.push(p(`Claude rolü: ${personas.claude}`, { size: 20, color: '444444' }));
  if (models.gemini || models.claude) children.push(p(`Modeller: ${[models.gemini, models.claude].filter(Boolean).join(', ')}`, { size: 20, color: '444444' }));
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
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fname}"`,
    },
  });
}
