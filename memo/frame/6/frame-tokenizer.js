const MIN_FENCE_LEN = 3;

export class FrameSyntaxError extends Error {
  constructor(message, index) {
    super(`${message} (index: ${index})`);
    this.name = 'FrameSyntaxError';
    this.index = index;
  }
}

export class MetaCharSet {
  #chars;

  constructor(metaChars) {
    const flat = metaChars.flat();
    if (flat.length === 0) {
      throw new Error('At least one meta character is required.');
    }

    const chars = new Set();
    for (const ch of flat) {
      if (typeof ch !== 'string' || ch.length !== 1) {
        throw new Error(`Invalid meta character: "${ch}"`);
      }
      const code = ch.charCodeAt(0);
      if (
        (code >= 0xD800 && code <= 0xDFFF) ||
        ch === Text.LF ||
        code < 0x20 ||
        code === 0x7F ||
        /\s/u.test(ch)
      ) {
        throw new Error(`Meta character cannot be whitespace, control char, or surrogate: "${ch}"`);
      }
      chars.add(ch);
    }

    this.#chars = chars;
  }

  has(ch) {
    return this.#chars.has(ch);
  }
}

/**
 * Text 上の現在位置（インデックス）を操作・走査するクラス。
 */
export class Cursor {
  #text;
  #str;
  #pos;

  constructor(text, pos = 0) {
    if (!(text instanceof Text)) {
      throw new TypeError('text must be an instance of Text.');
    }
    if (!Number.isInteger(pos) || pos < 0 || pos > text.string.length) {
      throw new RangeError('pos is out of bounds.');
    }
    this.#text = text;
    this.#str = text.string;
    this.#pos = pos;
  }

  get text() {
    return this.#text;
  }

  get pos() {
    return this.#pos;
  }

  get length() {
    return this.#str.length;
  }

  get eof() {
    return this.#pos >= this.#str.length;
  }

  peek(offset = 0) {
    const idx = this.#pos + offset;
    return idx >= 0 && idx < this.#str.length ? this.#str[idx] : '';
  }

  advance(count = 1) {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError('count must be a non-negative integer.');
    }
    this.#pos = Math.min(this.#str.length, this.#pos + count);
    return this.#pos;
  }

  moveTo(nextPos) {
    if (!Number.isInteger(nextPos)) {
      throw new TypeError('nextPos must be an integer.');
    }
    this.#pos = Math.max(0, Math.min(this.#str.length, nextPos));
    return this.#pos;
  }

  isLineStart() {
    return this.#pos === 0 || this.#str[this.#pos - 1] === this.#text.LF;
  }

  /**
   * 指定位置から指定文字が連続する長さを数える（カーソル位置は変えない）。
   */
  countRepeat(ch, fromPos = this.#pos) {
    let idx = fromPos;
    while (idx < this.#str.length && this.#str[idx] === ch) {
      idx++;
    }
    return idx - fromPos;
  }

  /**
   * 指定位置から LF または EOF までの終端インデックスを返す（カーソル位置は変えない）。
   */
  findLineEnd(fromPos = this.#pos) {
    const lf = this.#text.LF;
    let idx = fromPos;
    while (idx < this.#str.length && this.#str[idx] !== lf) {
      idx++;
    }
    return idx;
  }

  /**
   * 指定インデックスの直後にある LF を跨いだ位置を返す。LF が無ければその位置を返す。
   */
  afterNewlineAt(index) {
    if (index < this.#str.length && this.#str[index] === this.#text.LF) {
      return index + 1;
    }
    return index;
  }

  slice(start, end) {
    return this.#str.slice(start, end);
  }
}

export class FrameTokenizer {
  #metaChars;

  constructor(...metaChars) {
    this.#metaChars = new MetaCharSet(metaChars);
  }

  get metaChars() {
    return this.#metaChars;
  }

