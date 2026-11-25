class JparaSyntax {
  constructor(options = {}) {
    this.br = options.br !== undefined ? Boolean(options.br) : true;
    this.indent = options.indent !== undefined ? Boolean(options.indent) : false;
  }

  static get default() {
    return new JparaSyntax({ br: true, indent: false });
  }
}

function jpara(text, syntax = JparaSyntax.default) {
  if (!text) return '';

  // 改行コードを \n に正規化し、前後の余分な空行をトリム
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  if (!normalized) return '';

  // 2個以上の連続する改行をキャプチャして分割
  const tokens = normalized.split(/(\n{2,})/);
  const result = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (i % 2 === 0) {
      // 【意味段落】の処理（単一改行で形式段落に分割）
      const formalParas = token.split('\n').map(line => {
        if (!syntax.indent) return line;
        return line.startsWith('　') ? line : '　' + line;
      });
      result.push(`<p>${formalParas.join('<br>')}</p>`);
    } else {
      // 【意味段落間の改行】の処理
      if (syntax.br) {
        const newlineCount = token.length;
        if (newlineCount > 2) {
          result.push('<br>'.repeat(newlineCount - 2));
        }
      }
    }
  }

  return result.join('\n');
}

