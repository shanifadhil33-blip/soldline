import { extractText, getDocumentProxy } from 'unpdf';
export type Page = { page: number; text: string };
export type Item = { title: string; quantity: number; cadence: 'once'|'monthly'|'weekly'; page: number; quote: string; sku?: string };
export async function pdfPages(bytes: Uint8Array): Promise<Page[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const result = await extractText(pdf, { mergePages: false });
    return result.text.map((text, i) => ({ page: i + 1, text }));
  } finally { await pdf.loadingTask.destroy(); }
}
export const imperative = /(?:\b(?:system|agent|model|assistant|you)\b.{0,35}\b(?:ignore|override|delete|approve|send|reveal|forget|must|should|execute|run|call|transfer|install)\b|\b(?:ignore|override|forget|disregard)\b.{0,50}\b(?:instructions?|system|rules?|previous)\b|(?:تجاهل|تجاوز).{0,35}(?:التعليمات|النظام))/i;
export function instructions(pages: Page[]) {
  return pages.flatMap(p => p.text.split(/[\n.!?]+/).map(s => s.trim()).filter(s => imperative.test(s)).map(quote => ({ page:p.page, quote })));
}
const numbers: Record<string,number> = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
export function describe(title: string) {
  const quantity = title.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[1].toLowerCase();
  return { quantity: quantity ? numbers[quantity] ?? Number(quantity) : 1,
    cadence: /monthly|a month|per month|شهري|شهر/i.test(title) ? 'monthly' as const : /weekly|a week|per week|أسبوع/i.test(title) ? 'weekly' as const : 'once' as const };
}
export function parse(pages: Page[]): Item[] {
  const items: Item[] = [];
  let active = false;
  for (const p of pages) {
    for (const line of p.text.split('\n')) {
      if (imperative.test(line)) continue;
      if (/^\s*(?:#+\s*)?(?:deliverables|scope of work|نطاق العمل|المخرجات|التسليمات)\s*[:：]?\s*$/i.test(line)) { active = true; continue; }
      const match = line.match(/^\s*(?:[0-9٠-٩]+[.)、]?\s+|[•*\u002d]\s+)(.+?)\s*$/u);
      if (active && match && !imperative.test(line)) items.push({title:match[1],...describe(match[1]),page:p.page,quote:line.trim()});
      else if (active && line.trim() && !/^page \d/i.test(line)) active = false;
    }
  }
  return items;
}
export function grounded(items: Item[], pages: Page[]): Item[] {
  return items.filter(i => i.quote.trim().length > 0 && pages.some(p => p.page === i.page && p.text.includes(i.quote)) && i.quote.toLowerCase().includes(i.title.toLowerCase()) && describe(i.title).quantity === i.quantity && describe(i.title).cadence === i.cadence && !imperative.test(i.quote) && !imperative.test(i.title));
}
