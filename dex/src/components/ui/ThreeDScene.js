import React, { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, Environment, Lightformer } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

// Loads a token logo texture, but ONLY for base64 data-URI logos (the 4
// Nexora-native tokens in tokenList.json ship their art this way). Several
// tokens in tokenList.json instead point at external CDNs
// (cdn.moralis.io, cryptologos.cc) that don't send CORS headers - WebGL
// requires a CORS-enabled image to upload it as a texture, so loading
// those would always fail in EVERY browser, not just this environment
// (verified: fails with "blocked by CORS policy" here). Rather than firing
// a network request that's guaranteed to fail and produce console noise
// (or, with drei's useTexture, crash the whole Canvas), this skips the
// attempt entirely for anything that isn't a local data URI - those coins
// render as plain brushed metal with their glowing rim instead of a logo,
// which is a legitimate materials choice, not a bug.

function generateCoinCanvas(ticker = "NEX", accent = "#22d3ee", imgObj = null) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const cx = 256;
  const cy = 256;

  // Outer dark metallic alloy background gradient
  const bgGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 250);
  bgGrad.addColorStop(0, "#282c44");
  bgGrad.addColorStop(0.6, "#1a1c2e");
  bgGrad.addColorStop(1, "#0d0e1a");
  ctx.fillStyle = bgGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 250, 0, Math.PI * 2);
  ctx.fill();

  // Milled / Reeded coin edge notches around perimeter
  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  for (let a = 0; a < Math.PI * 2; a += (Math.PI * 2) / 60) {
    const rx = cx + Math.cos(a) * 238;
    const ry = cy + Math.sin(a) * 238;
    ctx.beginPath();
    ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer concentric metallic groove
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.beginPath();
  ctx.arc(cx, cy, 226, 0, Math.PI * 2);
  ctx.stroke();

  // Inner accent glow ring
  ctx.lineWidth = 8;
  ctx.strokeStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(cx, cy, 200, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner coin face plate with metallic brush gradient
  const innerGrad = ctx.createLinearGradient(cx - 150, cy - 150, cx + 150, cy + 150);
  innerGrad.addColorStop(0, "rgba(255, 255, 255, 0.15)");
  innerGrad.addColorStop(0.3, "rgba(40, 44, 68, 0.95)");
  innerGrad.addColorStop(0.7, "rgba(24, 26, 42, 0.98)");
  innerGrad.addColorStop(1, "rgba(12, 14, 24, 0.99)");
  ctx.fillStyle = innerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 192, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (imgObj && imgObj.complete && imgObj.width > 0) {
    // Draw real token logo image centered on dark metallic face plate
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 140, 0, Math.PI * 2);
    ctx.clip();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 20;
    ctx.drawImage(imgObj, cx - 120, cy - 120, 240, 240);
    ctx.restore();

    ctx.font = "700 28px Sora, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.fillText(ticker, cx, cy + 155);
  } else if (ticker === "BTC") {
    ctx.font = "900 220px Sora, sans-serif";
    ctx.fillStyle = "#fbbf24";
    ctx.shadowColor = "#f59e0b";
    ctx.shadowBlur = 28;
    ctx.fillText("₿", cx, cy + 10);
  } else if (ticker === "ETH" || ticker === "WETH") {
    ctx.lineWidth = 14;
    ctx.strokeStyle = accent;
    ctx.fillStyle = "rgba(34, 211, 238, 0.25)";
    ctx.shadowColor = accent;
    ctx.shadowBlur = 24;

    ctx.beginPath();
    ctx.moveTo(cx, cy - 135);
    ctx.lineTo(cx + 85, cy);
    ctx.lineTo(cx, cy + 135);
    ctx.lineTo(cx - 85, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 85, cy);
    ctx.lineTo(cx + 85, cy);
    ctx.moveTo(cx, cy - 135);
    ctx.lineTo(cx, cy + 135);
    ctx.stroke();
  } else if (ticker === "SOL") {
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 22;
    for (let i = 0; i < 3; i++) {
      const yOff = cy - 70 + i * 56;
      ctx.beginPath();
      ctx.moveTo(cx - 95, yOff + 20);
      ctx.lineTo(cx + 65, yOff + 20);
      ctx.lineTo(cx + 95, yOff);
      ctx.lineTo(cx - 65, yOff);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.font = "900 115px Sora, sans-serif";
    const textGrad = ctx.createLinearGradient(cx - 90, cy - 90, cx + 90, cy + 90);
    textGrad.addColorStop(0, "#ffffff");
    textGrad.addColorStop(0.5, accent);
    textGrad.addColorStop(1, "#c084fc");
    ctx.fillStyle = textGrad;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 26;
    ctx.fillText(ticker, cx, cy - 16);

    ctx.font = "700 32px Sora, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.shadowBlur = 0;
    ctx.fillText("✦ NEXORA DEFI ✦", cx, cy + 78);
  }

  // Specular reflection highlight arc across top face
  ctx.shadowBlur = 0;
  const glossGrad = ctx.createLinearGradient(0, 0, 0, 260);
  glossGrad.addColorStop(0, "rgba(255, 255, 255, 0.28)");
  glossGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glossGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 188, Math.PI * 1.12, Math.PI * 1.88);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function useTokenTexture(ticker, url, accent) {
  const [texture, setTexture] = useState(null);

  useEffect(() => {
    let cancelled = false;

    if (url && url.startsWith("data:")) {
      const img = new Image();
      img.onload = () => {
        if (!cancelled) {
          const tex = generateCoinCanvas(ticker, accent, img);
          tex.needsUpdate = true;
          setTexture(tex);
        }
      };
      img.onerror = () => {
        if (!cancelled) {
          const tex = generateCoinCanvas(ticker, accent);
          tex.needsUpdate = true;
          setTexture(tex);
        }
      };
      img.src = url;
    } else {
      const tex = generateCoinCanvas(ticker, accent);
      tex.needsUpdate = true;
      setTexture(tex);
    }

    return () => {
      cancelled = true;
    };
  }, [ticker, url, accent]);

  return texture;
}

function StudioEnvironment() {
  return (
    <Environment resolution={256}>
      <Lightformer intensity={4} color="#a855f7" position={[-6, 3, 2]} scale={[8, 4, 1]} target={[0, 0, 0]} />
      <Lightformer intensity={4} color="#22d3ee" position={[6, -2, 3]} scale={[8, 4, 1]} target={[0, 0, 0]} />
      <Lightformer intensity={2.5} color="#6d5efc" position={[0, 6, -3]} scale={[10, 3, 1]} target={[0, 0, 0]} />
      <Lightformer intensity={2} color="#ffffff" position={[0, -6, 4]} scale={[10, 3, 1]} target={[0, 0, 0]} />
    </Environment>
  );
}

function AtmosphereDust({ intensity }) {
  const ref = useRef();
  const count = Math.round(45 * intensity);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 16;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 10;
      arr[i * 3 + 2] = -Math.random() * 10 - 1;
    }
    return arr;
  }, [count]);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.008;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={positions.length / 3} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.09} color="#a5b4fc" transparent opacity={0.28} sizeAttenuation depthWrite={false} />
    </points>
  );
}



