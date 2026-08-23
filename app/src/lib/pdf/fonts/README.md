# PDF 用の日本語フォント

`jsPDF` の標準フォント（helvetica など）は**日本語のグリフを持たない**。
そのまま日本語を書くと、PDF上は文字化け（豆腐や意味不明な欧文）になる。
請求書は顧客に出る帳票なので、フォントを埋め込んで解決している。

## 収録しているもの

| ファイル | 元 | ウェイト | 収録文字 | サイズ |
|---|---|---|---|---|
| `notoSansJPRegular.ts` | Noto Sans JP | 400 | **cp932 相当の全文字**（JIS X 0208 ＋ NEC/IBM拡張） | 約1.2MB（brotli） |
| `notoSansJPBold.ts` | Noto Sans JP | 700 | ASCII・数字・記号のみ | 約8KB（brotli） |

**なぜ本文用（Regular）を cp932 相当まで載せるか**

請求書には自治体名と備考が入る。どちらも任意の日本語で、
文字が欠けるとその場所が豆腐になる。顧客に出す帳票でそれは許容できない。
cp932 は日本の業務システムが長く前提にしてきた範囲で、
人名・地名に必要な NEC/IBM 拡張（髙・﨑・栁 など）も含む。

**なぜ Bold は ASCII だけか**

太字を日本語まで収録すると、それだけでもう1.2MB増える。
請求書で太字にしたいのは見出し（INVOICE）と金額（¥1,234,567）で、
どちらも欧数字である。日本語の強調は文字サイズと色で表現している。
`registerJapaneseFonts()` は日本語に Bold を使わせない作りになっているので、
うっかり日本語をボールドにしても文字化けはしない。

## 圧縮している理由

サブセット後の TTF は Regular が約2.2MB。base64 にすると約3.0MB になり、
ソースツリーに置くには大きい。brotli で圧縮してから base64 にすると約1.55MB に収まる。
展開は Node 標準の `zlib.brotliDecompressSync` で、プロセスごとに1回だけ実行して
モジュール内にキャッシュする（`japaneseFont.ts`）。

## ライセンス

Noto Sans JP は **SIL Open Font License 1.1**。全文は同ディレクトリの `OFL.txt`。
サブセット・再配布は許諾されている。フォント名に "Noto" を残しているのは
OFL の Reserved Font Name 条項に抵触しない範囲（改変版の名称制限は
Reserved Font Name が指定されている場合のみで、Noto は指定していない）。

## 再生成の手順

フォントを更新する場合、または収録文字を変える場合:

```bash
# 1. 可変フォント（TrueType 形式）を取得
curl -sSL -o NotoSansJP-VF.ttf \
  https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf

# 2. 収録する文字の一覧を作る（cp932 が表せる全文字）
python3 - <<'PY'
chars = set(chr(b) for b in range(0x20, 0x7f))
for lead in list(range(0x81, 0xa0)) + list(range(0xe0, 0xfd)):
    for trail in range(0x40, 0xfd):
        if trail == 0x7f: continue
        try: chars.add(bytes([lead, trail]).decode("cp932"))
        except UnicodeDecodeError: pass
for b in range(0xa1, 0xe0):
    try: chars.add(bytes([b]).decode("cp932"))
    except UnicodeDecodeError: pass
chars.update("¥€№℡㈱㎡√∽≒≡←↑→↓〒※─│┌┐└┘")
open("charset.txt", "w", encoding="utf-8").write("".join(sorted(chars)))
PY

# 3. ウェイトを固定してサブセット化（要 fonttools）
python3 - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
import os
text = open("charset.txt", encoding="utf-8").read()
ascii_text = "".join(chr(c) for c in range(0x20, 0x7f)) + "¥￥－ ・、。（）「」年月日円税込抜合計"
def build(weight, tag, chars):
    f = TTFont("NotoSansJP-VF.ttf")
    instancer.instantiateVariableFont(f, {"wght": weight}, inplace=True)
    tmp = f"tmp-{tag}.ttf"; f.save(tmp)
    o = subset.Options()
    o.layout_features = []; o.name_IDs = [1,2,3,4,6]
    o.notdef_outline = True; o.glyph_names = False; o.hinting = False
    o.drop_tables += ["DSIG","GPOS","GSUB","vmtx","vhea","VORG"]
    f2 = subset.load_font(tmp, o)
    s = subset.Subsetter(options=o); s.populate(text=chars); s.subset(f2)
    subset.save_font(f2, f"NotoSansJP-{tag}.ttf", o); os.remove(tmp)
build(400, "Regular", text)
build(700, "Bold", ascii_text)
PY

# 4. brotli 圧縮 → base64 → TS モジュール（上の2ファイルを書き出す）
```

生成後は `npm run check:invoice` で実際にPDFを作り、
日本語が読める状態か（pdftotext で抽出できるか）を確認すること。
