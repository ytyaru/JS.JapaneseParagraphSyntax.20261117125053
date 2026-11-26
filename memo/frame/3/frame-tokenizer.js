const LF = '\n';
const MIN_FENCE_LEN = 3;

export class FrameSyntaxError extends Error {
  constructor(message, index) {
    super(`${message} (index: ${index})`);
    this.name = 'FrameSyntaxError';
    this.index = index;
  }
}

export class MetaCharSet {
  constructor(metaChars) {
    const flat = metaChars.flat();
    if (flat.length === 0) {
      throw new Error('At least one meta character is required.');
    }

    this.chars = new Set();
    for (const ch of flat) {
      if (typeof ch !== 'string' || [...ch].length !== 1) {
        throw new Error(`Invalid meta character: "${ch}"`);
      }
      if (/[\s\p{Cc}]/u.test(ch)) {
        throw new Error(`Meta character cannot be whitespace or control char: "${ch}"`);
      }
      this.chars.add(ch);
    }
  }

  has(ch) {
    return this.chars.has(ch);
  }
}

/**
 * テキスト上の現在位置（インデックス）を操作・走査する単一責任クラス。
 */
export class Cursor {
  constructor(text, pos = 0) {
    this.text = text;
    this.pos = pos;
  }

  get length() {
    return this.text.length;
  }

  get eof() {
    return this.pos >= this.text.length;
  }

  peek(offset = 0) {
    const idx = this.pos + offset;
    return idx >= 0 && idx < this.text.length ? this.text[idx] : '';
  }

  advance(count = 1) {
    this.pos = Math.min(this.text.length, this.pos + count);
    return this.pos;
  }

  moveTo(nextPos) {
    this.pos = Math.max(0, Math.min(this.text.length, nextPos));
    return this.pos;
  }

  isLineStart() {
    return this.pos === 0 || this.text[this.pos - 1] === LF;
  }

  /**
   * 現在位置から指定文字が連続する長さを数える（カーソル位置自体は進めない）。
   */
  countRepeat(ch, fromPos = this.pos) {
    let idx = fromPos;
    while (idx < this.text.length && this.text[idx] === ch) {
      idx++;
    }
    return idx - fromPos;
  }

  /**
   * 現在位置から `\n` または EOF までの終端インデックスを返す（カーソル位置自体は進めない）。
   */
  findLineEnd(fromPos = this.pos) {
    let idx = fromPos;
    while (idx < this.text.length && this.text[idx] !== LF) {
      idx++;
    }
    return idx;
  }

  /**
   * 指定インデックスの直後にある `\n` を跨いだ位置を返す。`\n` が無ければその位置を返す。
   */
  afterNewlineAt(index) {
    if (index < this.text.length && this.text[index] === LF) {
      return index + 1;
    }
    return index;
  }

  slice(start, end) {
    return this.text.slice(start, end);
  }
}

export class FrameTokenizer {
  constructor(...metaChars) {
    this.metaChars = new MetaCharSet(metaChars);
  }

  tokenize(text) {
    if (typeof text !== 'string') {
      throw new TypeError('Input text must be a string.');
    }

    const cursor = new Cursor(text, 0);
    const tokens = [];

    while (!cursor.eof) {
      if (!this._isFenceCandidateAt(cursor)) {
        cursor.advance(1);
        continue;
      }

      const token = this._parseFrame(cursor, null);
      tokens.push(token);
      cursor.moveTo(cursor.afterNewlineAt(token.foot.end));
    }

    return tokens;
  }

  _isFenceCandidateAt(cursor) {
    if (!cursor.isLineStart()) return false;
    const ch = cursor.peek(0);
    if (!this.metaChars.has(ch)) return false;
    return cursor.countRepeat(ch) >= MIN_FENCE_LEN;
  }

  _parseFrame(cursor, parentLen) {
    const head = this._parseHead(cursor, parentLen);
    const bodyStart = this._resolveBodyStart(cursor, head);
    const { bodyEnd, foot } = this._scanBodyAndFindFoot(cursor, head, bodyStart);

    return {
      char: head.char,
      len: head.len,
      head: head.range,
      body: { start: bodyStart, end: bodyEnd },
      foot
    };
  }

  _parseHead(cursor, parentLen) {
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
    const info = this._parseLineInfo(cursor, fenceEnd, char.repeat(len), 'Header');

    return {
      char,
      len,
      range: { start, end: info.end, info }
    };
  }

  _parseLineInfo(cursor, infoStart, fenceStr, label) {
    const end = cursor.findLineEnd(infoStart);
    if (cursor.slice(infoStart, end) === fenceStr) {
      throw new FrameSyntaxError(`${label} info cannot be identical to fence`, infoStart);
    }
    return { start: infoStart, end };
  }

  _resolveBodyStart(cursor, head) {
    const nextPos = cursor.afterNewlineAt(head.range.end);
    if (nextPos === head.range.end && cursor.eof) {
      throw new FrameSyntaxError('Missing footer fence (reached EOF in header)', head.range.start);
    }
    return nextPos;
  }

  _scanBodyAndFindFoot(cursor, head, bodyStart) {
    cursor.moveTo(bodyStart);
    const fenceStr = head.char.repeat(head.len);

    while (!cursor.eof) {
      if (!cursor.isLineStart()) {
        cursor.advance(1);
        continue;
      }

      const lineChar = cursor.peek(0);
      if (!this.metaChars.has(lineChar)) {
        cursor.advance(1);
        continue;
      }

      const lineStart = cursor.pos;
      const runLen = cursor.countRepeat(lineChar, lineStart);

      if (lineChar === head.char && runLen === head.len) {
        const foot = this._parseFoot(cursor, lineStart, runLen, fenceStr);
        return { bodyEnd: lineStart, foot };
      }

      if (lineChar === head.char && runLen > head.len) {
        throw new FrameSyntaxError(
          `Fence length (${runLen}) exceeds header fence length (${head.len})`,
          lineStart
        );
      }

      if (runLen >= MIN_FENCE_LEN) {
        const child = this._parseFrame(cursor, head.len);
        cursor.moveTo(cursor.afterNewlineAt(child.foot.end));
        continue;
      }

      cursor.advance(1);
    }

    throw new FrameSyntaxError('Missing matching footer fence', head.range.start);
  }

  _parseFoot(cursor, start, len, fenceStr) {
    const info = this._parseLineInfo(cursor, start + len, fenceStr, 'Footer');
    return { start, end: info.end, info };
  }
}
