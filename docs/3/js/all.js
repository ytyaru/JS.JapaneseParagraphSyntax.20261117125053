/**
 * ============================================================================
 * 1. AST データ構造（ゼロコピー設計）
 * ============================================================================
 */
class DocumentAST {
    constructor(sourceText) {
        this.type = 'root';
        this.source = sourceText;
        this.children = [];
    }
    getText(node) {
        if (node.value !== undefined) return node.value;
        return this.source.slice(node.start, node.end);
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

/**
 * ============================================================================
 * 2. 書記素（Grapheme）対応カーソル
 * ============================================================================
 */
class GraphemeCursor {
    constructor(text, startOffset = 0, endOffset = text.length) {
        this.text = text;
        this.endOffset = endOffset;
        const slice = text.slice(startOffset, endOffset);
        const segmenter = new Intl.Segmenter('ja-JP', { granularity: 'grapheme' });
        
        this.segments = Array.from(segmenter.segment(slice)).map(s => ({
            segment: s.segment,
            index: startOffset + s.index
        }));
        this.pos = 0;
    }

    get isEOF() {
        return this.pos >= this.segments.length;
    }

    get currentOffset() {
        return this.isEOF ? this.endOffset : this.segments[this.pos].index;
    }

    peek(offset = 0) {
        const target = this.pos + offset;
        return target < this.segments.length ? this.segments[target].segment : null;
    }

    matchString(targetStr) {
        return this.text.startsWith(targetStr, this.currentOffset);
    }

    countConsecutive(targetGrapheme) {
        let count = 0;
        while (this.peek(count) === targetGrapheme) {
            count++;
        }
        return count;
    }

    advance(step = 1) {
        this.pos = Math.min(this.pos + step, this.segments.length);
    }

    moveToOffset(targetOffset) {
        while (!this.isEOF && this.currentOffset < targetOffset) {
            this.pos++;
        }
    }
}

/**
 * ============================================================================
 * 3. 構文ルール基底クラス群（Fence / Block / Inline）
 * ============================================================================
 */
class SyntaxRule {
    constructor(id, layer) {
        this.id = id;
        this.layer = layer;
    }
    match(cursor, context) {
        throw new Error(`${this.constructor.name}.match() must be implemented`);
    }
    buildNode(token, engine) {
        return new AstNode(this.id, token.start, token.end, token.props);
    }
}

class FenceSyntaxRule extends SyntaxRule {
    constructor(id) { super(id, 'fence'); }
}

class BlockSyntaxRule extends SyntaxRule {
    constructor(id) { super(id, 'block'); }
}

class InlineSyntaxRule extends SyntaxRule {
    constructor(id) { super(id, 'inline'); }
}

/**
 * ============================================================================
 * 4. 階層レジストリ＆パーサーエンジン
 * ============================================================================
 */
class LayerRegistry {
    constructor(layerName) {
        this.layerName = layerName;
        this.specialRules = [];
        this.defaultRule = null;
    }
    register(rule) {
        this.specialRules.push(rule);
    }
    setDefault(rule) {
        this.defaultRule = rule;
    }
}

class ParserEngine {
    constructor() {
        this.layers = {
            fence: new LayerRegistry('fence'),
            block: new LayerRegistry('block'),
            inline: new LayerRegistry('inline')
        };
        this.currentText = '';
    }

    register(rule) {
        this.layers[rule.layer].register(rule);
    }

    setDefaultRule(rule) {
        this.layers[rule.layer].setDefault(rule);
    }

    parse(text) {
        this.currentText = text;
        const ast = new DocumentAST(text);
        ast.children = this.parseBlockLayer(text, 0, text.length);
        return ast;
    }

    parseBlockLayer(text, startOffset, endOffset) {
        const cursor = new GraphemeCursor(text, startOffset, endOffset);
        const nodes = [];
        let pendingBr = 0;

        const leadingNl = cursor.countConsecutive('\n');
        if (leadingNl > 0) cursor.advance(leadingNl);

        const specialRules = [
            ...this.layers.fence.specialRules,
            ...this.layers.block.specialRules
        ];
        const defaultRule = this.layers.block.defaultRule;

        while (!cursor.isEOF) {
            const nlCount = cursor.countConsecutive('\n');
            if (nlCount > 0) {
                cursor.advance(nlCount);
                if (cursor.isEOF) break;
                pendingBr = Math.max(0, nlCount - 2);
                continue;
            }

            const node = this.#matchOne(cursor, specialRules, defaultRule, { br: pendingBr });
            if (node) {
                nodes.push(node);
                pendingBr = 0;
            }
        }
        return nodes;
    }

    parseInlineLayer(text, startOffset, endOffset) {
        const cursor = new GraphemeCursor(text, startOffset, endOffset);
        const nodes = [];
        const specialRules = this.layers.inline.specialRules;
        const defaultRule = this.layers.inline.defaultRule;

        while (!cursor.isEOF) {
            const node = this.#matchOne(cursor, specialRules, defaultRule, {});
            if (node) nodes.push(node);
        }
        return nodes;
    }

    #matchOne(cursor, specialRules, defaultRule, extraProps) {
        const context = { specialRules };

        for (const rule of specialRules) {
            const startPos = cursor.pos;
            const res = rule.match(cursor, context);
            if (res) {
                const token = {
                    start: cursor.segments[startPos].index,
                    end: res.end,
                    props: { ...extraProps, ...res.props }
                };
                const node = rule.buildNode(token, this);
                cursor.moveToOffset(res.end);
                return node;
            }
            cursor.pos = startPos;
        }

        if (defaultRule) {
            const startPos = cursor.pos;
            const res = defaultRule.match(cursor, context);
            if (res) {
                const token = {
                    start: cursor.segments[startPos].index,
                    end: res.end,
                    props: { ...extraProps, ...res.props }
                };
                const node = defaultRule.buildNode(token, this);
                cursor.moveToOffset(res.end);
                return node;
            }
        }
        return null;
    }
}

/**
 * ============================================================================
 * 5. 具象構文ルール（可変長フェンス・日本語段落・ルビ）
 * ============================================================================
 */

class SourceCodeFenceRule extends FenceSyntaxRule {
    constructor() {
        super('fence_code');
    }

