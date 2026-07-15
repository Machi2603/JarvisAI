import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbState } from './orb-state';
import { orbAudio } from './orbAudio';

const NODE_COUNT = 5000;
const LINK_COUNT = 3200;

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// A jittered Fibonacci shell rather than a perfect sphere: nodes cluster in
// an uneven, organic cloud instead of a smooth geometric lattice.
function createNetwork() {
  const rand = seededRandom(42);
  const positions = new Float32Array(NODE_COUNT * 3);
  const seeds = new Float32Array(NODE_COUNT);
  const depths = new Float32Array(NODE_COUNT);

  for (let i = 0; i < NODE_COUNT; i += 1) {
    const y = 1 - (i / (NODE_COUNT - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (3 - Math.sqrt(5)) * i + (rand() - 0.5) * 0.4;
    const shell = 0.75 + (rand() - 0.5) * 0.5 + Math.pow(rand(), 3) * 0.4;
    const x = Math.cos(theta) * radiusAtY * shell;
    const z = Math.sin(theta) * radiusAtY * shell;
    const yy = y * (0.82 + (rand() - 0.5) * 0.3);
    positions.set([x, yy, z], i * 3);
    seeds[i] = rand() * Math.PI * 2;
    depths[i] = Math.min(1, shell);
  }

  // Sparse synapse links: mostly short-range (coherent local clusters) with
  // a handful of long-range jumps so a few branches shoot across the cloud.
  const linkPositions = new Float32Array(LINK_COUNT * 2 * 3);
  const linkSeeds = new Float32Array(LINK_COUNT * 2);
  for (let i = 0; i < LINK_COUNT; i += 1) {
    const a = Math.floor(rand() * NODE_COUNT);
    const longRange = rand() < 0.05;
    const spread = longRange ? NODE_COUNT : Math.max(6, NODE_COUNT * 0.03);
    const b = (a + Math.floor((rand() - 0.5) * spread) + NODE_COUNT) % NODE_COUNT;
    linkPositions.set(positions.subarray(a * 3, a * 3 + 3), i * 6);
    linkPositions.set(positions.subarray(b * 3, b * 3 + 3), i * 6 + 3);
    const seed = rand() * Math.PI * 2;
    linkSeeds[i * 2] = seed;
    linkSeeds[i * 2 + 1] = seed;
  }

  return { positions, seeds, depths, linkPositions, linkSeeds };
}

const POINT_VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aDepth;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    vec3 p = position;
    float wobble = sin(uTime * 0.6 + aSeed) * 0.025 + sin(uTime * 1.7 + aSeed * 2.0) * 0.012;
    vec3 dir = length(p) > 0.0001 ? normalize(p) : vec3(0.0, 1.0, 0.0);
    p += dir * wobble * (0.6 + uIntensity);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float twinkle = 0.55 + 0.45 * sin(uTime * (1.1 + uIntensity * 2.2) + aSeed * 3.0);
    vAlpha = twinkle * mix(0.3, 1.0, aDepth);
    vDepth = aDepth;
    gl_PointSize = (1.1 + aDepth * 1.8 + uIntensity * 1.2) * uPixelRatio * (4.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const POINT_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColorCore;
  uniform vec3 uColorEdge;
  varying float vAlpha;
  varying float vDepth;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv) * 2.0;
    float core = smoothstep(1.0, 0.0, d);
    float glow = smoothstep(1.0, 0.25, d) * 0.5;
    vec3 color = mix(uColorEdge, uColorCore, vDepth);
    float alpha = (core * 0.75 + glow * 0.35) * vAlpha;
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

const LINE_VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    vAlpha = max(0.0, sin(uTime * (0.4 + uIntensity * 0.6) + aSeed));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * (0.022 + uIntensity * 0.07));
  }
`;

export function JarvisOrb({ state, compact = false }: { state: OrbState; compact?: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.z = 4.4;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const pixelRatio = Math.min(window.devicePixelRatio, 1.75);
    renderer.setPixelRatio(pixelRatio);
    mount.appendChild(renderer.domElement);

    const { positions, seeds, depths, linkPositions, linkSeeds } = createNetwork();

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    pointGeometry.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));

    const pointUniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0.3 },
      uPixelRatio: { value: pixelRatio },
      uColorCore: { value: new THREE.Color('#d6faff') },
      uColorEdge: { value: new THREE.Color('#0e5f78') },
    };
    const pointMaterial = new THREE.ShaderMaterial({
      vertexShader: POINT_VERTEX,
      fragmentShader: POINT_FRAGMENT,
      uniforms: pointUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pointGeometry, pointMaterial);

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3));
    lineGeometry.setAttribute('aSeed', new THREE.BufferAttribute(linkSeeds, 1));
    const lineUniforms = {
      uTime: { value: 0 },
      uIntensity: { value: 0.3 },
      uColor: { value: new THREE.Color('#22d3ee') },
    };
    const lineMaterial = new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX,
      fragmentShader: LINE_FRAGMENT,
      uniforms: lineUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);

    const network = new THREE.Group();
    network.add(lines, points);
    scene.add(network);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let frame = 0;
    let lastT = 0;
    let smoothSound = 0;
    const animate = (now: number) => {
      const mode = stateRef.current;
      const t = now / 1000;
      const dt = lastT ? Math.min(0.1, t - lastT) : 0.016;
      lastT = t;

      // The orb only reacts to Jarvis' synthesized Kokoro voice.
      const speaking = mode === 'speaking';
      const target = speaking ? Math.min(1, orbAudio.level) : 0;

      // Heavy smoothing: the swell eases in and out over ~half a second instead
      // of tracking every syllable, so it never darts or snaps.
      smoothSound += (target - smoothSound) * Math.min(1, dt * 2.2);

      // Brightness and point size ride the (smoothed) level, but ROTATION stays
      // slow and constant — the orb reacts by gently expanding, never spinning.
      const base = mode === 'thinking' ? 0.7 : mode === 'listening' ? 0.5 : 0.3;
      const intensity = Math.min(1.3, base + smoothSound * 0.5);

      pointUniforms.uTime.value = t;
      pointUniforms.uIntensity.value = intensity;
      lineUniforms.uTime.value = t;
      lineUniforms.uIntensity.value = intensity;

      network.rotation.y = t * 0.06;
      network.rotation.x = Math.sin(t * 0.2) * 0.12;

      // Expansion IS the reaction: a gentle idle breath plus a soft, restrained
      // swell that tracks the smoothed voice level.
      const idleBreathe = Math.sin(t * 1.1) * 0.012;
      const scale = 1 + idleBreathe + smoothSound * 0.14;
      network.scale.setScalar(scale);

      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      pointGeometry.dispose();
      pointMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className={compact ? "absolute left-5 top-10 z-20 h-24 w-24 transition-all duration-700" : "absolute inset-0 transition-all duration-700"} aria-label={`Jarvis is ${state}`} role="img" />;
}
