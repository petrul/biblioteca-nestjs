import { MemTextItem, TextItem, TextSplitter } from './model';

export interface ParagraphSplitterOptions {
  /** Longest passage, in characters. Default 2000. */
  maxChars?: number;
  /** Characters of the previous passage repeated at the start of the next one. Default 200. */
  overlapChars?: number;
}

/**
 * Splits on blank lines, then packs paragraphs into passages of at most
 * maxChars (a longer paragraph is cut at sentence or word boundaries).
 * Passage ids hash the item's id, the passage's position and its text, so an
 * unchanged page keeps its vectors; the url gains '#passage-N'.
 */
export class ParagraphSplitter implements TextSplitter {
  private readonly maxChars: number;
  private readonly overlapChars: number;

  constructor(options: ParagraphSplitterOptions = {}) {
    this.maxChars = options.maxChars ?? 2000;
    this.overlapChars = Math.min(options.overlapChars ?? 200, Math.floor(this.maxChars / 2));
  }

  async split(item: TextItem): Promise<TextItem[]> {
    const text = await item.getText();
    if (text.length <= this.maxChars) return text.trim() ? [item] : []; // a passage already
    const pieces = text.split(/\n\s*\n/).map((it) => it.replace(/\s+/g, ' ').trim()).filter(Boolean)
      .flatMap((paragraph) => this.cut(paragraph));
    const passages: string[] = [];
    let current = '';
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > this.maxChars) {
        passages.push(current);
        const tail = current.slice(-this.overlapChars);
        current = tail && tail.length + 1 + piece.length <= this.maxChars ? `${tail} ${piece}` : piece;
      } else {
        current = current ? `${current} ${piece}` : piece;
      }
    }
    if (current) passages.push(current);
    return passages.map((passage, idx) => this.passage(item, passage, idx));
  }

  private passage(item: TextItem, text: string, idx: number): TextItem {
    return new MemTextItem(item.sourceId, `${item.url}#passage-${idx + 1}`, text,
      { ...item.metadata, parent_id: item.id, parent_url: item.url, passage: idx + 1 },
      { id: MemTextItem.computeHash(`${item.id}#${idx}`, text), title: item.title, language: item.language });
  }

  /** A paragraph longer than maxChars, cut at sentence ends, else spaces, else anywhere. */
  private cut(paragraph: string): string[] {
    const result: string[] = [];
    let rest = paragraph;
    while (rest.length > this.maxChars) {
      const window = rest.slice(0, this.maxChars);
      const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
      const at = sentenceEnd > this.maxChars / 2 ? sentenceEnd + 1 : window.lastIndexOf(' ') > this.maxChars / 2 ? window.lastIndexOf(' ') : this.maxChars;
      result.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) result.push(rest);
    return result;
  }
}
