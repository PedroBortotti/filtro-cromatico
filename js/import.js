/**
 * import.js – Importação de perfis (espelho do export.js).
 *
 * Aceita:
 *  - Perfil .json exportado por esta página ("Baixar perfil .json") ou colado no campo de texto.
 *    Também lê o perfil cru salvo no localStorage e o formato { profile: {...} }.
 *  - LUT 3D .cube (ex.: a gerada pelo botão "LUT .cube"). A LUT é aproximada por uma
 *    transformação afim  saída = A·rgb + b  ajustada por mínimos quadrados (equações
 *    normais 4x4 por canal). Amostras saturadas em 0 ou 1 (a exportação limita 0..1) ficam
 *    fora do ajuste. Se a LUT não for linear o bastante, o resultado vem com um aviso.
 *
 * API (funções puras, testáveis no Node):
 *   ImportProfile.parseJSON(text)          → { kind:'json', profile, warnings }
 *   ImportProfile.parseCube(text)          → { title, size, domainMin, domainMax, data }
 *   ImportProfile.fitAffine(inp, out, n)   → { A:[9], b:[3], used:[3] }
 *   ImportProfile.cubeToProfile(text)      → { kind:'cube', profile, warnings, fit }
 *   ImportProfile.parseAny(text, filename) → um dos dois acima
 *   ImportProfile.validateProfile(obj)     → { profile, warnings }
 *   ImportProfile.readFile(file)           → Promise (navegador)
 * Erros: lança ImportError com mensagem amigável em pt-BR.
 */