  tokenize(text) {
    if (!(text instanceof Text)) {
      throw new TypeError('Input text must be an instance of Text.');
    }

    const cursor = new Cursor(text, 0);
    const tokens = [];

    while (!cursor.eof) {
      if (!this.#isFenceCandidateAt(cursor)) {
        cursor.advance(1);
        continue;
      }

      const token = this.#parseFrame(cursor, null);
      tokens.push(token);
      cursor.moveTo(cursor.afterNewlineAt(token.foot.end));
    }

    return tokens;
  }

  #isFenceCandidateAt(cursor) {
    if (!cursor.isLineStart()) return false;
    const ch = cursor.peek(0);
    if (!this.#metaChars.has(ch)) return false;
    return cursor.countRepeat(ch) >= MIN_FENCE_LEN;
  }

  #parseFrame(cursor, parentLen) {
    const head = this.#parseHead(cursor, parentLen);
    const bodyStart = this.#resolveBodyStart(cursor, head);
    const { bodyEnd, foot } = this.#scanBodyAndFindFoot(cursor, head, bodyStart);

    return {
      char: head.char,
      len: head.len,
      head: head.range,
      body: { start: bodyStart, end: bodyEnd },
      foot
    };
  }

  #parseHead(cursor, parentLen) {
    const start = cursor.pos;
    const char = cursor.peek(0);
    const len = cursor.countRepeat(char, start);

    if (len < MIN_FENCE_LEN) {
      throw new FrameSyntaxError(`Fence length must be at least ${MIN_FENCE_LEN}`, start);
    }
    if (parentLen !== null && len >= parentLen) {
      throw new FrameSyntaxError(
        `Nested fence length (${len}) must be shorter than parent fence length (${parentLen})`,
        start
      );
    }

    const fenceEnd = start + len;
    const info = this.#parseLineInfo(cursor, fenceEnd, char.repeat(len), 'Header');

    return {
      char,
      len,
      range: { start, end: info.end, info }
    };
  }

  #parseLineInfo(cursor, infoStart, fenceStr, label) {
    const end = cursor.findLineEnd(infoStart);
    if (cursor.slice(infoStart, end) === fenceStr) {
      throw new FrameSyntaxError(`${label} info cannot be identical to fence`, infoStart);
    }
    return { start: infoStart, end };
  }

  #resolveBodyStart(cursor, head) {
    const nextPos = cursor.afterNewlineAt(head.range.end);
    if (nextPos === head.range.end && cursor.eof) {
      throw new FrameSyntaxError('Missing footer fence (reached EOF in header)', head.range.start);
    }
    return nextPos;
  }

  #scanBodyAndFindFoot(cursor, head, bodyStart) {
    cursor.moveTo(bodyStart);
    const fenceStr = head.char.repeat(head.len);

    while (!cursor.eof) {
      if (!cursor.isLineStart()) {
        cursor.advance(1);
        continue;
      }

      const lineChar = cursor.peek(0);
      if (!this.#metaChars.has(lineChar)) {
        cursor.advance(1);
        continue;
      }

      const lineStart = cursor.pos;
      const runLen = cursor.countRepeat(lineChar, lineStart);

      if (lineChar === head.char && runLen === head.len) {
        const foot = this.#parseFoot(cursor, lineStart, runLen, fenceStr);
        return { bodyEnd: lineStart, foot };
      }

      if (lineChar === head.char && runLen > head.len) {
        throw new FrameSyntaxError(
          `Fence length (${runLen}) exceeds header fence length (${head.len})`,
          lineStart
        );
      }

      if (runLen >= MIN_FENCE_LEN) {
        const child = this.#parseFrame(cursor, head.len);
        cursor.moveTo(cursor.afterNewlineAt(child.foot.end));
        continue;
      }

      cursor.advance(1);
    }

    throw new FrameSyntaxError('Missing matching footer fence', head.range.start);
  }

  #parseFoot(cursor, start, len, fenceStr) {
    const info = this.#parseLineInfo(cursor, start + len, fenceStr, 'Footer');
    return { start, end: info.end, info };
  }
}
