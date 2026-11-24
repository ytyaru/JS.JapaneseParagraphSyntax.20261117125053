/**
 * Jsyntax 初期化時の設定不備エラー
 */
class JsyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JsyntaxError';
  }
}

/**
 * jparse 実行時の引数不備エラー
 */
class JparseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JparseError';
  }
}

/**
 * 構文の検証と正規表現のコンパイル・保持を担うクラス
 */
class Jsyntax {
  static DefaultLength = Object.freeze({
    rb: 20, // 親文字の最大文字数（0は無制限）
    rt: 50, // ルビ文字の最大文字数（0は無制限）
    em: 0,  // 傍点文字の最大文字数（0は無制限）
  });

  static DefaultKanji = '(?:[\\p{Script=Han}々仝〆〇ヶヵ〻][\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}]?)';

  static #defaultInstance = null;
  static #kakuyomuInstance = null;

  // 合理的仕様（全角パイプのみ・ギュメ括弧）
  static get default() {
    if (!this.#defaultInstance) {
      this.#defaultInstance = new Jsyntax({
        pipes: '｜',
        brackets: '«»',
      });
    }
    return this.#defaultInstance;
  }

  // カクヨム準拠仕様（半角全角パイプ・二重山括弧）
  static get kakuyomu() {
    if (!this.#kakuyomuInstance) {
      this.#kakuyomuInstance = new Jsyntax({
        pipes: '|｜',
        brackets: '《》',
      });
    }
    return this.#kakuyomuInstance;
  }

  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new JsyntaxError(
        'オプションはオブジェクト形式で指定してください。例: new Jsyntax({ pipes: "｜", brackets: "«»" })'
      );
    }

    const mergedOptions = {
      pipes: '｜',
      brackets: '«»',
      kanji: Jsyntax.DefaultKanji,
      ...options,
      length: Object.freeze({
        ...Jsyntax.DefaultLength,
        ...(options.length ?? {}),
      }),
    };

    this.#validate(mergedOptions);

    this._ = Object.freeze({
      options: Object.freeze(mergedOptions),
      regs: Object.freeze(this.#buildRegexps(mergedOptions)),
    });
  }

  get options() {
    return this._.options;
  }

  get regs() {
    return this._.regs;
  }

  #validate(opts) {
    // 1. pipes
    if (typeof opts.pipes !== 'string' || [...opts.pipes].length === 0) {
      throw new JsyntaxError(
        'options.pipes は1文字以上の文字列で指定してください。例: "｜" や "|｜"'
      );
    }

    // 2. brackets
    if (typeof opts.brackets !== 'string') {
      throw new JsyntaxError(
        'options.brackets は2文字の文字列で指定してください。例: "《》" や "«»"'
      );
    }
    const bracketChars = [...opts.brackets];
    if (bracketChars.length !== 2) {
      throw new JsyntaxError(
        `options.brackets は厳密に2文字の文字列で指定してください（現在 ${bracketChars.length} 文字）。例: "《》" や "«»"`
      );
    }
    if (bracketChars[0] === bracketChars[1]) {
      throw new JsyntaxError(
        `options.brackets の開始文字と終了文字に同じ文字（"${bracketChars[0]}"）は指定できません。例: "《》" や "«»"`
      );
    }

    // 3. pipes と brackets の重複チェック
    const pipeSet = new Set([...opts.pipes]);
    for (const bChar of bracketChars) {
      if (pipeSet.has(bChar)) {
        throw new JsyntaxError(
          `options.pipes と options.brackets に同じ文字（"${bChar}"）が含まれています。異なる記号を指定してください。`
        );
      }
    }

    // 4. length
    if (opts.length === null || typeof opts.length !== 'object' || Array.isArray(opts.length)) {
      throw new JsyntaxError(
        'options.length はオブジェクト形式で指定してください。例: { rb: 20, rt: 50, em: 0 }'
      );
    }
    for (const key of ['rb', 'rt', 'em']) {
      const val = opts.length[key];
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
        throw new JsyntaxError(
          `options.length.${key} は0以上の整数で指定してください（0は無制限）。例: { rb: 20, rt: 50, em: 0 }`
        );
      }
    }

    // 5. kanji
    if (typeof opts.kanji !== 'string' || opts.kanji.length === 0) {
      throw new JsyntaxError(
        'options.kanji は漢字1文字分を表す正規表現文字列で指定してください。例: "[一-龠々仝〆〇ヶ]"'
      );
    }
    try {
      new RegExp(opts.kanji, 'u');
    } catch (e) {
      throw new JsyntaxError(
        `options.kanji の正規表現が不正です（${e.message}）。例: "[一-龠々仝〆〇ヶ]"`
      );
    }
  }

  #buildRegexps(opts) {
    const escapedPipes = this.#escapeRegExpClass(opts.pipes);
    const pipePattern = `[${escapedPipes}]`;

    const [openBr, closeBr] = [...opts.brackets];
    const escOpen = this.#escapeRegExp(openBr);
    const escClose = this.#escapeRegExp(closeBr);
    const excludedChars = `${escapedPipes}${this.#escapeRegExpClass(openBr + closeBr)}\\n`;

    const qRb = opts.length.rb > 0 ? `{1,${opts.length.rb}}` : '+';
    const qRt = opts.length.rt > 0 ? `{1,${opts.length.rt}}` : '+';
    const qEm = opts.length.em > 0 ? `{1,${opts.length.em}}` : '+';

    const rbText = `([^${excludedChars}]${qRb})`;
    const rtText = `([^${excludedChars}]${qRt})`;
    const emText = `([^${excludedChars}]${qEm})`;
    const kanjiBase = `(${opts.kanji}${qRb})`;

    const openEntity = `&#x${openBr.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')};`;

    return {
      openEntity,
      escape: new RegExp(`${pipePattern}${escOpen}`, 'gu'),
      emphasis: new RegExp(`${escOpen}{2}${emText}${escClose}{2}`, 'gu'),
      rubyWithPipe: new RegExp(`${pipePattern}${rbText}${escOpen}${rtText}${escClose}`, 'gu'),
      rubyWithoutPipe: new RegExp(`${kanjiBase}${escOpen}${rtText}${escClose}`, 'gu'),
    };
  }

  #escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  #escapeRegExpClass(str) {
    return str.replace(/[\\\]^-]/g, '\\$&');
  }
}

/**
 * テキストをHTMLに変換する純粋関数
 */
function jparse(text, syntax = Jsyntax.default) {
  if (typeof text !== 'string') {
    throw new JparseError(
      `第1引数 text は文字列（string）である必要があります（受け取った型: ${text === null ? 'null' : typeof text}）。`
    );
  }
  if (!(syntax instanceof Jsyntax)) {
    throw new JparseError(
      '第2引数 syntax は Jsyntax のインスタンスである必要があります。例: jparse(text, Jsyntax.kakuyomu)'
    );
  }

  const { regs } = syntax;
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(regs.escape, regs.openEntity)
    .replace(regs.emphasis, '<em class="emphasis">$1</em>')
    .replace(regs.rubyWithPipe, '<ruby>$1<rt>$2</rt></ruby>')
    .replace(regs.rubyWithoutPipe, '<ruby>$1<rt>$2</rt></ruby>');
}

