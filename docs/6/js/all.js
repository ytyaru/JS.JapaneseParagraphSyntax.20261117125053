class DocumentAST {
    constructor(source) {
        this.type = 'root';
        this.source = source;
        this.children = [];
    }
    getText(node) {
        return node.value !== undefined ? node.value : this.source.slice(node.start, node.end);
    }
}

class Token {
    constructor(type, start, end, meta = {}) {
        this.type = type;
        this.start = start;
        this.end = end;
        this.meta = meta;
    }
}

class AstNode {
    constructor(type, start, end, props = {}) {
        this.type = type;
        this.start = start;
        this.end = end;
        Object.assign(this, props);
    }
}

class GraphemeCursor {
    constructor(text, start = 0, end = text.length) {
        this.text = text;
        this.endOffset = end;
        const segmenter = new Intl.Segmenter('ja-JP', { granularity: 'grapheme' });
        this.segments = Array.from(segmenter.segment(text.slice(start, end))).map(s => ({
            segment: s.segment,
            index: start + s.index
        }));
        this.pos = 0;
    }
    get isEOF() { return this.pos >= this.segments.length; }
    get currentOffset() { return this.isEOF ? this.endOffset : this.segments[this.pos].index; }
    peek(offset = 0) { return this.segments[this.pos + offset]?.segment ?? null; }
    advance(step = 1) { this.pos = Math.max(0, Math.min(this.pos + step, this.segments.length)); }
    moveToOffset(offset) { while (!this.isEOF && this.currentOffset < offset) this.pos++; }
    countConsecutive(ch) {
        let c = 0;
        while (this.peek(c) === ch) c++;
        return c;
    }
}

// 1. 構文仕様定義（データのみ）
class SyntaxRule {
    constructor({ id, layer, allowedChildIds = [] }) {
        this.id = id;
        this.layer = layer; // 'fence' | 'block' | 'inline'
        this.allowedChildIds = allowedChildIds;
    }
}

// 2. トークナイザ基底（原稿検査とToken範囲切り出しのみ）
class BaseTokenizer {
    constructor(rule) { this.rule = rule; }
    match(cursor, context) { throw new Error('Not implemented'); }
    tokenize(cursor, context) { throw new Error('Not implemented'); }
}

// 3. レキサー基底（TokenからAstNode生成と許可された子要素の再帰呼び出しのみ）
class BaseLexer {
    constructor(rule) { this.rule = rule; }
    lex(token, engine) {
        return new AstNode(this.rule.id, token.start, token.end, token.meta);
    }
}

// 4. 構文ユニット登録・実行エンジン
class ParserEngine {
    constructor() {
        this.units = new Map(); // id -> { rule, tokenizer, lexer }
        this.defaultBlockId = null;
        this.defaultInlineId = null;
        this.currentText = '';
    }

    register(rule, tokenizer, lexer) {
        this.units.set(rule.id, { rule, tokenizer, lexer });
    }
    setDefaultBlock(id) { this.defaultBlockId = id; }
    setDefaultInline(id) { this.defaultInlineId = id; }

    getUnitsByLayer(layer, allowedIds = null) {
        const list = [];
        for (const [id, unit] of this.units.entries()) {
            if (unit.rule.layer !== layer) continue;
            if (allowedIds && !allowedIds.includes(id)) continue;
            list.push(unit);
        }
        return list;
    }

    parse(text) {
        this.currentText = text;
        const ast = new DocumentAST(text);
        ast.children = this.parseBlockLayer(text, 0, text.length);
        return ast;
    }

    parseBlockLayer(text, start, end, allowedIds = null) {
        const cursor = new GraphemeCursor(text, start, end);
        const nodes = [];
        let pendingBr = 0;

        const leadingNl = cursor.countConsecutive('\n');
        if (leadingNl > 0) cursor.advance(leadingNl);

        const specials = [
            ...this.getUnitsByLayer('fence', allowedIds),
            ...this.getUnitsByLayer('block', allowedIds)
        ];
        const defaultUnit = this.units.get(this.defaultBlockId);

        while (!cursor.isEOF) {
            const nl = cursor.countConsecutive('\n');
            if (nl > 0) {
                cursor.advance(nl);
                if (cursor.isEOF) break;
                pendingBr = Math.max(0, nl - 2);
                continue;
            }
            const node = this.#stepCursor(cursor, specials, defaultUnit, { br: pendingBr });
            if (node) { nodes.push(node); pendingBr = 0; }
        }
        return nodes;
    }

