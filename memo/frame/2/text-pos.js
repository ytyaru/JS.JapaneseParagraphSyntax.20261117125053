export class TextPos {
  #text;
  #countGraphemes;
  #lineStarts;
  #segmenter;

  constructor(text, { countGraphemes = true, segmenter = null } = {}) {
    if (typeof text !== 'string') {
      throw new TypeError('Text must be a string.');
    }

    this.#text = text;
    this.#countGraphemes = Boolean(countGraphemes);
    this.#lineStarts = this.#buildLineStarts(text);

    if (!this.#countGraphemes) {
      this.#segmenter = null;
    } else if (segmenter) {
      this.#segmenter = segmenter;
    } else {
      this.#segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    }
  }

  get segmenter() {
    return this.#segmenter;
  }

  indexToRowCol(index) {
    const clamped = Math.max(0, Math.min(this.#text.length, index));
    const rowIndex = this.#findRowIndex(clamped);
    const lineStart = this.#lineStarts[rowIndex];
    const lineSlice = this.#text.slice(lineStart, clamped);

    const col = this.#countGraphemes && this.#segmenter
      ? [...this.#segmenter.segment(lineSlice)].length + 1
      : lineSlice.length + 1;

    return { row: rowIndex + 1, col };
  }

  rowColToIndex(row, col) {
    const rowIndex = Math.max(0, Math.min(this.#lineStarts.length - 1, row - 1));
    const lineStart = this.#lineStarts[rowIndex];
    const lineEnd = rowIndex + 1 < this.#lineStarts.length
      ? this.#lineStarts[rowIndex + 1] - 1
      : this.#text.length;

    const targetColOffset = Math.max(0, col - 1);
    if (targetColOffset === 0) return lineStart;

    const lineSlice = this.#text.slice(lineStart, lineEnd);
    if (!this.#countGraphemes || !this.#segmenter) {
      return Math.min(lineEnd, lineStart + targetColOffset);
    }

    let count = 0;
    let offset = 0;
    for (const part of this.#segmenter.segment(lineSlice)) {
      if (count >= targetColOffset) break;
      offset += part.segment.length;
      count++;
    }
    return Math.min(lineEnd, lineStart + offset);
  }

  #buildLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        starts.push(i + 1);
      }
    }
    return starts;
  }

  #findRowIndex(offset) {
    let low = 0;
    let high = this.#lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.#lineStarts[mid] <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(0, high);
  }
}
