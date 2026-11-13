// Testes da importação (perfil .json e LUT .cube). Rodar: node tests/import.test.js
const assert = require('assert');
const CM = require('../js/color-matrix.js');
const Export = require('../js/export.js');
const Imp = require('../js/import.js');

const rmsDiff = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
const types = ['protanopia', 'deuteranopia', 'tritanopia'];

// 1) Round-trip JSON: exportar → importar devolve a mesma matriz e ajustes
for (const type of types) {
  const p = CM.createProfile({ type, severity: 0.7, intensity: 0.8, contrast: 1.1, brightness: 0.05 });
  const r = Imp.parseJSON(Export.profileJSON(p));
  assert.strictEqual(r.kind, 'json');
  assert.deepStrictEqual(r.profile.matrix, p.matrix, `${type}: matriz diferente após round-trip JSON`);
  assert.strictEqual(r.profile.type, type);
  assert.strictEqual(r.profile.severity, 0.7);
  assert.strictEqual(r.profile.intensity, 0.8);
  assert.deepStrictEqual(r.profile.adjust, { contrast: 1.1, brightness: 0.05 });
  assert.strictEqual(r.profile.source, 'imported');
  assert.strictEqual(r.warnings.length, 0);
  // Re-exportar o importado gera o mesmo feColorMatrix
  assert.deepStrictEqual(CM.toFeColorMatrix(r.profile), CM.toFeColorMatrix(p));
  console.log(`ok  JSON round-trip ${type.padEnd(13)} matriz idêntica`);
}

// 2) .cube exportado (intensidade 0.8, contraste 1.1) → importado reproduz a matriz afim
for (const type of types) {
  for (const brightness of [0, 0.05]) {
    const p = CM.createProfile({ type, severity: 1, intensity: 0.8, contrast: 1.1, brightness });
    const cube = Export.cubeLUT(p);
    const r = Imp.cubeToProfile(cube);
    const want = CM.affine(p), got = CM.affine(r.profile);
    const mRms = rmsDiff(got.m, want.m);
    const offErr = Math.abs(got.offset - want.offset);
    assert.ok(mRms < 1e-3, `${type}: RMS da matriz ${mRms}`);
    assert.ok(offErr < 1e-3, `${type}: erro do deslocamento ${offErr}`);
    assert.ok(r.fit.rms < 1e-4, `${type}: erro da LUT ${r.fit.rms}`);
    assert.strictEqual(r.profile.type, type, 'tipo lido do TITLE');
    assert.strictEqual(r.warnings.length, 0, r.warnings.join(' | '));
    // Re-exportar reproduz a LUT
    const again = Export.cubeLUT(r.profile).split('\n').slice(4);
    const orig = cube.split('\n').slice(4);
    let maxD = 0;
    for (let i = 0; i < orig.length; i++) {
      if (!orig[i]) continue;
      const a = orig[i].split(' ').map(Number), b = again[i].split(' ').map(Number);
      for (let k = 0; k < 3; k++) maxD = Math.max(maxD, Math.abs(a[k] - b[k]));
    }
    assert.ok(maxD < 2e-3, `${type}: LUT re-exportada difere ${maxD}`);
    console.log(`ok  .cube ${type.padEnd(13)} brilho=${brightness}  RMS matriz=${mRms.toExponential(2)}  ` +
      `Δoffset=${offErr.toExponential(2)}  RMS LUT=${r.fit.rms.toExponential(2)}  máx Δ re-export=${maxD.toExponential(2)}  ` +
      `amostras usadas=${r.fit.used.join('/')}`);
  }
}

// 3) LUT não linear → aproximada com aviso
{
  const N = 9, lines = ['LUT_3D_SIZE 9'];
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++)
    lines.push([r, g, b].map((v) => Math.pow(v / (N - 1), 2.2).toFixed(6)).join(' '));
  const res = Imp.parseAny(lines.join('\n'), 'gama.cube');
  assert.ok(res.fit.rms > Imp.CUBE_WARN_RMS && /não é linear/.test(res.warnings[0]));
  console.log(`ok  .cube não linear (gama 2.2) → aviso, RMS=${res.fit.rms.toFixed(4)}`);
}

// 4) Valores fora da faixa são ajustados com aviso
{
  const r = Imp.parseJSON(JSON.stringify({ version: 1, type: 'custom', intensity: 1.4,
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], adjust: { contrast: 3, brightness: 0 } }));
  assert.strictEqual(r.profile.intensity, 1);
  assert.strictEqual(r.profile.adjust.contrast, 1.5);
  assert.strictEqual(r.warnings.length, 2);
  console.log('ok  valores fora da faixa ajustados com aviso');
}

// 5) Entradas inválidas geram ImportError com mensagem
const bad = [
  ['texto vazio', () => Imp.parseAny('', '')],
  ['JSON quebrado', () => Imp.parseJSON('{"version": 1, "matrix": [1,2')],
  ['JSON sem matriz', () => Imp.parseJSON('{"version": 1}')],
  ['matriz com 8 números', () => Imp.parseJSON('{"version":1,"matrix":[1,0,0,0,1,0,0,0]}')],
  ['matriz com texto', () => Imp.parseJSON('{"version":1,"matrix":[1,0,0,0,"x",0,0,0,1]}')],
  ['matriz fora da faixa', () => Imp.parseJSON('{"version":1,"matrix":[99,0,0,0,1,0,0,0,1]}')],
  ['versão 2', () => Imp.parseJSON('{"version":2,"matrix":[1,0,0,0,1,0,0,0,1]}')],
  ['tipo desconhecido', () => Imp.parseJSON('{"version":1,"type":"xyz","matrix":[1,0,0,0,1,0,0,0,1]}')],
  ['contraste não numérico', () => Imp.parseJSON('{"version":1,"matrix":[1,0,0,0,1,0,0,0,1],"adjust":{"contrast":"alto"}}')],
  ['array JSON', () => Imp.parseJSON('[1,2,3]')],
  ['.cube sem tamanho', () => Imp.parseCube('0 0 0\n1 1 1')],
  ['.cube incompleto', () => Imp.parseCube('LUT_3D_SIZE 2\n0 0 0\n1 0 0')],
  ['.cube linha ruim', () => Imp.parseCube('LUT_3D_SIZE 2\n0 0 abc')],
  ['.cube 1D', () => Imp.parseCube('LUT_1D_SIZE 16\n0 0 0')],
  ['texto qualquer', () => Imp.parseAny('olá, isto não é um perfil', 'nota.txt')],
  ['binário', () => Imp.parseAny('\u0000\u0001PNG', 'x.txt')],
];
for (const [name, fn] of bad) {
  assert.throws(fn, (e) => e.name === 'ImportError' && e.message.length > 10, name);
  let msg = ''; try { fn(); } catch (e) { msg = e.message; }
  console.log(`ok  erro: ${name.padEnd(22)} → ${msg}`);
}

// 6) Solver 4x4
assert.deepStrictEqual(Imp.solve4([[2,0,0,0],[0,4,0,0],[0,0,1,0],[0,0,0,5]], [2,8,3,10]), [1,2,3,2]);
assert.strictEqual(Imp.solve4([[1,1,0,0],[1,1,0,0],[0,0,1,0],[0,0,0,1]], [1,1,1,1]), null);
console.log('todos os testes de importação passaram');