(function (global) {
  'use strict';

  const MAX_BYTES = 5 * 1024 * 1024;
  const KNOWN_TYPES = ['protanopia', 'deuteranopia', 'tritanopia', 'custom'];
  // Mesmas faixas dos controles da página
  const RANGES = {
    matrix: [-5, 5], severity: [0, 1], intensity: [0, 1],
    contrast: [0.5, 1.5], brightness: [-0.5, 0.5],
  };
  const CUBE_WARN_RMS = 0.02;
  const CLAMP_EPS = 1e-6;

  class ImportError extends Error {
    constructor(msg) { super(msg); this.name = 'ImportError'; }
  }
  const fail = (msg) => { throw new ImportError(msg); };
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const fmt = (x) => String(Number(x.toFixed(3))).replace('.', ',');

  // ---------- Perfil JSON ----------
  function readNumber(value, name, label, def, warnings) {
    if (value === undefined || value === null) return def;
    if (!isNum(value)) fail(`O campo "${name}" deve ser um número.`);
    const [lo, hi] = RANGES[name];
    if (value < lo || value > hi) {
      const c = clamp(value, lo, hi);
      warnings.push(`${label} ${fmt(value)} fora da faixa (${fmt(lo)} a ${fmt(hi)}); ajustado para ${fmt(c)}.`);
      return c;
    }
    return value;
  }

  /** Valida um objeto de perfil e devolve uma cópia normalizada com source = 'imported'. */
  function validateProfile(obj) {
    const warnings = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
      fail('O JSON não contém um perfil (esperado um objeto com o campo "matrix").');
    if (!('matrix' in obj) && obj.profile && typeof obj.profile === 'object') obj = obj.profile;
    if (obj.app !== undefined && obj.app !== 'filtro-cromatico')
      warnings.push(`Arquivo criado por "${obj.app}"; importado mesmo assim.`);

    if (obj.version === undefined) warnings.push('Perfil sem "version"; assumida a versão 1.');
    else if (obj.version !== 1) fail(`Versão de perfil "${obj.version}" não suportada (esta página lê a versão 1).`);

    let m = obj.matrix;
    if (m === undefined) fail('O perfil não tem o campo "matrix" (matriz 3x3).');
    if (Array.isArray(m) && m.length === 3 && m.every((r) => Array.isArray(r) && r.length === 3)) m = m.flat();
    if (!Array.isArray(m) || m.length !== 9 || !m.every(isNum))
      fail('O campo "matrix" deve ter 9 números (matriz 3x3, linha a linha).');
    if (m.some((v) => v < RANGES.matrix[0] || v > RANGES.matrix[1]))
      fail('A matriz tem valores fora da faixa aceita (−5 a 5).');

    let type = obj.type;
    if (type === undefined) type = 'custom';
    if (typeof type !== 'string' || !KNOWN_TYPES.includes(type))
      fail(`Tipo "${type}" desconhecido. Use protanopia, deuteranopia, tritanopia ou custom.`);

    const adjust = obj.adjust && typeof obj.adjust === 'object' ? obj.adjust : {};
    const profile = {
      version: 1,
      type,
      severity: readNumber(obj.severity, 'severity', 'Grau', 1, warnings),
      intensity: readNumber(obj.intensity, 'intensity', 'Intensidade', 1, warnings),
      matrix: m.slice(),
      adjust: {
        contrast: readNumber(adjust.contrast, 'contrast', 'Contraste', 1, warnings),
        brightness: readNumber(adjust.brightness, 'brightness', 'Brilho', 0, warnings),
      },
      source: 'imported',
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
      importedAt: new Date().toISOString(),
    };
    return { profile, warnings };
  }

  function parseJSON(text) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim();
    if (!text) fail('Nada para importar: escolha um arquivo ou cole o JSON do perfil.');
    let obj;
    try { obj = JSON.parse(text); } catch (e) {
      fail('JSON inválido: confira se o texto foi copiado inteiro (chaves, aspas e vírgulas).');
    }
    const { profile, warnings } = validateProfile(obj);
    return { kind: 'json', profile, warnings };
  }

  // ---------- LUT .cube ----------
  function parseCube(text) {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    let title = '', size = 0, domainMin = [0, 0, 0], domainMax = [1, 1, 1];
    const values = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/#.*$/, '').trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const key = parts[0].toUpperCase();
      if (/^[A-Z_]/.test(key)) {
        const nums = parts.slice(1).map(Number);
        if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
        else if (key === 'LUT_1D_SIZE') fail('LUT 1D não é suportada: use uma LUT 3D (.cube com LUT_3D_SIZE).');
        else if (key === 'LUT_3D_SIZE') size = nums[0];
        else if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
          if (nums.length !== 3 || !nums.every(Number.isFinite)) fail(`Linha ${i + 1} do .cube: ${key} precisa de 3 números.`);
          if (key === 'DOMAIN_MIN') domainMin = nums; else domainMax = nums;
        } else if (key === 'LUT_3D_INPUT_RANGE') {
          if (nums.length !== 2 || !nums.every(Number.isFinite)) fail(`Linha ${i + 1} do .cube: LUT_3D_INPUT_RANGE precisa de 2 números.`);
          domainMin = [nums[0], nums[0], nums[0]]; domainMax = [nums[1], nums[1], nums[1]];
        }
        // outras palavras-chave são ignoradas
        continue;
      }
      const nums = parts.map(Number);
      if (nums.length !== 3 || !nums.every(Number.isFinite))
        fail(`Linha ${i + 1} do .cube inválida: "${line.slice(0, 40)}". Cada linha de dados deve ter 3 números.`);
      values.push(nums[0], nums[1], nums[2]);
    }
    if (!size) fail('Arquivo .cube sem LUT_3D_SIZE: não parece uma LUT 3D.');
    if (!Number.isInteger(size) || size < 2 || size > 256) fail(`LUT_3D_SIZE ${size} inválido (use de 2 a 256).`);
    const expected = size * size * size;
    if (values.length / 3 !== expected)
      fail(`O .cube declara ${size}³ = ${expected} pontos, mas tem ${values.length / 3}. O arquivo pode estar incompleto.`);
    for (let k = 0; k < 3; k++)
      if (!(domainMax[k] > domainMin[k])) fail('DOMAIN_MIN/DOMAIN_MAX inválidos no .cube.');
    return { title, size, domainMin, domainMax, data: Float64Array.from(values) };
  }

  /** Resolve M·x = y (4x4) por eliminação de Gauss com pivotamento parcial. null se singular. */
  function solve4(M, y) {
    const a = M.map((row, i) => row.concat([y[i]]));
    for (let c = 0; c < 4; c++) {
      let p = c;
      for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      if (Math.abs(a[p][c]) < 1e-12) return null;
      [a[c], a[p]] = [a[p], a[c]];
      for (let r = 0; r < 4; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k < 5; k++) a[r][k] -= f * a[c][k];
      }
    }
    return a.map((row, i) => row[4] / row[i]);
  }

  /**
   * Ajuste afim por mínimos quadrados, um canal por vez: out_k ≈ A[k]·rgb + b[k].
   * inputs/outputs: arrays planos (r,g,b, r,g,b, ...) com n pontos.
   * excludeClamped: ignora amostras do canal iguais a 0 ou 1 (saturadas).
   */
  function fitAffine(inputs, outputs, n, { excludeClamped = true } = {}) {
    const A = new Array(9), b = new Array(3), used = new Array(3);
    for (let k = 0; k < 3; k++) {
      let sol = null;
      for (const skip of excludeClamped ? [true, false] : [false]) {
        const XtX = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
        const Xty = [0, 0, 0, 0];
        let count = 0;
        for (let i = 0; i < n; i++) {
          const y = outputs[i * 3 + k];
          if (skip && (y <= CLAMP_EPS || y >= 1 - CLAMP_EPS)) continue;
          const x = [inputs[i * 3], inputs[i * 3 + 1], inputs[i * 3 + 2], 1];
          for (let r = 0; r < 4; r++) {
            Xty[r] += x[r] * y;
            for (let c = 0; c < 4; c++) XtX[r][c] += x[r] * x[c];
          }
          count++;
        }
        if (count >= 8) sol = solve4(XtX, Xty);
        if (sol) { used[k] = count; break; }
      }
      if (!sol) fail('Não foi possível aproximar a LUT por uma matriz (dados degenerados).');
      A[k * 3] = sol[0]; A[k * 3 + 1] = sol[1]; A[k * 3 + 2] = sol[2]; b[k] = sol[3];
    }
    return { A, b, used };
  }

  /** Converte o texto de um .cube em perfil (matriz = A, contraste 1, brilho = deslocamento médio). */
  function cubeToProfile(text) {
    const cube = parseCube(text);
    const { size: N, domainMin: lo, domainMax: hi, data } = cube;
    const n = N * N * N;
    const inputs = new Float64Array(n * 3);
    let i = 0;
    for (let bi = 0; bi < N; bi++)                // R varia mais rápido
      for (let gi = 0; gi < N; gi++)
        for (let ri = 0; ri < N; ri++, i++) {
          inputs[i * 3]     = lo[0] + (hi[0] - lo[0]) * ri / (N - 1);
          inputs[i * 3 + 1] = lo[1] + (hi[1] - lo[1]) * gi / (N - 1);
          inputs[i * 3 + 2] = lo[2] + (hi[2] - lo[2]) * bi / (N - 1);
        }
    const fit = fitAffine(inputs, data, n);
    const warnings = [];
    if (fit.A.some((v) => !isNum(v) || v < RANGES.matrix[0] || v > RANGES.matrix[1]))
      fail('A LUT não pôde ser convertida: a matriz aproximada sai da faixa aceita (−5 a 5).');

    // O modelo da página usa o mesmo deslocamento nos 3 canais
    const offset = (fit.b[0] + fit.b[1] + fit.b[2]) / 3;
    const spread = Math.max(...fit.b) - Math.min(...fit.b);
    let brightness = offset;
    if (brightness < RANGES.brightness[0] || brightness > RANGES.brightness[1]) {
      brightness = clamp(brightness, RANGES.brightness[0], RANGES.brightness[1]);
      warnings.push(`O deslocamento da LUT (${fmt(offset)}) passa da faixa do brilho; ajustado para ${fmt(brightness)}.`);
    }

    // Erro do modelo final (com o limite 0..1 da exportação) contra todos os pontos da LUT
    const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = fit.A;
    let se = 0, max = 0;
    for (let p = 0; p < n; p++) {
      const r = inputs[p * 3], g = inputs[p * 3 + 1], bl = inputs[p * 3 + 2];
      const pred = [a0 * r + a1 * g + a2 * bl, a3 * r + a4 * g + a5 * bl, a6 * r + a7 * g + a8 * bl];
      for (let k = 0; k < 3; k++) {
        const e = Math.abs(clamp(pred[k] + brightness, 0, 1) - data[p * 3 + k]);
        se += e * e; if (e > max) max = e;
      }
    }
    const rms = Math.sqrt(se / (n * 3));
    if (rms > CUBE_WARN_RMS)
      warnings.push(`Esta LUT não é linear: foi aproximada por uma matriz (erro RMS ${fmt(rms)}, máximo ${fmt(max)}). O resultado pode diferir do original.`);
    else if (spread > 0.01)
      warnings.push('Os deslocamentos por canal da LUT foram unificados pela média.');

    const m = /(protanopia|deuteranopia|tritanopia)/i.exec(cube.title || '');
    const { profile } = validateProfile({
      version: 1,
      type: m ? m[1].toLowerCase() : 'custom',
      severity: 1, intensity: 1,
      matrix: fit.A,
      adjust: { contrast: 1, brightness },
    });
    return { kind: 'cube', profile, warnings, fit: { ...fit, offset, rms, max, size: N, title: cube.title } };
  }

  const looksLikeCube = (t) => /^\s*(TITLE|LUT_3D_SIZE|LUT_1D_SIZE|DOMAIN_MIN|DOMAIN_MAX|LUT_3D_INPUT_RANGE)\b/im.test(t);

  /** Decide o formato pelo nome do arquivo e pelo conteúdo. */
  function parseAny(text, filename = '') {
    text = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const name = String(filename).toLowerCase();
    if (/\u0000/.test(text)) fail('Arquivo não suportado: parece ser binário. Use um perfil .json ou uma LUT .cube.');
    const t = text.trim();
    if (!t) fail('Nada para importar: o arquivo ou o texto está vazio.');
    if (name.endsWith('.cube')) return cubeToProfile(text);
    if (t[0] === '{' || t[0] === '[' || name.endsWith('.json')) return parseJSON(text);
    if (looksLikeCube(text)) return cubeToProfile(text);
    fail('Formato não reconhecido. Use um perfil .json exportado por esta página ou uma LUT 3D .cube.');
  }

  /** Lê um File do navegador (limite de 5 MB) e devolve o resultado do parseAny. */
  async function readFile(file) {
    if (!file) fail('Nenhum arquivo escolhido.');
    if (!/\.(json|cube|txt)$/i.test(file.name || ''))
      fail(`Tipo de arquivo não suportado: "${file.name}". Use .json, .cube ou .txt.`);
    if (file.size > MAX_BYTES)
      fail(`Arquivo grande demais (${(file.size / 1048576).toFixed(1).replace('.', ',')} MB). O limite é 5 MB.`);
    const text = await file.text();
    return parseAny(text, file.name);
  }

  const ImportProfile = {
    ImportError, MAX_BYTES, KNOWN_TYPES, RANGES, CUBE_WARN_RMS,
    validateProfile, parseJSON, parseCube, solve4, fitAffine, cubeToProfile, parseAny, readFile,
  };
  global.ImportProfile = ImportProfile;
  if (typeof module !== 'undefined' && module.exports) module.exports = ImportProfile;
})(typeof window !== 'undefined' ? window : globalThis);
