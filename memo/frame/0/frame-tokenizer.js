export class FrameSyntaxError extends Error {
  constructor(message, index) {
    super(`${message} (index: ${index})`);
    this.name = 'FrameSyntaxError';
    this.index = index;
  }
}

export class FrameTokenizer {
  /**
   * @param {...string} metaChars フェンスに使えるメタ文字（空白・制御文字以外の1文字）
   */
  constructor(...metaChars) {
    const flat = metaChars.flat();
    if (flat.length === 0) {
      throw new Error('At least one meta character is required.');
    }

    this.metaChars = new Set();
    for (const ch of flat) {
      if (typeof ch !== 'string' || [...ch].length !== 1) {
        throw new Error(`Invalid meta character: "${ch}"`);
      }
      if (/[\s\p{Cc}]/u.test(ch)) {
        throw new Error(`Meta character cannot be whitespace or control char: "${ch}"`);
      }
      this.metaChars.add(ch);
    }
  }

  /**
   * @param {string} text
   * @returns {Array<{
   *   char: string,
   *   len: number,
   *   head: { start: number, end: number, info: { start: number, end: number } },
   *   body: { start: number, end: number },
   *   foot: { start: number, end: number, info: { start: number, end: number } }
   * }>}
   */
  tokenize(text) {
    if (typeof text !== 'string') {
      throw new TypeError('Input text must be a string.');
    }

    const tokens = [];
    const n = text.length;
    let i = 0;

    while (i < n) {
      if (!this._isLineStart(text, i) || !this.metaChars.has(text[i])) {
        i++;
        continue;
      }

      const token = this._parseFrame(text, i, null);
      tokens.push(token);

      // フッタ行末（改行直前）の次へ進める
      i = this._advancePastLineBreak(text, token.foot.end);
    }

    return tokens;
  }

  /**
   * 指定位置のフレーム（ヘッダ〜ボディ〜フッタ）を解析する。
   * parentLen が指定されている場合はネスト内とみなし、親以上の長さの同種フェンスをエラーとする。
   */
  _parseFrame(text, startIndex, parentLen) {
    const n = text.length;
    const char = text[startIndex];

    // 1. ヘッダフェンスの連続長を数える
    let cursor = startIndex;
    while (cursor < n && text[cursor] === char) {
      cursor++;
    }
    const len = cursor - startIndex;

    if (len < 3) {
      throw new FrameSyntaxError(`Fence length must be at least 3, got ${len}`, startIndex);
    }

    if (parentLen !== null && len >= parentLen) {
      throw new FrameSyntaxError(
        `Nested fence length (${len}) must be shorter than parent fence length (${parentLen})`,
        startIndex
      );
    }

    const fenceStr = char.repeat(len);

    // 2. ヘッダインフォ（行末まで）
    const infoStart = cursor;
    while (cursor < n && text[cursor] !== '\n' && text[cursor] !== '\r') {
      cursor++;
    }
    const infoEnd = cursor;
    const headEnd = cursor;

    const headInfoText = text.slice(infoStart, infoEnd);
    if (headInfoText === fenceStr) {
      throw new FrameSyntaxError('Header info cannot be identical to header fence', infoStart);
    }

    // 3. ボディ開始位置（ヘッダ行の改行後）
    if (cursor >= n) {
      throw new FrameSyntaxError('Missing footer fence (reached EOF in header)', startIndex);
    }
    const bodyStart = this._advancePastLineBreak(text, headEnd);

    // 4. ボディを走査し、ネスト構造をスキップしつつ対応するフッタフェンスを探す
    let scan = bodyStart;
    let bodyEnd = bodyStart;
    let foundFoot = null;

    while (scan < n) {
      if (this._isLineStart(text, scan) && this.metaChars.has(text[scan])) {
        const lineChar = text[scan];
        let runEnd = scan;
        while (runEnd < n && text[runEnd] === lineChar) {
          runEnd++;
        }
        const runLen = runEnd - scan;

        // 同一文字で同じ長さのフェンス行を検出
        if (lineChar === char && runLen === len) {
          const footStart = scan;
          const footInfoStart = runEnd;
          let footCursor = runEnd;
          while (footCursor < n && text[footCursor] !== '\n' && text[footCursor] !== '\r') {
            footCursor++;
          }
          const footInfoEnd = footCursor;
          const footEnd = footCursor;

          const footInfoText = text.slice(footInfoStart, footInfoEnd);
          if (footInfoText === fenceStr) {
            throw new FrameSyntaxError('Footer info cannot be identical to footer fence', footInfoStart);
          }

          // ボディ末尾はフッタ直前の改行まで含めるか、フッタ開始直前にするか
          // ここではフッタ行の直前（改行がある場合は改行の直前）を body.end とする
          bodyEnd = this._trimTrailingLineBreak(text, bodyStart, footStart);

          foundFoot = {
            start: footStart,
            end: footEnd,
            info: { start: footInfoStart, end: footInfoEnd }
          };
          break;
        }

        // 同一文字でより長いフェンスが来た場合（ネスト違反または閉じ忘れ）
        if (lineChar === char && runLen > len) {
          throw new FrameSyntaxError(
            `Fence length (${runLen}) exceeds header fence length (${len})`,
            scan
          );
        }

        // 別文字または短いフェンスが3連以上ならネストフレームとして再帰解析
        if (runLen >= 3) {
          const child = this._parseFrame(text, scan, len);
          scan = this._advancePastLineBreak(text, child.foot.end);
          continue;
        }
      }

      scan++;
    }

    if (!foundFoot) {
      throw new FrameSyntaxError('Missing matching footer fence', startIndex);
    }

    return {
      char,
      len,
      head: {
        start: startIndex,
        end: headEnd,
        info: { start: infoStart, end: infoEnd }
      },
      body: {
        start: bodyStart,
        end: bodyEnd
      },
      foot: foundFoot
    };
  }

  _isLineStart(text, index) {
    if (index === 0) return true;
    return text[index - 1] === '\n';
  }

  _advancePastLineBreak(text, index) {
    if (index < text.length && text[index] === '\r') {
      index++;
    }
    if (index < text.length && text[index] === '\n') {
      index++;
    }
    return index;
  }

  _trimTrailingLineBreak(text, minIndex, index) {
    let end = index;
    if (end > minIndex && text[end - 1] === '\n') {
      end--;
    }
    if (end > minIndex && text[end - 1] === '\r') {
      end--;
    }
    return end;
  }
}
