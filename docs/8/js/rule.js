/**
 * 構文ルールの基底インターフェース
 */
class SyntaxRule {
    constructor({ id, group, priority = 100, allowedChildGroups = [] }) {
        this.id = id;
        this.group = group; // 'block' | 'inline' | 'separator'
        this.priority = priority; // 数値が小さいほど先に判定（干渉・順序制御）
        this.allowedChildGroups = allowedChildGroups;
    }

    // SubTokenizer: マッチすれば { end, rawProps } を返す。しなければ null
    match(cursor, limitOffset) {
        throw new Error('Not implemented');
    }

    // SubLexer: トークンから AstNode を構築する
    buildNode(token, parseChildren) {
        const node = new AstNode(this.id, token.start, token.end, token.rawProps);
        if (this.allowedChildGroups.length > 0 && token.contentStart !== undefined) {
            node.children = parseChildren(
                token.contentStart,
                token.contentEnd,
                this.allowedChildGroups
            );
        }
        return node;
    }
}

/**
 * 拡張可能な再帰パーサーエンジン
 */
class ParserEngine {
    constructor() {
        this.rules = [];
    }

    register(rule) {
        this.rules.push(rule);
        // 優先度順にソート（例: フェンスブロックは一般テキストより先に判定する）
        this.rules.sort((a, b) => a.priority - b.priority);
    }

    // 指定範囲・指定グループで再帰的にパースを実行
    parseRange(text, startOffset, endOffset, allowedGroups) {
        const cursor = new GraphemeCursor(text, startOffset, endOffset);
        const activeRules = this.rules.filter(r => allowedGroups.includes(r.group));
        const nodes = [];

        while (!cursor.isEOF) {
            let matched = false;

            for (const rule of activeRules) {
                const matchResult = rule.match(cursor, endOffset);
                if (matchResult) {
                    const token = {
                        type: rule.id,
                        start: cursor.currentOffset,
                        end: matchResult.end,
                        contentStart: matchResult.contentStart,
                        contentEnd: matchResult.contentEnd,
                        rawProps: matchResult.rawProps || {}
                    };

                    // 再帰用のコールバックを渡してノード生成
                    const node = rule.buildNode(token, (cStart, cEnd, childGroups) => {
                        return this.parseRange(text, cStart, cEnd, childGroups);
                    });

                    nodes.push(node);
                    cursor.moveToOffset(matchResult.end);
                    matched = true;
                    break;
                }
            }

            // どのルールにもマッチしなかった場合のフォールバック（1書記素進める等）
            if (!matched) {
                cursor.advance(1);
            }
        }
        return nodes;
    }
}

