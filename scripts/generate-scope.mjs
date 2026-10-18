import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
const text = await readFile(new URL('./fixtures/harbor-scope.md', import.meta.url), 'utf8');
const pages = text.split('PAGE BREAK');
if (pages.length !== 3 || /[\u002d\u2013\u2014&]/.test(pages.join(''))) throw new Error('Scope text is invalid');
const pdf = await PDFDocument.create();
pdf.setTitle('Harbor Coffee Roasters signed scope');
pdf.setAuthor('Soldline sample data');
pdf.setCreationDate(new Date('2026-10-18T00:00:00Z'));
pdf.setModificationDate(new Date('2026-10-18T00:00:00Z'));
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const [index, body] of pages.entries()) {
  const page = pdf.addPage([595.28, 841.89]);
  let y = 775;
  for (const line of body.trim().split('\n')) {
    const heading = line.startsWith('# ');
    page.drawText(line.replace(/^# /, ''), { x: 48, y, size: heading ? 20 : 12, font });
    y -= heading ? 42 : 28;
  }
  page.drawText(`Page ${index + 1} of 3`, { x: 48, y: 40, size: 10, font });
}
await writeFile(new URL('../tests/fixtures/harbor-scope.pdf', import.meta.url), await pdf.save());
