/**
 * ASTのルートオブジェクト
 */
class DocumentAST {
    constructor(sourceText, meta = {}) {
        this.type = 'root';
        this.source = sourceText; // 原稿テキスト全体（参照のみ保持）
        this.meta = meta;         // Frontmatter等の設定値
        this.children = [];       // P1Node の配列
    }

    // ノードの実際のテキストを遅延取得するヘルパー
    getText(node) {
        if (node.value !== undefined) return node.value;
        return this.source.slice(node.start, node.end);
    }
}

/**
 * 汎用ASTノード基底クラス
 */
class AstNode {
    constructor(type, start, end, props = {}) {
        this.type = type;   // 'p1' | 'p2' | 'text' | ...
        this.start = start; // 原稿内の開始UTF-16インデックス
        this.end = end;     // 原稿内の終了UTF-16インデックス
        Object.assign(this, props); // br数、indent有無などの固有属性
    }
}