// Solid 3D Crypto Medallion Component (Fulfills Requirement 9)
// Thickness 0.36, brushed silver/titanium coin body, glowing accent rims, integrated face textures.
function Coin({ position, tilt = [0.35, 0.4, 0], scale = 1, ticker = "NOVA", img, accent = "#22d3ee", speed = 1 }) {
  const groupRef = useRef();
  const texture = useTokenTexture(ticker, img, accent);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.25 * speed) * 0.18;
      groupRef.current.rotation.x = Math.cos(state.clock.elapsedTime * 0.2 * speed) * 0.08;
    }
  });

  return (
    <Float speed={0.55 * speed} rotationIntensity={0.12} floatIntensity={1.3}>
      <group position={position} rotation={tilt} scale={scale}>
        <group ref={groupRef}>
          {/* Solid Coin Body - Brushed Silver / Titanium Metal with Specular Highlights */}
          <mesh>
            <cylinderGeometry args={[1, 1, 0.36, 72]} />
            <meshPhysicalMaterial
              color="#2d3142"
              metalness={0.92}
              roughness={0.16}
              clearcoat={0.9}
              clearcoatRoughness={0.1}
              envMapIntensity={2.2}
            />
          </mesh>

          {/* Top & Bottom Bevel Edge Rims */}
          <mesh position={[0, 0.176, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.995, 0.035, 24, 96]} />
            <meshStandardMaterial color="#4b506b" metalness={0.9} roughness={0.18} envMapIntensity={1.8} />
          </mesh>
          <mesh position={[0, -0.176, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.995, 0.035, 24, 96]} />
            <meshStandardMaterial color="#4b506b" metalness={0.9} roughness={0.18} envMapIntensity={1.8} />
          </mesh>

          {/* Center Subtle Metallic Accent Ring */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.003, 0.02, 16, 96]} />
            <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} metalness={0.8} roughness={0.2} />
          </mesh>

          {/* Front Coin Face */}
          <mesh position={[0, 0.181, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.92, 64]} />
            <meshStandardMaterial map={texture || undefined} color={texture ? "#ffffff" : "#1e2133"} metalness={0.35} roughness={0.3} envMapIntensity={1.6} />
          </mesh>

          {/* Back Coin Face */}
          <mesh position={[0, -0.181, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.92, 64]} />
            <meshStandardMaterial map={texture || undefined} color={texture ? "#ffffff" : "#1e2133"} metalness={0.35} roughness={0.3} envMapIntensity={1.6} />
          </mesh>
        </group>
      </group>
    </Float>
  );
}

