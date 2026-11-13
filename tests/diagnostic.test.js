// Teste da pontuação do diagnóstico. Rodar: node tests/diagnostic.test.js
const assert = require('assert');
const D = require('../js/diagnostic.js');

assert.ok(Math.abs(D.PERFECT_MAJOR - 9.234669) < 1e-4, 'raio maior da ordem perfeita (Vingrys & King-Smith)');

const cases = [
  ['perfeito', [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], null],
  ['uma troca leve', [1,2,4,3,5,6,7,8,9,10,11,12,13,14,15], null],
  ['protan', [15,1,14,2,13,3,12,4,11,5,10,6,9,7,8], 'protanopia'],
  ['protan (variação)', [15,1,14,2,3,13,12,4,11,5,10,6,9,7,8], 'protanopia'],
  ['deutan', [1,15,2,3,14,13,4,12,5,6,11,10,7,9,8], 'deuteranopia'],
  ['deutan (variação)', [1,15,2,14,3,13,4,12,5,11,6,10,7,9,8], 'deuteranopia'],
  ['tritan', [1,2,3,4,5,6,7,15,8,14,9,13,10,11,12], 'tritanopia'],
  ['tritan (variação)', [1,2,3,4,5,6,15,14,7,8,13,9,12,10,11], 'tritanopia'],
];
for (const [name, order, expected] of cases) {
  const r = D.score(order);
  assert.strictEqual(r.type, expected, `${name}: esperado ${expected}, obtido ${r.type}`);
  assert.strictEqual(r.normal, expected === null);
  console.log(`ok  ${name.padEnd(18)} tipo=${String(r.type).padEnd(12)} grau=${r.severity} (${r.label}) ` +
    `ângulo=${r.angle}° C=${r.cIndex} S=${r.sIndex} TES=${r.tes} cruzamentos=${r.crossings.length}`);
}
assert.throws(() => D.score([1, 2, 3]));
console.log('todos os testes passaram');
