const LF = '\n';

export class TextPos {
  static #defaultSegmenter = null;

  #text;
  #lineStarts;
  #segmenter;

  static #getDefaultSegmenter() {
    if (!TextPos.#defaultSegmenter) {
      TextPos.#defaultSegmenter = new Intl.Segmenter(undefined, {
        granularity: 'grapheme'
      });
    }
    return TextPos.#defaultSegmenter;
  }

  static #resolveSegmenter(segmenter) {
    if (segmenter === null || segmenter === undefined) {
      return TextPos.#getDefaultSegmenter();
    }

    if (!(segmenter instanceof Intl.Segmenter)) {
      throw new TypeError('segmenter must be an Intl.Segmenter instance or null.');
    }

    const { granularity } = segmenter.resolvedOptions();
    if (granularity !== 'grapheme') {
      throw new Error(
        `Invalid segmenter granularity "${granularity}": expected "grapheme".`
      );
    }

    return segmenter;
  }

  constructor(text, segmenter = null) {
    if (typeof text !== 'string') {
      throw new TypeError('Text must be a string.');
    }

    this.#text = text;
    this.#segmenter = TextPos.#resolveSegmenter(segmenter);
    this.#lineStarts = this.#buildLineStarts(text);
  }

  get segmenter() {
    return this.#segmenter;
  }

  indexToRowCol(index) {
    const clamped = Math.max(0, Math.min(this.#text.length, index));
    const rowIndex = this.#findRowIndex(clamped);
    const lineStart = this.#lineStarts[rowIndex];
    const lineSlice = this.#text.slice(lineStart, clamped);

    let col = 1;
    for (const _ of this.#segmenter.segment(lineSlice)) {
      col++;
    }

    return { row: rowIndex + 1, col };
  }

  rowColToIndex(row, col) {
    const rowIndex = Math.max(0, Math.min(this.#lineStarts.length - 1, row - 1));
    const lineStart = this.#lineStarts[rowIndex];
    const lineEnd =
      rowIndex + 1 < this.#lineStarts.length
        ? this.#lineStarts[rowIndex + 1] - 1
        : this.#text.length;

    const targetColOffset = Math.max(0, col - 1);
    if (targetColOffset === 0) {
      return lineStart;
    }

    const lineSlice = this.#text.slice(lineStart, lineEnd);
    let count = 0;
    let offset = 0;

    for (const part of this.#segmenter.segment(lineSlice)) {
      if (count >= targetColOffset) {
        break;
      }
      offset += part.segment.length;
      count++;
    }

    return Math.min(lineEnd, lineStart + offset);
  }

  #buildLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === LF) {
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