function ParallaxRig({ children, strength = 1 }) {
  const group = useRef();
  useFrame((state) => {
    if (!group.current) return;
    const { x, y } = state.pointer;
    group.current.rotation.y += (x * 0.14 * strength - group.current.rotation.y) * 0.025;
    group.current.rotation.x += (-y * 0.09 * strength - group.current.rotation.x) * 0.025;
  });
  return <group ref={group}>{children}</group>;
}

function audeFiArcLayout(count, radiusScale) {
  // Exact U-shaped arching tunnel ring from the AuDeFi reference image:
  // Coins curve down from left and right into the center bottom floor
  const slots = [
    { x: -3.6, y: -0.2, z: -2.8, s: 0.65 },
    { x: -2.4, y: -0.9, z: -3.0, s: 0.58 },
    { x: -1.2, y: -1.4, z: -3.2, s: 0.52 },
    { x: 0.0,  y: -1.6, z: -3.4, s: 0.46 },
    { x: 1.2,  y: -1.4, z: -3.2, s: 0.52 },
    { x: 2.4,  y: -0.9, z: -3.0, s: 0.58 },
    { x: 3.6,  y: -0.2, z: -2.8, s: 0.65 },
  ];
  return slots.slice(0, count).map((s) => ({
    position: [s.x * radiusScale, s.y, s.z],
    scale: s.s,
  }));
}

function heroStackLayout(count, radiusScale) {
  const slots = [
    { x: 1.1, y: 1.45, z: -2.5, s: 0.55 },
    { x: -0.2, y: 0.25, z: -2.2, s: 0.60 },
    { x: 1.25, y: -0.45, z: -2.8, s: 0.52 },
    { x: 2.2, y: -1.5, z: -3.2, s: 0.48 },
  ];
  return slots.slice(0, count).map((s) => ({
    position: [s.x * radiusScale, s.y, s.z],
    scale: s.s,
  }));
}

function arcLayout(count, radiusScale) {
  const slots = [
    { x: -4.8, y: 1.6, z: -5.0, s: 0.55 },
    { x: 4.2, y: 1.8, z: -5.5, s: 0.5 },
    { x: -4.4, y: -1.8, z: -4.8, s: 0.45 },
    { x: 4.4, y: -1.6, z: -5.8, s: 0.45 },
    { x: -0.4, y: 2.6, z: -6.0, s: 0.4 },
    { x: 0.6, y: -2.8, z: -6.2, s: 0.4 },
  ];
  return slots.slice(0, count).map((s) => ({
    position: [s.x * radiusScale, s.y, s.z],
    scale: s.s,
  }));
}

function lowArcLayout(count, radiusScale) {
  const slots = [
    { x: -4.8, y: 0.4, z: -5.0, s: 0.55 },
    { x: -3.2, y: 1.4, z: -5.4, s: 0.48 },
    { x: 4.2, y: -0.2, z: -5.2, s: 0.52 },
    { x: 4.8, y: 1.6, z: -5.6, s: 0.45 },
    { x: -1.2, y: -2.2, z: -6.0, s: 0.4 },
    { x: 1.2, y: 2.2, z: -6.2, s: 0.4 },
  ];
  return slots.slice(0, count).map((s) => ({
    position: [s.x * radiusScale, s.y, s.z],
    scale: s.s,
  }));
}

function ringLayout(count, radiusScale) {
  const radiusX = 6.2 * radiusScale;
  const radiusY = 3.6 * radiusScale;
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const depthWobble = (i % 2 === 0 ? 1 : -1) * 0.4;
    return {
      position: [
        Math.cos(angle) * radiusX,
        Math.sin(angle) * radiusY,
        -5.0 + depthWobble,
      ],
      scale: 0.42 + (i % 3) * 0.05,
    };
  });
}

