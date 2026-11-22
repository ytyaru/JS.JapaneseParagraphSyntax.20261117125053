class GraphemeCursor {
    constructor(text) {
        this.text = text;
        // 日本語ロケールで書記素単位に分割
        const segmenter = new Intl.Segmenter('ja-JP', { granularity: 'grapheme' });
        // 各書記素の文字列と、元テキスト上のUTF-16開始位置(index)を配列化
        this.segments = Array.from(segmenter.segment(text));
        this.pos = 0; // 現在の書記素インデックス
    }

    get isEOF() {
        return this.pos >= this.segments.length;
    }

    // 現在の書記素のUTF-16開始位置を取得
    get currentOffset() {
        if (this.isEOF) return this.text.length;
        return this.segments[this.pos].index;
    }

    // 現在位置から指定した文字列(メタ文字列)に一致するか判定
    matchString(targetStr) {
        const currentUtf16Pos = this.currentOffset;
        return this.text.startsWith(targetStr, currentUtf16Pos);
    }

    // 指定した連続文字がいくつ続くかカウント（例: 連続する '\n' の数）
    countConsecutive(targetGrapheme) {
        let count = 0;
        while (
            this.pos + count < this.segments.length &&
            this.segments[this.pos + count].segment === targetGrapheme
        ) {
            count++;
        }
        return count;
    }

    // 指定した書記素数だけカーソルを進める
    advance(step = 1) {
        this.pos = Math.min(this.pos + step, this.segments.length);
    }
}

