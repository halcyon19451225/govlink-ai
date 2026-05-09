"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const DEG              = Math.PI / 180;
const BASE_ROT_SPEED   = 0.0008;
const X_OFFSET         = 100;
const CANVAS_EXTRA_RIGHT  = 700;
const CANVAS_EXTRA_LEFT   = 500; // テキスト列まで粒を広げる
const CANVAS_EXTRA_TOP    = 300;
const CANVAS_EXTRA_BOTTOM = 300;

// ── GLSL シェーダー ────────────────────────────────────────────────────────────
const VERT = `
  attribute float aSize;
  attribute float aBaseOpacity;
  attribute float aPhase;
  uniform   float uTime;
  uniform   float uPixelRatio;
  varying   float vOpacity;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize    = aSize * uPixelRatio * (200.0 / -mvPosition.z);
    gl_Position     = projectionMatrix * mvPosition;
    vOpacity        = aBaseOpacity * (0.7 + 0.3 * sin(uTime * 0.5 + aPhase));
  }
`;

const FRAG = `
  uniform sampler2D uTexture;
  uniform vec3      uColor;
  varying float     vOpacity;

  void main() {
    vec4 tex     = texture2D(uTexture, gl_PointCoord);
    gl_FragColor = vec4(tex.rgb * uColor, tex.a * vOpacity);
  }
`;

