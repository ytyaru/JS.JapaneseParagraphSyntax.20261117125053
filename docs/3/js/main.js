window.addEventListener('DOMContentLoaded', (event) => {
    console.log('DOMContentLoaded!!');
    /*
    const author = 'ytyaru';
    van.add(document.querySelector('main'), 
        van.tags.h1(van.tags.a({href:`https://github.com/${author}/JS.JapaneseParagraphSyntax.20261117125053/`}, 'JapaneseParagraphSyntax')),
        van.tags.p('日本語段落構文を作る。'),
//        van.tags.p('Create Japanese paragraph syntax.'),
    );
    van.add(document.querySelector('footer'),  new Footer('ytyaru', '../').make());

    const a = new Assertion();
    a.t(true);
    a.f(false);
    a.e(TypeError, `msg`, ()=>{throw new TypeError(`msg`)});
    a.fin();
    */

    const sampleJd = `意味段落１

意味段落２


意味段落３



意味段落４中形式段落１
意味段落４中形式段落２
意味段落４中形式段落３`;

    const parser = new JdParser();
    const ast = parser.parse(sampleJd);

    // 結果の確認
    ast.children.forEach((p1, idx) => {
        console.log(`p1[${idx}] (br=${p1.br}):`);
        p1.children.forEach(p2 => {
            console.log(`  - p2: "${ast.getText(p2)}" (${p2.start}..${p2.end})`);
        });
    });
});
window.addEventListener('beforeunload', (event) => {
    console.log('beforeunload!!');
});