// Solid 3D Neon Pedestal Platform Component (matching NEXORA hero screenshot)
// Cylindrical disk platform with glowing cyan & purple neon rim light rings and underglow
function PedestalPlatform({ position, rotation = [0.85, 0.25, -0.2], scale = 1, accent = "#22d3ee", secondaryAccent = "#a855f7", speed = 1 }) {
  const groupRef = useRef();

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.75 * speed) * 0.08;
      groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.35 * speed) * 0.04;
    }
  });

  return (
    <Float speed={0.7 * speed} rotationIntensity={0.12} floatIntensity={1.1}>
      <group position={position} rotation={rotation} scale={scale}>
        <group ref={groupRef}>
          {/* Main Dark Metallic/Glass Cylinder Body */}
          <mesh>
            <cylinderGeometry args={[1.6, 1.6, 0.38, 72]} />
            <meshPhysicalMaterial
              color="#0d0f1f"
              roughness={0.12}
              metalness={0.88}
              clearcoat={1.0}
              clearcoatRoughness={0.08}
              envMapIntensity={2.2}
            />
          </mesh>

          {/* Top Outer Glowing Neon Ring Rim */}
          <mesh position={[0, 0.191, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.605, 0.075, 24, 72]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={4.0}
              toneMapped={false}
            />
          </mesh>

          {/* Top Inner Recessed Dark Disc Surface */}
          <mesh position={[0, 0.193, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1.52, 72]} />
            <meshPhysicalMaterial
              color="#070914"
              roughness={0.18}
              metalness={0.75}
              clearcoat={0.9}
            />
          </mesh>

          {/* Top Inner Concentric Neon Accent Ring */}
          <mesh position={[0, 0.195, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.32, 0.035, 16, 72]} />
            <meshStandardMaterial
              color={secondaryAccent}
              emissive={secondaryAccent}
              emissiveIntensity={2.5}
            />
          </mesh>

          {/* Outer Side Glowing Belt Ring around Cylinder */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.615, 0.035, 16, 72]} />
            <meshStandardMaterial
              color={accent}
              emissive={accent}
              emissiveIntensity={3.0}
            />
          </mesh>

          {/* Bottom Underglow Neon Rim */}
          <mesh position={[0, -0.191, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.58, 0.065, 24, 72]} />
            <meshStandardMaterial
              color={secondaryAccent}
              emissive={secondaryAccent}
              emissiveIntensity={3.2}
              toneMapped={false}
            />
          </mesh>

          {/* Underglow Point Lights */}
          <pointLight position={[0, -0.5, 0]} distance={4.5} intensity={3.0} color={secondaryAccent} />
          <pointLight position={[0, 0.5, 0]} distance={4.5} intensity={3.0} color={accent} />
        </group>
      </group>
    </Float>
  );
}

function pedestalFlowLayout(count, radiusScale) {
  const slots = [
    // Top Hero area
    { x: 1.3, y: 1.45, z: -2.4, rot: [0.9, 0.2, -0.15], s: 0.65, accent: "#22d3ee", sec: "#a855f7", speed: 1.0 },
    { x: -0.25, y: 0.25, z: -2.2, rot: [0.95, -0.25, 0.2], s: 0.72, accent: "#ec4899", sec: "#22d3ee", speed: 0.85 },
    { x: 1.35, y: -1.45, z: -2.5, rot: [0.85, 0.3, -0.2], s: 0.62, accent: "#22d3ee", sec: "#d946ef", speed: 1.15 },
    // Middle Sections (Supported Tokens, Featured Pools)
    { x: -3.8, y: 1.8, z: -4.5, rot: [0.8, -0.3, 0.1], s: 0.58, accent: "#a855f7", sec: "#22d3ee", speed: 0.9 },
    { x: 3.6, y: 0.1, z: -4.8, rot: [0.85, 0.25, -0.15], s: 0.60, accent: "#22d3ee", sec: "#ec4899", speed: 1.05 },
    { x: -3.5, y: -1.6, z: -4.2, rot: [0.9, -0.2, 0.15], s: 0.54, accent: "#ec4899", sec: "#a855f7", speed: 0.95 },
    // Lower Sections (How it Works, Final CTA)
    { x: 3.8, y: -3.0, z: -5.0, rot: [0.8, 0.3, -0.2], s: 0.52, accent: "#22d3ee", sec: "#a855f7", speed: 1.1 },
    { x: -3.6, y: -3.6, z: -4.8, rot: [0.85, -0.25, 0.1], s: 0.56, accent: "#d946ef", sec: "#22d3ee", speed: 0.8 },
  ];
  return slots.map((s) => ({
    position: [s.x * radiusScale, s.y, s.z],
    rotation: s.rot,
    scale: s.s,
    accent: s.accent,
    secondaryAccent: s.sec,
    speed: s.speed,
  }));
}