    match(cursor) {
        const fenceLen = cursor.countConsecutive('`');
        if (fenceLen < 3) return null;

        cursor.advance(fenceLen);

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
                if (closeLen >= fenceLen) {
                    contentEnd = cursor.currentOffset - 1;
                    cursor.advance(closeLen);
                    break;
                }
            } else {
                cursor.advance(1);
            }
            contentEnd = cursor.currentOffset;
        }

        return {
            end: cursor.currentOffset,
            props: { fenceLen, langStart, langEnd, contentStart, contentEnd }
        };
    }
}

class DefaultParagraphRule extends BlockSyntaxRule {
    constructor() {
        super('p1');
    }

    match(cursor, { specialRules }) {
        const start = cursor.currentOffset;
        const p2Ranges = [];
        let p2Start = start;

        while (!cursor.isEOF) {
            const nlCount = cursor.countConsecutive('\n');
            if (nlCount >= 2) {
                if (cursor.currentOffset > p2Start) {
                    p2Ranges.push({ start: p2Start, end: cursor.currentOffset });
                }
                break;
            } else if (nlCount === 1) {
                p2Ranges.push({ start: p2Start, end: cursor.currentOffset });
                cursor.advance(1);

                const checkPos = cursor.pos;
                const isNextSpecial = specialRules.some(r => {
                    const matched = r.match(cursor, { specialRules }) !== null;
                    cursor.pos = checkPos;
                    return matched;
                });
                if (isNextSpecial) {
                    p2Start = cursor.currentOffset;
                    break;
                }
                p2Start = cursor.currentOffset;
            } else {
                cursor.advance(1);
            }
        }

        if (cursor.isEOF && cursor.currentOffset > p2Start) {
            p2Ranges.push({ start: p2Start, end: cursor.currentOffset });
        }

        const end = p2Ranges.length > 0 ? p2Ranges[p2Ranges.length - 1].end : cursor.currentOffset;
        return { end, props: { p2Ranges } };
    }

    buildNode(token, engine) {
        const { br, p2Ranges } = token.props;
        const p2Nodes = p2Ranges.map(range => {
            const children = engine.parseInlineLayer(engine.currentText, range.start, range.end);
            return new AstNode('p2', range.start, range.end, { children });
        });
        return new AstNode('p1', token.start, token.end, { br, children: p2Nodes });
    }
}

class RubyInlineRule extends InlineSyntaxRule {
    constructor() {
        super('ruby');
    }