    // Inline層: 文字列置換をせず、現在位置から最も手前でマッチする正規表現をワンパスで消費
    parseInlineLayer(text, start, end, allowedIds = null) {
        const inlineUnits = this.getUnitsByLayer('inline', allowedIds)
            .filter(u => u.rule.id !== this.defaultInlineId);
        const defaultLexer = this.units.get(this.defaultInlineId)?.lexer;
        const nodes = [];
        let pos = start;

        while (pos < end) {
            let earliestMatch = null;
            let matchedUnit = null;

            for (const unit of inlineUnits) {
                const m = unit.tokenizer.findNext(text, pos, end);
                if (m && (!earliestMatch || m.start < earliestMatch.start)) {
                    earliestMatch = m;
                    matchedUnit = unit;
                }
            }

            if (!earliestMatch) {
                // 残りはすべてデフォルトテキスト
                if (defaultLexer) {
                    nodes.push(defaultLexer.lex(new Token(this.defaultInlineId, pos, end), this));
                }
                break;
            }

            // マッチ開始位置より手前にプレーンテキストがあれば確定
            if (earliestMatch.start > pos && defaultLexer) {
                nodes.push(defaultLexer.lex(new Token(this.defaultInlineId, pos, earliestMatch.start), this));
            }

            // マッチしたInlineトークンをノード化
            nodes.push(matchedUnit.lexer.lex(earliestMatch, this));
            pos = earliestMatch.end;
        }
        return nodes;
    }

    #stepCursor(cursor, specials, defaultUnit, extraMeta) {
        const ctx = { specials };
        for (const unit of specials) {
            const pos = cursor.pos;
            if (unit.tokenizer.match(cursor, ctx)) {
                cursor.pos = pos;
                const token = unit.tokenizer.tokenize(cursor, ctx);
                Object.assign(token.meta, extraMeta);
                cursor.moveToOffset(token.end);
                return unit.lexer.lex(token, this);
            }
            cursor.pos = pos;
        }
        if (defaultUnit) {
            const pos = cursor.pos;
            const token = defaultUnit.tokenizer.tokenize(cursor, ctx);
            if (token) {
                Object.assign(token.meta, extraMeta);
                cursor.moveToOffset(token.end);
                return defaultUnit.lexer.lex(token, this);
            }
            cursor.pos = pos;
        }
        return null;
    }
}


// --- [Fence: コードブロック（子要素パースなし）] ---
class CodeFenceTokenizer extends BaseTokenizer {
    match(cursor) { return cursor.countConsecutive('`') >= 3; }
    tokenize(cursor) {
        const start = cursor.currentOffset;
        const len = cursor.countConsecutive('`');
        cursor.advance(len);
        const langStart = cursor.currentOffset;
        while (!cursor.isEOF && cursor.peek() !== '\n') cursor.advance(1);
        const langEnd = cursor.currentOffset;
        if (cursor.peek() === '\n') cursor.advance(1);

        const contentStart = cursor.currentOffset;
        let contentEnd = contentStart;
        while (!cursor.isEOF) {
            if (cursor.peek() === '\n') {
                cursor.advance(1);
                const closeLen = cursor.countConsecutive('`');
                if (closeLen >= len) {
                    contentEnd = cursor.currentOffset - 1;
                    cursor.advance(closeLen);
                    break;
                }
            } else {
                cursor.advance(1);
            }
            contentEnd = cursor.currentOffset;
        }
        return new Token(this.rule.id, start, cursor.currentOffset, { langStart, langEnd, contentStart, contentEnd });
    }
}

// --- [Fence: プレビュー付きフェンス（子要素としてBlock/Inlineを再帰パースする例）] ---
class PreviewFenceTokenizer extends BaseTokenizer {
    match(cursor) { return cursor.countConsecutive('~') >= 3; }
    tokenize(cursor) {
        const start = cursor.currentOffset;
        const len = cursor.countConsecutive('~');
        cursor.advance(len);
        while (!cursor.isEOF && cursor.peek() !== '\n') cursor.advance(1);
        if (cursor.peek() === '\n') cursor.advance(1);

        const contentStart = cursor.currentOffset;
        let contentEnd = contentStart;
        while (!cursor.isEOF) {
            if (cursor.peek() === '\n') {
                cursor.advance(1);
                const closeLen = cursor.countConsecutive('~');
                if (closeLen >= len) {
                    contentEnd = cursor.currentOffset - 1;
                    cursor.advance(closeLen);
                    break;
                }
            } else {
                cursor.advance(1);
            }
            contentEnd = cursor.currentOffset;
        }
        return new Token(this.rule.id, start, cursor.currentOffset, { contentStart, contentEnd });
    }
}
class PreviewFenceLexer extends BaseLexer {
    lex(token, engine) {
        // このフェンス種別は内部をBlock/Inlineとして再帰パースする
        const children = engine.parseBlockLayer(engine.currentText, token.meta.contentStart, token.meta.contentEnd);
        return new AstNode(this.rule.id, token.start, token.end, { ...token.meta, children });
    }
}

