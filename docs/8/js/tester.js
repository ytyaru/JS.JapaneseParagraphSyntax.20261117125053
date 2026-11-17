// ============================================================================
// [本番用] 高速ワンパス Inline パーサー（O(N) 動作・重複チェックのオーバーヘッドなし）
// ============================================================================
class FastParserEngine extends ParserEngine {
    parseInlineLayer(text, start, end, allowedIds = null) {
        const inlineUnits = this.getUnitsByLayer('inline', allowedIds)
            .filter(u => u.rule.id !== this.defaultInlineId);
        const defaultLexer = this.units.get(this.defaultInlineId)?.lexer;
        const nodes = [];
        let pos = start;

        while (pos < end) {
            let earliestToken = null;
            let matchedUnit = null;

            // 現在位置 pos 以降で最も手前に現れる構文を1つだけ取得
            for (const unit of inlineUnits) {
                const token = unit.tokenizer.findNext(text, pos, end);
                if (token && (!earliestToken || token.start < earliestToken.start)) {
                    earliestToken = token;
                    matchedUnit = unit;
                }
            }

            if (!earliestToken) {
                if (defaultLexer) {
                    nodes.push(defaultLexer.lex(new Token(this.defaultInlineId, pos, end), this));
                }
                break;
            }

            if (earliestToken.start > pos && defaultLexer) {
                nodes.push(defaultLexer.lex(new Token(this.defaultInlineId, pos, earliestToken.start), this));
            }

            nodes.push(matchedUnit.lexer.lex(earliestToken, this));
            pos = earliestToken.end;
        }
        return nodes;
    }
}

// ============================================================================
// [開発時専用] 構文追加・変更時にのみ実行する衝突検証ツール
// ============================================================================
class GrammarCollisionTester {
    constructor(engine) {
        this.engine = engine;
    }

    // テスト用原稿の各行（p2）に対して全Inlineルールの区間重複を検査
    verifyInlineRules(sampleText) {
        const inlineUnits = this.engine.getUnitsByLayer('inline')
            .filter(u => u.rule.id !== this.engine.defaultInlineId);
        const lines = sampleText.split('\n');
        const conflicts = [];

        lines.forEach((line, lineIndex) => {
            const allTokens = [];
            for (const unit of inlineUnits) {
                if (unit.tokenizer.findAll) {
                    allTokens.push(...unit.tokenizer.findAll(line, 0, line.length));
                }
            }
            allTokens.sort((a, b) => a.start - b.start || a.end - b.end);

            for (let i = 1; i < allTokens.length; i++) {
                const prev = allTokens[i - 1];
                const curr = allTokens[i];
                if (prev.end > curr.start) {
                    conflicts.push({
                        line: lineIndex + 1,
                        text: line,
                        ruleA: prev.type,
                        spanA: [prev.start, prev.end],
                        ruleB: curr.type,
                        spanB: [curr.start, curr.end]
                    });
                }
            }
        });

        return conflicts;
    }
}