// ── 白い単色丸テクスチャ（色はシェーダー側の uColor で制御） ──────────────────
function makeCircleTex(size: number): THREE.CanvasTexture {
  const c   = document.createElement("canvas");
  c.width   = size;
  c.height  = size;
  const ctx = c.getContext("2d")!;
  const h   = size / 2;
  const r   = h - 2;

  ctx.beginPath();
  ctx.arc(h, h, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = "rgba(255, 255, 255, 1.0)";
  ctx.fill();

  return new THREE.CanvasTexture(c);
}

// ── グループ仕様 ──────────────────────────────────────────────────────────────
interface GroupSpec {
  countPerRing: number;
  minSize:      number;
  maxSize:      number;
  minOpacity:   number;
  maxOpacity:   number;
  useLargeTex:  boolean;
  hexDark:      number; // ダークテーマ時カラー
  hexLight:     number; // ライトテーマ時カラー
}

const GROUP_SPECS: GroupSpec[] = [
  // A: 大玉  — ダーク: ゴールド / ライト: ターコイズ
  { countPerRing: 23,  minSize: 35, maxSize: 60, minOpacity: 0.6, maxOpacity: 0.9, useLargeTex: true,  hexDark: 0xFFD73C, hexLight: 0x06b6d4 },
  // B: 中玉  — ダーク: ゴールド / ライト: ミドルブルー
  { countPerRing: 65,  minSize: 12, maxSize: 28, minOpacity: 0.4, maxOpacity: 0.7, useLargeTex: true,  hexDark: 0xFFD73C, hexLight: 0x1ba8ee },
  // C: 小点  — ダーク: ゴールド / ライト: ブルー
  { countPerRing: 130, minSize:  3, maxSize:  8, minOpacity: 0.5, maxOpacity: 1.0, useLargeTex: false, hexDark: 0xFFD73C, hexLight: 0x3b82f6 },
];

// ── リング設定 ────────────────────────────────────────────────────────────────
interface RingConfig {
  radius:    number;
  ySpread:   number;
  tiltX:     number;
  tiltZ:     number;
  speedMult: number;
}

const RING_CONFIGS: RingConfig[] = [
  { radius: 180, ySpread: 10, tiltX:  5*DEG, tiltZ:  3*DEG, speedMult: 1.2 },
  { radius: 240, ySpread: 13, tiltX: -8*DEG, tiltZ:  5*DEG, speedMult: 1.0 },
  { radius: 290, ySpread: 15, tiltX: 12*DEG, tiltZ: -4*DEG, speedMult: 0.9 },
  { radius: 330, ySpread: 13, tiltX:-15*DEG, tiltZ:  7*DEG, speedMult: 0.8 },
];

// ── データ型 ──────────────────────────────────────────────────────────────────
interface RingGroup {
  geometry:     THREE.BufferGeometry;
  material:     THREE.ShaderMaterial;
  colorUniform: { value: THREE.Color };
  groupIdx:     number;
  startIdx:     number;
  count:        number;
}

interface RingData {
  groups:        RingGroup[];
  baseAngles:    Float32Array;
  yOffsets:      Float32Array;
  radiusOffsets: Float32Array;
  rotation:      number;
  config:        RingConfig;
  cosX: number; sinX: number;
  cosZ: number; sinZ: number;
}

// ── コンポーネント ─────────────────────────────────────────────────────────────
export default function HeroParticles() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const containerW = container.clientWidth  || 600;
    const containerH = container.clientHeight || 400;
    const w = containerW + CANVAS_EXTRA_RIGHT + CANVAS_EXTRA_LEFT;
    const h = containerH + CANVAS_EXTRA_TOP + CANVAS_EXTRA_BOTTOM;

    // ── テクスチャ ─────────────────────────────────────────────────────────
    const largeTex = makeCircleTex(64);
    const smallTex = makeCircleTex(32);

    // ── 共有ユニフォーム（全マテリアルで同一オブジェクトを参照） ──────────
    const timeUniform = { value: 0 };
    const dprUniform  = { value: window.devicePixelRatio };

    // ── シーン・カメラ・レンダラー ─────────────────────────────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    camera.position.set(-120, 60, 200);
    camera.lookAt(80, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);

    // ── リングデータ生成 ───────────────────────────────────────────────────
    const totalPerRing = GROUP_SPECS.reduce((s, g) => s + g.countPerRing, 0);

    const ringDataList: RingData[] = RING_CONFIGS.map((cfg) => {
      const { ySpread, tiltX, tiltZ } = cfg;

      const baseAngles    = new Float32Array(totalPerRing);
      const yOffsets      = new Float32Array(totalPerRing);
      const radiusOffsets = new Float32Array(totalPerRing);
      for (let i = 0; i < totalPerRing; i++) {
        baseAngles[i]    = Math.random() * Math.PI * 2;
        yOffsets[i]      = (Math.random() - 0.5) * ySpread * 2;
        radiusOffsets[i] = (Math.random() - 0.5) * 24;
      }

      let startIdx = 0;
      const groups: RingGroup[] = GROUP_SPECS.map((spec, groupIdx) => {
        const count     = spec.countPerRing;
        const positions = new Float32Array(count * 3);
        const sizes     = new Float32Array(count);
        const opacities = new Float32Array(count);
        const phases    = new Float32Array(count);

        for (let i = 0; i < count; i++) {
          sizes[i]     = spec.minSize + Math.random() * (spec.maxSize - spec.minSize);
          opacities[i] = spec.minOpacity + Math.random() * (spec.maxOpacity - spec.minOpacity);
          phases[i]    = Math.random() * Math.PI * 2;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position",     new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("aSize",        new THREE.BufferAttribute(sizes,     1));
        geometry.setAttribute("aBaseOpacity", new THREE.BufferAttribute(opacities, 1));
        geometry.setAttribute("aPhase",       new THREE.BufferAttribute(phases,    1));

        const colorUniform = { value: new THREE.Color(spec.hexDark) };

        const material = new THREE.ShaderMaterial({
          uniforms: {
            uTime:       timeUniform,
            uPixelRatio: dprUniform,
            uTexture:    { value: spec.useLargeTex ? largeTex : smallTex },
            uColor:      colorUniform,
          },
          vertexShader:   VERT,
          fragmentShader: FRAG,
          transparent:    true,
          blending:       THREE.AdditiveBlending,
          depthWrite:     false,
        });

        scene.add(new THREE.Points(geometry, material));

        const rg: RingGroup = { geometry, material, colorUniform, groupIdx, startIdx, count };
        startIdx += count;
        return rg;
      });

      return {
        groups,
        baseAngles,
        yOffsets,
        radiusOffsets,
        rotation: 0,
        config: cfg,
        cosX: Math.cos(tiltX), sinX: Math.sin(tiltX),
        cosZ: Math.cos(tiltZ), sinZ: Math.sin(tiltZ),
      };
    });

    // ── アニメーション ─────────────────────────────────────────────────────
    let animId = 0;
    let time   = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      time  += 0.01;
      timeUniform.value = time;

      const isDark = document.body.dataset.theme !== "light";

      for (const rd of ringDataList) {
        rd.rotation += BASE_ROT_SPEED * rd.config.speedMult;
        const { cosX, sinX, cosZ, sinZ, config: { radius } } = rd;

        for (const rg of rd.groups) {
          // テーマに応じてカラーを毎フレーム更新
          const spec = GROUP_SPECS[rg.groupIdx]!;
          rg.colorUniform.value.setHex(isDark ? spec.hexDark : spec.hexLight);

          const posAttr = rg.geometry.attributes["position"] as THREE.BufferAttribute;
          for (let i = 0; i < rg.count; i++) {
            const gi    = rg.startIdx + i;
            const angle = rd.baseAngles[gi]! + rd.rotation;
            const r     = radius + rd.radiusOffsets[gi]!;
            const x0 = Math.cos(angle) * r;
            const z0 = Math.sin(angle) * r;
            const y0 = rd.yOffsets[gi]!;

            // X軸傾き → Z軸傾き
            const y1 = y0 * cosX - z0 * sinX;
            const z1 = y0 * sinX + z0 * cosX;
            const x2 = x0 * cosZ + y1 * sinZ;
            const y2 = -x0 * sinZ + y1 * cosZ;

            posAttr.setXYZ(i, x2 + X_OFFSET, y2, z1);
          }
          posAttr.needsUpdate = true;
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    // ── リサイズ対応 ───────────────────────────────────────────────────────
    const resizeObserver = new ResizeObserver(() => {
      const nw = container.clientWidth  + CANVAS_EXTRA_RIGHT + CANVAS_EXTRA_LEFT;
      const nh = container.clientHeight + CANVAS_EXTRA_TOP + CANVAS_EXTRA_BOTTOM;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    resizeObserver.observe(container);

    // ── クリーンアップ ─────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      for (const rd of ringDataList) {
        for (const rg of rd.groups) {
          rg.geometry.dispose();
          rg.material.dispose();
        }
      }
      largeTex.dispose();
      smallTex.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: -CANVAS_EXTRA_TOP,
          left: -CANVAS_EXTRA_LEFT,
          background: "transparent",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