    match(cursor) {
        if (cursor.peek() !== '｜') return null;
        cursor.advance(1);
        const baseStart = cursor.currentOffset;

        while (!cursor.isEOF && cursor.peek() !== '《' && cursor.peek() !== '\n') cursor.advance(1);
        if (cursor.peek() !== '《') return null;

        const baseEnd = cursor.currentOffset;
        cursor.advance(1);
        const rtStart = cursor.currentOffset;

        while (!cursor.isEOF && cursor.peek() !== '》' && cursor.peek() !== '\n') cursor.advance(1);
        if (cursor.peek() !== '》') return null;

        const rtEnd = cursor.currentOffset;
        cursor.advance(1);

        return {
            end: cursor.currentOffset,
            props: { baseStart, baseEnd, rtStart, rtEnd }
        };
    }
}

class DefaultTextInlineRule extends InlineSyntaxRule {
    constructor() {
        super('text');
    }

    match(cursor, { specialRules }) {
        cursor.advance(1);

        while (!cursor.isEOF) {
            const checkPos = cursor.pos;
            const isSpecialMatch = specialRules.some(r => {
                const matched = r.match(cursor, { specialRules }) !== null;
                cursor.pos = checkPos;
                return matched;
            });
            if (isSpecialMatch) break;
            cursor.advance(1);
        }
        return { end: cursor.currentOffset, props: {} };
    }
}

// [Inline層: 特殊] 可変長バッククォートによるインラインコード（改行不可）
class InlineCodeRule extends InlineSyntaxRule {
    constructor() {
        super('inline_code');
    }

    match(cursor) {
        const tickLen = cursor.countConsecutive('`');
        if (tickLen === 0) return null;

        cursor.advance(tickLen);
        const contentStart = cursor.currentOffset;

        while (!cursor.isEOF) {
            // Inline文脈の鉄則: 改行が含まれたらインライン構文として不成立
            if (cursor.peek() === '\n') return null;

            const closeLen = cursor.countConsecutive('`');
            if (closeLen === tickLen) {
                const contentEnd = cursor.currentOffset;
                cursor.advance(closeLen);
                return {
                    end: cursor.currentOffset,
                    props: { tickLen, contentStart, contentEnd }
                };
            }
            // 個数が違うバッククォートは内容の一部として消費
            if (closeLen > 0) {
                cursor.advance(closeLen);
            } else {
                cursor.advance(1);
            }
        }
        return null; // 閉じられなければ不成立
    }
}

// ASTが正しくテキストを切り出せているか確認するダンプ関数
function dumpAstWithText(ast) {
    const dumpNode = (node, depth = 0) => {
        const indent = '  '.repeat(depth);
        let detail = `"${ast.getText(node).replace(/\n/g, '\\n')}"`;

        if (node.type === 'ruby') {
            const base = ast.source.slice(node.baseStart, node.baseEnd);
            const rt = ast.source.slice(node.rtStart, node.rtEnd);
            detail = `親="${base}", ルビ="${rt}"`;
        } else if (node.type === 'fence_code' || node.type === 'inline_code') {
            const code = ast.source.slice(node.contentStart, node.contentEnd);
            detail = `code="${code.replace(/\n/g, '\\n')}"`;
        }

        console.log(`${indent}[${node.type}] (br=${node.br ?? '-'}) ${detail}`);
        if (node.children) {
            node.children.forEach(child => dumpNode(child, depth + 1));
        }
    };
    ast.children.forEach(n => dumpNode(n));
}

window.addEventListener('DOMContentLoaded', (event) => {
    const engine = new ParserEngine();
    engine.setDefaultRule(new DefaultParagraphRule());
    engine.setDefaultRule(new DefaultTextInlineRule());
    engine.register(new SourceCodeFenceRule());
    engine.register(new RubyInlineRule());

    const sampleJd = `意味段落１

意味段落２｜漢字《かんじ》と｜未閉鎖ルビのテスト
意味段落２の形式段落２


意味段落３

\`\`\`\`js
\`\`\`
ネストされた3連バッククォートを含む4連フェンス
\`\`\`
\`\`\`\`


\`\`\`\`js console.log(\`単行コード\`); \`\`\`\`をインライン要素として差し込む。

\`\`\`
複数行の
フェンスです。
\`\`\`

`;

    const ast = engine.parse(sampleJd);
    console.log(JSON.stringify(ast.children, null, 2));
    dumpAstWithText(ast);
});