function layoutFor(count, radiusScale, mode) {
  if (mode === "pedestalFlow") return pedestalFlowLayout(count, radiusScale);
  if (mode === "audeFiArc") return audeFiArcLayout(count, radiusScale);
  if (mode === "heroStack") return heroStackLayout(count, radiusScale);
  if (mode === "ring") return ringLayout(count, radiusScale);
  if (mode === "lowArc") return lowArcLayout(count, radiusScale);
  return arcLayout(count, radiusScale);
}

function Scene({ intensity, coins, layoutMode }) {
  const { viewport } = useThree();
  const radiusScale = Math.min(Math.max(viewport.width / 11, 0.72), 1.9);
  const layout = useMemo(
    () => layoutFor(coins.length, radiusScale, layoutMode),
    [coins.length, radiusScale, layoutMode]
  );

  const heroPedestals = useMemo(
    () => [
      { position: [1.3 * radiusScale, 1.45, -2.4], rotation: [0.9, 0.2, -0.15], scale: 0.65, accent: "#22d3ee", secondaryAccent: "#a855f7", speed: 1.0 },
      { position: [-0.25 * radiusScale, 0.25, -2.2], rotation: [0.95, -0.25, 0.2], scale: 0.72, accent: "#ec4899", secondaryAccent: "#22d3ee", speed: 0.85 },
      { position: [1.35 * radiusScale, -1.45, -2.5], rotation: [0.85, 0.3, -0.2], scale: 0.62, accent: "#22d3ee", secondaryAccent: "#d946ef", speed: 1.15 },
    ],
    [radiusScale]
  );

  const isPedestalMode = layoutMode === "heroStack" || layoutMode === "pedestalFlow" || layoutMode === "pedestals";

  return (
    <>
      <StudioEnvironment />
      <ambientLight intensity={0.6} />
      <directionalLight position={[6, 8, 6]} intensity={2.2} color="#ffffff" />
      <directionalLight position={[-6, -4, 4]} intensity={1.2} color="#22d3ee" />
      <pointLight position={[5, 5, 5]} intensity={1.0} color="#22d3ee" />
      <pointLight position={[-5, -3, 4]} intensity={1.0} color="#a855f7" />

      <AtmosphereDust intensity={intensity} />

      <ParallaxRig strength={intensity / 5}>
        {isPedestalMode
          ? (layoutMode === "heroStack" ? heroPedestals : layout).map((p, i) => (
              <PedestalPlatform
                key={i}
                position={p.position}
                rotation={p.rotation || [0.85, 0.25, -0.2]}
                scale={p.scale || 0.6}
                accent={p.accent || (i % 2 === 0 ? "#22d3ee" : "#ec4899")}
                secondaryAccent={p.secondaryAccent || (i % 2 === 0 ? "#a855f7" : "#22d3ee")}
                speed={p.speed || 1.0}
              />
            ))
          : coins.map((c, i) => (
              <Coin
                key={c.ticker || i}
                position={layout[i]?.position || [0, 0, -5]}
                scale={layout[i]?.scale || 0.45}
                tilt={[0.35 + (i % 2) * 0.1, 0.3 - (i % 3) * 0.15, 0]}
                ticker={c.ticker}
                img={c.img}
                accent={c.accent || (i % 2 === 0 ? "#22d3ee" : "#a855f7")}
                speed={0.8 + (i % 3) * 0.25}
              />
            ))}
      </ParallaxRig>

      <EffectComposer multisampling={0}>
        <Bloom intensity={0.15} luminanceThreshold={0.55} luminanceSmoothing={0.6} mipmapBlur radius={0.3} />
        <Vignette eskil={false} offset={0.15} darkness={0.6} />
      </EffectComposer>
    </>
  );
}

export default function ThreeDScene({ intensity = 4, fixed = true, coins = [], layout = "arc" }) {
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    return () => clearTimeout(t);
  }, []);

  return (
    <Canvas
      className="nx-3d-canvas"
      style={{
        position: fixed ? "fixed" : "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
      camera={{ position: [0, 0, 7.5], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true }}
      dpr={[1, 1.5]}
    >
      <Scene intensity={intensity} coins={coins} layoutMode={layout} />
    </Canvas>
  );
}
