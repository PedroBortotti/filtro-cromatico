/**
 * color-matrix.js – Motor de matriz de cores.
 *
 * Usa uma matriz 3x3 aplicada pixel a pixel sobre ImageData. Contraste e
 * brilho entram como deslocamento afim (equivalente a uma 4x4/4x5), então a
 * mesma matriz serve para o canvas, para o feColorMatrix e para a LUT .cube.
 *
 * Correção por daltonização: M = I + E·(I − S)
 *   S = matriz de simulação da deficiência (Machado, Oliveira e Fernandes, 2009)
 *   E = matriz que redistribui o "erro" (o que a pessoa não vê) para canais visíveis
 */
(function (global) {
  'use strict';

  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  // Simulação com severidade 1.0 (Machado et al., 2009)
  const CVD = {
    protanopia:   [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
    tritanopia:   [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
  };

  // Redistribuição do erro por tipo
  const ERR = {
    protanopia:   [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
    deuteranopia: [1, 0.7, 0, 0, 0, 0, 0, 0.7, 1],
    tritanopia:   [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0],
  };

  // ---------- Álgebra de matrizes 3x3 (vetor linear, linha a linha) ----------
  function mul3(a, b) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return r;
  }
  const add3 = (a, b) => a.map((v, i) => v + b[i]);
  const sub3 = (a, b) => a.map((v, i) => v - b[i]);
  // Interpola entre a identidade (t=0) e M (t=1)
  const lerpIdentity = (m, t) => m.map((v, i) => I3[i] + t * (v - I3[i]));

  // ---------- Perfil ----------
  function buildCorrection(type, severity) {
    const S = lerpIdentity(CVD[type], severity);     // simulação parcial (anomalia)
    return add3(I3, mul3(ERR[type], sub3(I3, S)));    // M = I + E(I − S)
  }

  function createProfile({ type = 'deuteranopia', severity = 1, intensity = 1, contrast = 1, brightness = 0 } = {}) {
    return {
      version: 1,
      type, severity, intensity,
      matrix: buildCorrection(type, severity),
      adjust: { contrast, brightness },
      createdAt: new Date().toISOString(),
    };
  }

  // Matriz efetiva com a intensidade do slider aplicada
  const effectiveMatrix = (p) => lerpIdentity(p.matrix, p.intensity);

  /**
   * Matriz afim final em escala 0..1: saída = A·rgb + offset.
   * Usada pelos exportadores (SVG/CSS, .cube, bookmarklet).
   */
  function affine(profile) {
    const m = effectiveMatrix(profile);
    const c = profile.adjust.contrast;
    const off = 0.5 * (1 - c) + profile.adjust.brightness;
    return { m: m.map((v) => v * c), offset: off };
  }

  // Converte para a matriz 4x5 do <feColorMatrix type="matrix">
  function toFeColorMatrix(profile) {
    const { m, offset: o } = affine(profile);
    return [
      m[0], m[1], m[2], 0, o,
      m[3], m[4], m[5], 0, o,
      m[6], m[7], m[8], 0, o,
      0, 0, 0, 1, 0,
    ];
  }

  // ---------- Aplicação em pixels ----------
  /** Aplica o perfil direto no buffer RGBA (Uint8ClampedArray limita 0..255). */
  function applyToImageData(imageData, profile) {
    const d = imageData.data;
    const { m, offset } = affine(profile);
    const off = offset * 255;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i]     = m0 * r + m1 * g + m2 * b + off;
      d[i + 1] = m3 * r + m4 * g + m5 * b + off;
      d[i + 2] = m6 * r + m7 * g + m8 * b + off;
      // d[i + 3] (alfa) fica intacto
    }
    return imageData;
  }

  /** Desenha uma fonte (img, video, canvas) em um canvas já com o filtro. */
  function renderFiltered(source, canvas, profile) {
    const w = source.videoWidth || source.naturalWidth || source.width;
    const h = source.videoHeight || source.naturalHeight || source.height;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    if (!profile) return;
    const frame = ctx.getImageData(0, 0, w, h);
    ctx.putImageData(applyToImageData(frame, profile), 0, 0);
  }

  // ---------- Persistência ----------
  const STORAGE_KEY = 'daltonismo_profile_v1';
  const saveProfile = (p) => localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  }

  global.ColorMatrix = {
    CVD, I3, mul3, add3, sub3, lerpIdentity,
    buildCorrection, createProfile, effectiveMatrix, affine, toFeColorMatrix,
    applyToImageData, renderFiltered, saveProfile, loadProfile,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.ColorMatrix;
})(typeof window !== 'undefined' ? window : globalThis);
