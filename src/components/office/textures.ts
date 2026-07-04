/**
 * 程序化 PBR 纹理（CanvasTexture · 模块级缓存 · 零网络依赖）
 * 木纹 / 地毯 / 拉丝金属 —— 让材质摆脱"纯色积木感"
 */
import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function makeTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat: [number, number]): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** 简易伪随机（稳定） */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** 木纹：底色 + 纵向年轮条纹 + 细噪点 */
export function getWoodTexture(base = '#C8A87C', streak = '#A5825A', key = 'wood'): THREE.CanvasTexture {
  return makeTexture(`${key}:${base}`, 256, (ctx, s) => {
    const r = rng(7);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    // 年轮纵纹
    for (let i = 0; i < 46; i++) {
      const x = r() * s;
      const w = 1 + r() * 3;
      ctx.fillStyle = streak;
      ctx.globalAlpha = 0.06 + r() * 0.12;
      const wobble = (r() - 0.5) * 14;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + wobble, s / 2, x, s);
      ctx.lineTo(x + w, s);
      ctx.quadraticCurveTo(x + w + wobble, s / 2, x + w, 0);
      ctx.closePath();
      ctx.fill();
    }
    // 细噪点
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = r() > 0.5 ? '#FFFFFF' : '#4A3A26';
      ctx.fillRect(r() * s, r() * s, 1, 1);
    }
    ctx.globalAlpha = 1;
  }, [1, 1]);
}

/** 地毯：深色底 + 密集噪点 + 微弱十字纹理 */
export function getCarpetTexture(base = '#333D50', key = 'carpet'): THREE.CanvasTexture {
  return makeTexture(`${key}:${base}`, 128, (ctx, s) => {
    const r = rng(13);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i++) {
      const v = r();
      ctx.fillStyle = v > 0.66 ? 'rgba(255,255,255,0.05)' : v > 0.33 ? 'rgba(0,0,0,0.07)' : 'rgba(120,140,180,0.05)';
      ctx.fillRect(r() * s, r() * s, 1, 1);
    }
  }, [10, 8]);
}

/** 拉丝金属：横向细划痕 */
export function getBrushedMetalTexture(base = '#3A424F'): THREE.CanvasTexture {
  return makeTexture(`metal:${base}`, 128, (ctx, s) => {
    const r = rng(23);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 240; i++) {
      const y = r() * s;
      ctx.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + (r() - 0.5) * 2);
      ctx.stroke();
    }
  }, [2, 2]);
}
