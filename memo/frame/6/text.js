export class TextLineDiffError extends Error {
  constructor(message = 'Text was modified during newline normalization.') {
    super(message);
    this.name = 'TextLineDiffError';
  }
}
class SegMan {
    static #default = null;
    static #use = null;
    static get default() {return (this.#default ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' }));}
    static get use() {return this.#use}
    static #validate(segmenter) {
        if (segmenter === null || segmenter === undefined) { return this.default; }
        if (!(segmenter instanceof Intl.Segmenter)) { throw new TypeError('segmenter must be an Intl.Segmenter instance or null.'); }
        const { granularity } = segmenter.resolvedOptions();
        if (granularity !== 'grapheme') { throw new Error(`Invalid segmenter granularity "${granularity}": expected "grapheme".`); }
        return segmenter;
    }
    constructor(segmenter) {this.#use = this.#validate(segmenter);}
}
export class Text {
  static #LF = '\n';
  static #CRLF = /\r\n/g;
  static get LF() { return Text.#LF; }
  static normalize(text) {
    if (typeof text !== 'string') { throw new TypeError('Input text must be a string.'); }
    return text.replace(Text.#CRLF, Text.#LF);
  }
  #string;
  #isDiff;
  #segmenter;
  constructor(text, segmenter = null) {
    if (typeof text !== 'string') { throw new TypeError('Text must be a string.'); }
    this.#seg = new SegMan(segmenter);
    this.#string = Text.normalize(text);
    this.#isDiff = text !== this.#string;
  }
  get string() { return this.#string; }
  get LF() { return Text.#LF; }
  get isDiff() { return this.#isDiff; }
  get seg() { return this.#seg; }
  valid() { if (this.#isDiff) { throw new TextLineDiffError(); } }
}

export class TextPos {
  #text;
  #lineStarts;

  constructor(text) {
    if (!(text instanceof Text)) { throw new TypeError('text must be an instance of Text.'); }
    this.#text = text;
    this.#lineStarts = this.#buildLineStarts(text.string);
  }

  get text() { return this.#text; }
//  get segmenter() { return this.#text.segmenter; }

  indexToRowCol(index) {
    const str = this.#text.string;
    const clamped = Math.max(0, Math.min(str.length, index));
    const rowIndex = this.#findRowIndex(clamped);
    const lineStart = this.#lineStarts[rowIndex];
    const lineSlice = str.slice(lineStart, clamped);

    let col = 1;
    for (const _ of this.segmenter.segment(lineSlice)) { col++; }

    return { row: rowIndex + 1, col };
  }

  rowColToIndex(row, col) {
    const str = this.#text.string;
    const rowIndex = Math.max(0, Math.min(this.#lineStarts.length - 1, row - 1));
    const lineStart = this.#lineStarts[rowIndex];
    const lineEnd = rowIndex + 1 < this.#lineStarts.length
      ? this.#lineStarts[rowIndex + 1] - 1
      : str.length;

    const targetColOffset = Math.max(0, col - 1);
    if (targetColOffset === 0) { return lineStart; }

    const lineSlice = str.slice(lineStart, lineEnd);
    let count = 0;
    let offset = 0;

    for (const part of this.segmenter.segment(lineSlice)) {
      if (count >= targetColOffset) { break; }
      offset += part.segment.length;
      count++;
    }

    return Math.min(lineEnd, lineStart + offset);
  }

  #buildLineStarts(str) {
    const starts = [0];
    const lf = this.#text.LF;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === lf) { starts.push(i + 1); }
    }
    return starts;
  }

  #findRowIndex(offset) {
    let low = 0;
    let high = this.#lineStarts.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.#lineStarts[mid] <= offset) { low = mid + 1; }
      else { high = mid - 1; }
    }

    return Math.max(0, high);
  }
}
