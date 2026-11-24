// 1. 共通部品の定義
const PIPE = '[|｜]';
const TEXT_CONTENT = '([^|｜《》\\n]+)'; // メタ文字と改行を除外したテキスト（キャプチャグループ）
const KANJI_WITH_IVS = '((?:[\\p{Script=Han}々仝〆〇ヶヵ〻][\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}]?)+)';

// 2. 各構文の正規表現を組み立て（uフラグでUnicode/異体字セレクタに対応）
const ESCAPE_REGEXP = new RegExp(`${PIPE}《`, 'gu');
const EMPHASIS_REGEXP = new RegExp(`《《${TEXT_CONTENT}》》`, 'gu');
const RUBY_WITH_PIPE_REGEXP = new RegExp(`${PIPE}${TEXT_CONTENT}《${TEXT_CONTENT}》`, 'gu');
const RUBY_WITHOUT_PIPE_REGEXP = new RegExp(`${KANJI_WITH_IVS}《${TEXT_CONTENT}》`, 'gu');

function parseKakuyomuDirect(text) {
  return text
    // HTML特殊文字の無害化
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // カクヨム構文の変換
    .replace(ESCAPE_REGEXP, '&#x300A;')
    .replace(EMPHASIS_REGEXP, '<em class="emphasis">$1</em>')
    .replace(RUBY_WITH_PIPE_REGEXP, '<ruby>$1<rt>$2</rt></ruby>')
    .replace(RUBY_WITHOUT_PIPE_REGEXP, '<ruby>$1<rt>$2</rt></ruby>');
