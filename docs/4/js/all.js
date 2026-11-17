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

class SyntaxRule {
    constructor(id, layer) {
        this.id = id;
        this.layer = layer;
    }
    // 戻り値は必ず { start, end, props } または null に統一
    match(cursor, context) { throw new Error('Not implemented'); }
    buildNode(token, engine) { return new AstNode(this.id, token.start, token.end, token.props); }
}

class FenceRule extends SyntaxRule {
    constructor(id) { super(id, 'fence'); }
    readUntilClosingFence(cursor, fenceChar, fenceLen) {
        const contentStart = cursor.currentOffset;
        while (!cursor.isEOF) {
            if (cursor.peek() === '\n') {
                cursor.advance(1);
                const closeLen = cursor.countConsecutive(fenceChar);
                if (closeLen >= fenceLen) {
                    const contentEnd = cursor.currentOffset - 1;
                    cursor.advance(closeLen);
                    return { contentStart, contentEnd, end: cursor.currentOffset };
                }
            } else {
                cursor.advance(1);
            }
        }
        return { contentStart, contentEnd: cursor.currentOffset, end: cursor.currentOffset };
    }
}

class BlockRule extends SyntaxRule {
    constructor(id) { super(id, 'block'); }
}

class InlineRule extends SyntaxRule {
    constructor(id) { super(id, 'inline'); }
    readInlineUntil(cursor, stopChar) {
        const start = cursor.currentOffset;
        while (!cursor.isEOF) {
            const ch = cursor.peek();
            if (ch === '\n') return null;
            if (ch === stopChar) return { start, end: cursor.currentOffset };
            cursor.advance(1);
        }
        return null;
    }
}

class ParserEngine {
    constructor() {
        this.rules = { fence: [], block: [], inline: [] };
        this.defaultBlock = null;
        this.defaultInline = null;
        this.currentText = '';
    }
    register(rule) { this.rules[rule.layer].push(rule); }
    setDefaultBlock(rule) { this.defaultBlock = rule; }
    setDefaultInline(rule) { this.defaultInline = rule; }

    parse(text) {
        this.currentText = text;
        const ast = new DocumentAST(text);
        ast.children = this.parseBlockLayer(text, 0, text.length);
        return ast;
    }

    parseBlockLayer(text, start, end) {
        const cursor = new GraphemeCursor(text, start, end);
        const nodes = [];
        let pendingBr = 0;
        const leadingNl = cursor.countConsecutive('\n');
        if (leadingNl > 0) cursor.advance(leadingNl);

        const specials = [...this.rules.fence, ...this.rules.block];
        while (!cursor.isEOF) {
            const nl = cursor.countConsecutive('\n');
            if (nl > 0) {
                cursor.advance(nl);
                if (cursor.isEOF) break;
                pendingBr = Math.max(0, nl - 2);
                continue;
            }
            const node = this.#step(cursor, specials, this.defaultBlock, { br: pendingBr });
            if (node) { nodes.push(node); pendingBr = 0; }
        }
        return nodes;
    }

    parseInlineLayer(text, start, end) {
        const cursor = new GraphemeCursor(text, start, end);
        const nodes = [];
        while (!cursor.isEOF) {
            const node = this.#step(cursor, this.rules.inline, this.defaultInline, {}, nodes);
            if (node) nodes.push(node);
        }
        return nodes;
    }

    #step(cursor, specials, defaultRule, extraProps, prevNodes = []) {
        const ctx = { specials, prevNodes };
        const targets = defaultRule ? [...specials, defaultRule] : specials;
        for (const rule of targets) {
            const pos = cursor.pos;
            const res = rule.match(cursor, ctx);
            if (res) {
                const token = { start: res.start, end: res.end, props: { ...extraProps, ...res.props } };
                cursor.moveToOffset(res.end);
                return rule.buildNode(token, this);
            }
            cursor.pos = pos;
        }
        return null;
    }
}

