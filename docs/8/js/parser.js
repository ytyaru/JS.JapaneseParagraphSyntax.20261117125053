class JdParser {
    parse(text) {
        const cursor = new GraphemeCursor(text);
        const tokens = this.#tokenize(cursor);
        return this.#buildAST(text, tokens);
    }

    // 1. 字句解析（テキスト → トークン列）
    #tokenize(cursor) {
        const tokens = [];

        // 先頭の連続改行をスキップ（仕様: 冒頭のbrは不可）
        const leadingNewlines = cursor.countConsecutive('\n');
        if (leadingNewlines > 0) cursor.advance(leadingNewlines);

        let textStart = cursor.currentOffset;

        while (!cursor.isEOF) {
            const newlineCount = cursor.countConsecutive('\n');

            if (newlineCount > 0) {
                // 改行の直前までをテキストトークンとして確定
                const textEnd = cursor.currentOffset;
                if (textEnd > textStart) {
                    tokens.push({ type: 'TEXT', start: textStart, end: textEnd });
                }

                // 改行トークンを追加
                const nlStart = cursor.currentOffset;
                cursor.advance(newlineCount);
                const nlEnd = cursor.currentOffset;
                tokens.push({
                    type: 'NEWLINE',
                    count: newlineCount,
                    start: nlStart,
                    end: nlEnd
                });

                textStart = cursor.currentOffset;
            } else {
                // 将来ここに「フェンスブロック」や「ルビ」等のメタ文字判定を追加できる
                cursor.advance(1);
            }
        }

        // ファイル末尾の残りテキストを確定
        if (cursor.currentOffset > textStart) {
            tokens.push({ type: 'TEXT', start: textStart, end: cursor.currentOffset });
        }

        // 末尾の連続改行トークンを除去（仕様: 末尾のbrは不可）
        if (tokens.length > 0 && tokens[tokens.length - 1].type === 'NEWLINE') {
            tokens.pop();
        }

        return tokens;
    }

    // 2. 構文解析（トークン列 → AST）
    #buildAST(sourceText, tokens) {
        const ast = new DocumentAST(sourceText);
        if (tokens.length === 0) return ast;

        let currentP1 = null;
        let nextP1Br = 0;

        for (const token of tokens) {
            if (token.type === 'TEXT') {
                if (!currentP1) {
                    currentP1 = new AstNode('p1', token.start, token.end, {
                        br: nextP1Br,
                        children: []
                    });
                    ast.children.push(currentP1);
                    nextP1Br = 0;
                }

                // 形式段落(p2)として追加
                const p2Node = new AstNode('p2', token.start, token.end);
                currentP1.children.push(p2Node);
                currentP1.end = token.end; // p1の終了位置を最新のp2に合わせる
            } 
            else if (token.type === 'NEWLINE') {
                if (token.count === 1) {
                    // 改行1個: 同一p1内のp2区切り（何もしない、次のTEXTが同じp1に入る）
                    continue;
                } else if (token.count >= 2) {
                    // 改行2個以上: p1の区切り。br数は (改行数 - 2)
                    currentP1 = null;
                    nextP1Br = token.count - 2;
                }
            }
        }

        return ast;
    }
}

