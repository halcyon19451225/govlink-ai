// ライトテーマ（ニューモーフィズム）では orb は CSS で非表示。
// ダークテーマでは orb アニメーションを維持する。
// 表示制御は globals.css の [data-theme="light"] .orb-* { opacity: 0 } で行う。
export default function GradientBackground() {
  return (
    <div className="gradient-bg">
      {/* ライトテーマのベース背景 */}
      <div className="light-bg-base" />
      {/* ダークテーマの光の玉（ライトテーマでは CSS により非表示） */}
      <div className="orb-1" />
      <div className="orb-2" />
      <div className="orb-3" />
      <div className="orb-4" />
      <div className="orb-5" />
    </div>
  );
}