class CodeFenceRule extends FenceRule {
    constructor() { super('fence_code'); }
    match(cursor) {
        const start = cursor.currentOffset;
        const len = cursor.countConsecutive('`');
        if (len < 3) return null;
        cursor.advance(len);
        const langStart = cursor.currentOffset;
        while (!cursor.isEOF && cursor.peek() !== '\n') cursor.advance(1);
        const langEnd = cursor.currentOffset;
        if (cursor.peek() === '\n') cursor.advance(1);
        const body = this.readUntilClosingFence(cursor, '`', len);
        return { start, end: body.end, props: { langStart, langEnd, contentStart: body.contentStart, contentEnd: body.contentEnd } };
    }
}

class ParagraphBlockRule extends BlockRule {
    constructor() { super('p1'); }
    match(cursor, { specials }) {
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
                const hit = specials.some(r => { const m = r.match(cursor, { specials }) !== null; cursor.pos = pos; return m; });
                if (hit) { p2Start = cursor.currentOffset; break; }
                p2Start = cursor.currentOffset;
            } else {
                cursor.advance(1);
            }
        }
        if (cursor.isEOF && cursor.currentOffset > p2Start) p2Ranges.push({ start: p2Start, end: cursor.currentOffset });
        return { start, end: p2Ranges.at(-1)?.end ?? cursor.currentOffset, props: { p2Ranges } };
    }
    buildNode(token, engine) {
        const children = token.props.p2Ranges.map(r => new AstNode('p2', r.start, r.end, {
            children: engine.parseInlineLayer(engine.currentText, r.start, r.end)
        }));
        return new AstNode('p1', token.start, token.end, { br: token.props.br, children });
    }
}

class RubyInlineRule extends InlineRule {
    static HAN_REGEX = /^\p{Script=Han}$/u;
    constructor() { super('ruby'); }
    match(cursor, { prevNodes }) {
        const start = cursor.currentOffset;
        if (cursor.peek() === '｜') {
            cursor.advance(1);
            const base = this.readInlineUntil(cursor, '《');
            if (!base) return null;
            cursor.advance(1);
            const rt = this.readInlineUntil(cursor, '》');
            if (!rt) return null;
            cursor.advance(1);
            return { start, end: cursor.currentOffset, props: { baseStart: base.start, baseEnd: base.end, rtStart: rt.start, rtEnd: rt.end } };
        }
        if (cursor.peek() === '《') {
            const lastNode = prevNodes.at(-1);
            if (!lastNode || lastNode.type !== 'text') return null;
            const chars = Array.from(cursor.text.slice(lastNode.start, lastNode.end));
            let hanCount = 0;
            while (hanCount < chars.length && RubyInlineRule.HAN_REGEX.test(chars[chars.length - 1 - hanCount])) hanCount++;
            if (hanCount === 0) return null;

            const hanStr = chars.slice(chars.length - hanCount).join('');
            const baseStart = lastNode.end - hanStr.length;
            const baseEnd = lastNode.end;
            cursor.advance(1);
            const rt = this.readInlineUntil(cursor, '》');
            if (!rt) return null;
            cursor.advance(1);

            lastNode.end = baseStart;
            if (lastNode.start === lastNode.end) prevNodes.pop();
            return { start: baseStart, end: cursor.currentOffset, props: { baseStart, baseEnd, rtStart: rt.start, rtEnd: rt.end } };
        }
        return null;
    }
}

class TextInlineRule extends InlineRule {
    constructor() { super('text'); }
    match(cursor, { specials }) {
        const start = cursor.currentOffset;
        cursor.advance(1);
        while (!cursor.isEOF) {
            const pos = cursor.pos;
            const hit = specials.some(r => { const m = r.match(cursor, { specials, prevNodes: [] }) !== null; cursor.pos = pos; return m; });
            if (hit || cursor.peek() === '《') break;
            cursor.advance(1);
        }
        return { start, end: cursor.currentOffset, props: {} };
    }
}

window.addEventListener('DOMContentLoaded', (event) => {
    // 実行テスト
    const engine = new ParserEngine();
    engine.setDefaultBlock(new ParagraphBlockRule());
    engine.setDefaultInline(new TextInlineRule());
    engine.register(new CodeFenceRule());
    engine.register(new RubyInlineRule());

    const ast = engine.parse(`これは｜明示ルビ《めいじるび》と省略漢字《しょうりゃくかんじ》のテストです。`);
    console.log(JSON.stringify(ast.children, null, 2));
});