// --- [Block: 日本語意味段落(p1) ＋ 形式段落(p2)] ---
class ParagraphTokenizer extends BaseTokenizer {
    match(cursor) { return !cursor.isEOF; }
    tokenize(cursor, { specials }) {
        const start = cursor.currentOffset;
        const p2Ranges = [];
        let p2Start = start;
        while (!cursor.isEOF) {
            const nl = cursor.countConsecutive('\n');
            if (nl >= 2) {
                if (cursor.currentOffset > p2Start) p2Ranges.push({ start: p2Start, end: cursor.currentOffset });
                break;
            } else if (nl === 1) {
                p2Ranges.push({ start: p2Start, end: cursor.currentOffset });
                cursor.advance(1);
                const pos = cursor.pos;
                const hit = specials.some(u => { const m = u.tokenizer.match(cursor, { specials }); cursor.pos = pos; return m; });
                if (hit) { p2Start = cursor.currentOffset; break; }
                p2Start = cursor.currentOffset;
            } else {
                cursor.advance(1);
            }
        }
        if (cursor.isEOF && cursor.currentOffset > p2Start) p2Ranges.push({ start: p2Start, end: cursor.currentOffset });
        return new Token(this.rule.id, start, p2Ranges.at(-1)?.end ?? cursor.currentOffset, { p2Ranges });
    }
}
class ParagraphLexer extends BaseLexer {
    lex(token, engine) {
        const children = token.meta.p2Ranges.map(r => new AstNode('p2', r.start, r.end, {
            children: engine.parseInlineLayer(engine.currentText, r.start, r.end, this.rule.allowedChildIds)
        }));
        return new AstNode(this.rule.id, token.start, token.end, { br: token.meta.br, children });
    }
}

// --- [Inline: ルビ（正規表現 dフラグによる非破壊・単一パス検索）] ---
class RubyInlineTokenizer extends BaseTokenizer {
    findNext(text, searchStart, searchEnd) {
        const slice = text.slice(searchStart, searchEnd);
        const regex = /(?:｜([^｜《\n]+)|([\p{Script=Han}]+))《([^》\n]+)》/ud;
        const m = regex.exec(slice);
        if (!m) return null;

        const start = searchStart + m.indices[0][0];
        const end = searchStart + m.indices[0][1];
        const baseSpan = m.indices[1] ?? m.indices[2];
        const rtSpan = m.indices[3];

        return new Token(this.rule.id, start, end, {
            baseStart: searchStart + baseSpan[0],
            baseEnd: searchStart + baseSpan[1],
            rtStart: searchStart + rtSpan[0],
            rtEnd: searchStart + rtSpan[1]
        });
    }
}

// --- 検証用ダンプ関数（Node構造 ＋ テキスト抽出の両方を出力） ---
function dumpAst(ast) {
    console.log('=== 1. AST Node 構造 (JSON) ===');
    console.log(JSON.stringify(ast.children, null, 2));

    console.log('=== 2. AST テキスト抽出検証 ===');
    const walk = (node, depth = 0) => {
        const indent = '  '.repeat(depth);
        let detail = `"${ast.getText(node).replace(/\n/g, '\\n')}"`;
        if (node.type === 'ruby') {
            detail = `親="${ast.source.slice(node.baseStart, node.baseEnd)}", ルビ="${ast.source.slice(node.rtStart, node.rtEnd)}"`;
        } else if (node.type === 'fence_code') {
            detail = `lang="${ast.source.slice(node.langStart, node.langEnd)}", code="${ast.source.slice(node.contentStart, node.contentEnd).replace(/\n/g, '\\n')}"`;
        }
        console.log(`${indent}[${node.type}] (br=${node.br ?? '-'}) ${detail}`);
        if (node.children) node.children.forEach(c => walk(c, depth + 1));
    };
    ast.children.forEach(n => walk(n));
}

window.addEventListener('DOMContentLoaded', () => {
    const engine = new ParserEngine();

    const codeRule = new SyntaxRule({ id: 'fence_code', layer: 'fence' });
    const previewRule = new SyntaxRule({ id: 'fence_preview', layer: 'fence' });
    const p1Rule = new SyntaxRule({ id: 'p1', layer: 'block', allowedChildIds: ['ruby', 'text'] });
    const rubyRule = new SyntaxRule({ id: 'ruby', layer: 'inline' });
    const textRule = new SyntaxRule({ id: 'text', layer: 'inline' });

    engine.register(codeRule, new CodeFenceTokenizer(codeRule), new BaseLexer(codeRule));
    engine.register(previewRule, new PreviewFenceTokenizer(previewRule), new PreviewFenceLexer(previewRule));
    engine.register(p1Rule, new ParagraphTokenizer(p1Rule), new ParagraphLexer(p1Rule));
    engine.register(rubyRule, new RubyInlineTokenizer(rubyRule), new BaseLexer(rubyRule));
    engine.register(textRule, new BaseTokenizer(textRule), new BaseLexer(textRule));

    engine.setDefaultBlock('p1');
    engine.setDefaultInline('text');

    const fullSampleJd = `意味段落１

意味段落２｜明示ルビ《めいじるび》と省略漢字《しょうりゃくかんじ》と｜未閉鎖ルビのテスト
意味段落２の形式段落２


意味段落３（上に空行2つ＝br:1）

\`\`\`\`js
\`\`\`
ネストされた3連バッククォートを含む4連フェンス（ここはルビ｜漢字《かんじ》も解析されない）
\`\`\`
\`\`\`\`

プレビューフェンス内の省略漢字《しょうりゃくかんじ》は再帰パースされる
`;

    const ast = engine.parse(fullSampleJd);
    dumpAst(ast);
});
