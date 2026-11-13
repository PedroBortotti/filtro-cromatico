/**
 * diagnostic.js – Diagnóstico interativo (triagem) por ordenação de matizes.
 *
 * Teste no estilo Farnsworth D-15: 1 peça de referência fixa + 15 peças móveis.
 * O usuário ordena as peças por matiz (arrastar com mouse/toque, ou teclado e
 * botões). Ao concluir, a ordem é pontuada pelo método do momento de inércia de
 * Vingrys & King-Smith (1988), que devolve:
 *   - ângulo de confusão (classifica protan / deutan / tritan);
 *   - raio maior e menor, C-index (gravidade), S-index (seletividade) e TES.
 *
 * Coordenadas CIE 1976 u*v* das peças: Vingrys & King-Smith (1988), tabela do D-15.
 * As cores exibidas são convertidas para sRGB (L* ≈ 50, branco D65), então o
 * resultado depende da calibração do monitor. É uma TRIAGEM, não um laudo.
 *
 * API:
 *   Diagnostic.start(canvas, controlsEl, onResult)  → monta o teste na interface
 *   Diagnostic.score(order)                         → função pura (testável no Node)
 *     order = array com as 15 peças (1..15) na ordem escolhida pelo usuário
 */
(function (global) {
  'use strict';

  // Índice 0 = peça de referência (P). Índices 1..15 = peças móveis.
  const CAPS_UV = [
    [-21.54, -38.39],
    [-23.26, -25.56], [-22.41, -15.53], [-23.11, -7.45], [-22.45, 1.10], [-21.67, 7.35],
    [-14.08, 18.74], [-2.72, 28.13], [14.84, 31.13], [23.87, 26.35], [31.82, 14.76],
    [31.42, 6.99], [29.79, 0.10], [26.64, -9.38], [22.92, -18.65], [11.20, -24.61],
  ];
  const MUNSELL = ['5PB', '10B', '5B', '10BG', '5BG', '10G', '5G', '10GY', '5GY',
    '10Y', '5Y', '10YR', '5YR', '10R', '5R', '10RP'];
  const N_CAPS = 15;

  // Limiares de classificação (graus, convenção de Vingrys & King-Smith)
  const C_INDEX_NORMAL = 1.6;      // abaixo disso: sem indicação de deficiência
  const TYPE_NAMES = {
    protanopia: 'Protan (vermelho)',
    deuteranopia: 'Deutan (verde)',
    tritanopia: 'Tritan (azul-amarelo)',
  };

  // ---------- Cor: CIELUV (L*, u*, v*) → sRGB ----------
  function luvToRgb(L, u, v) {
    const un = 0.19783, vn = 0.46832;                 // branco D65
    const Y = L > 8 ? Math.pow((L + 16) / 116, 3) : L / 903.3;
    const up = u / (13 * L) + un, vp = v / (13 * L) + vn;
    const X = Y * 9 * up / (4 * vp);
    const Z = Y * (12 - 3 * up - 20 * vp) / (4 * vp);
    const lin = [
      3.2406 * X - 1.5372 * Y - 0.4986 * Z,
      -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
      0.0557 * X - 0.2040 * Y + 1.0570 * Z,
    ];
    return lin.map((c) => {
      c = Math.min(1, Math.max(0, c));
      const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.round(s * 255);
    });
  }
  const CAP_COLORS = CAPS_UV.map(([u, v]) => {
    const [r, g, b] = luvToRgb(52, u, v);
    return `rgb(${r}, ${g}, ${b})`;
  });

  // ---------- Pontuação (pura) ----------
  /** Momento de inércia dos vetores de diferença de cor (Vingrys & King-Smith, 1988). */
  function moments(order) {
    const seq = [0].concat(order);
    let U2 = 0, V2 = 0, UV = 0, tcds = 0;
    for (let i = 1; i < seq.length; i++) {
      const du = CAPS_UV[seq[i]][0] - CAPS_UV[seq[i - 1]][0];
      const dv = CAPS_UV[seq[i]][1] - CAPS_UV[seq[i - 1]][1];
      U2 += du * du; V2 += dv * dv; UV += du * dv;
      tcds += Math.hypot(du, dv);
    }
    const n = seq.length - 1;
    // Eixo de maior espalhamento: maximiza Σ(du·cosθ + dv·sinθ)²
    const theta = 0.5 * Math.atan2(2 * UV, U2 - V2);
    const proj = (t) => U2 * Math.cos(t) ** 2 + V2 * Math.sin(t) ** 2 + 2 * UV * Math.sin(t) * Math.cos(t);
    const major = Math.sqrt(Math.max(0, proj(theta)) / n);
    const minor = Math.sqrt(Math.max(0, proj(theta + Math.PI / 2)) / n);
    return { theta, major, minor, tcds };
  }

  const PERFECT = moments(Array.from({ length: N_CAPS }, (_, i) => i + 1));

  /** Pares de peças vizinhas na sequência que não são vizinhas no círculo. */
  function crossings(order) {
    const seq = [0].concat(order);
    const list = [];
    for (let i = 1; i < seq.length; i++) {
      if (Math.abs(seq[i] - seq[i - 1]) > 2) list.push([seq[i - 1], seq[i]]);
    }
    return list;
  }

  function severityLabel(s) {
    if (s <= 0) return 'nenhum';
    if (s < 0.45) return 'leve';
    if (s < 0.75) return 'moderado';
    return 'forte';
  }

  /**
   * Converte a ordem das peças em resultado.
   * Ângulo em graus no intervalo (-90, 90]:
   * (referências de Vingrys & King-Smith: normal ≈ +62°, protan ≈ +8°,
   *  deutan ≈ -8°, tritan ≈ -80°; o C-index separa o normal antes do ângulo)
   *   protan: +0.7° < ângulo ≤ +45°
   *   deutan: -45° ≤ ângulo ≤ +0.7°
   *   tritan: |ângulo| > 45°
   */
  function score(order) {
    if (!Array.isArray(order) || order.length !== N_CAPS ||
        new Set(order).size !== N_CAPS || order.some((c) => c < 1 || c > N_CAPS)) {
      throw new Error('A ordem deve conter as peças 1..15 exatamente uma vez.');
    }
    const m = moments(order);
    let angle = m.theta * 180 / Math.PI;
    if (angle <= -90) angle += 180;
    if (angle > 90) angle -= 180;

    const cIndex = m.major / PERFECT.major;
    const sIndex = m.minor > 0 ? m.major / m.minor : Infinity;
    const tes = Math.sqrt(m.major ** 2 + m.minor ** 2);
    const cross = crossings(order);
    const normal = cIndex < C_INDEX_NORMAL;

    let type = null;
    if (!normal) {
      if (Math.abs(angle) > 45) type = 'tritanopia';
      else if (angle > 0.7) type = 'protanopia';
      else type = 'deuteranopia';
    }
    // Grau: C-index 1.6 → 0.2 ; C-index ≥ 3.6 (padrão de dicromata) → 1.0
    const severity = normal ? 0
      : Math.min(1, Math.max(0.2, 0.2 + 0.8 * (cIndex - C_INDEX_NORMAL) / 2.0));

    return {
      normal, type, severity: Number(severity.toFixed(2)),
      label: severityLabel(severity),
      angle: Number(angle.toFixed(2)),
      majorRadius: Number(m.major.toFixed(2)),
      minorRadius: Number(m.minor.toFixed(2)),
      cIndex: Number(cIndex.toFixed(2)),
      sIndex: Number(sIndex.toFixed(2)),
      tes: Number(tes.toFixed(2)),
      tcds: Number(m.tcds.toFixed(2)),
      crossings: cross,
    };
  }

  // ---------- Interface ----------
  function shuffled() {
    let a;
    do {
      a = Array.from({ length: N_CAPS }, (_, i) => i + 1);
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
    } while (crossings(a).length < 6);   // evita começar quase ordenado
    return a;
  }

  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') e.className = v; else e.setAttribute(k, v);
    });
    if (text != null) e.textContent = text;
    return e;
  }

  /** Desenha o diagrama do resultado (peças no plano u*v* ligadas na ordem do usuário). */
  function drawDiagram(canvas, order, result) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, pad = 18;
    const sx = (u) => pad + (u + 30) / 66 * (W - 2 * pad);
    const sy = (v) => H - pad - (v + 42) / 78 * (H - 2 * pad);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#15181d';
    ctx.fillRect(0, 0, W, H);

    // Eixo de confusão estimado
    if (!result.normal) {
      const t = result.angle * Math.PI / 180, L = 60;
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.55)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(sx(4 - L * Math.cos(t)), sy(-4 - L * Math.sin(t)));
      ctx.lineTo(sx(4 + L * Math.cos(t)), sy(-4 + L * Math.sin(t)));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Caminho na ordem escolhida
    const seq = [0].concat(order);
    ctx.strokeStyle = '#e8eaed';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    seq.forEach((c, i) => {
      const [u, v] = CAPS_UV[c];
      if (i === 0) ctx.moveTo(sx(u), sy(v)); else ctx.lineTo(sx(u), sy(v));
    });
    ctx.stroke();

    // Peças
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    CAPS_UV.forEach(([u, v], i) => {
      ctx.fillStyle = CAP_COLORS[i];
      ctx.beginPath();
      ctx.arc(sx(u), sy(v), 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(i === 0 ? 'P' : String(i), sx(u), sy(v));
    });
  }

  const Diagnostic = {
    CAPS_UV, MUNSELL, CAP_COLORS, TYPE_NAMES, PERFECT_MAJOR: PERFECT.major,
    score, crossings, severityLabel,

    /** Monta o teste em controlsEl. onResult({ type, severity, normal, ... }) é chamado ao concluir. */
    start(canvas, controlsEl, onResult) {
      this.canvas = canvas;
      this.root = controlsEl;
      this.onResult = onResult;
      this.reset();
    },

    reset() {
      this.order = shuffled();
      this.selected = null;   // índice (na ordem) da peça selecionada
      this.grabbed = false;   // modo "mover com setas"
      if (this.canvas) this.canvas.hidden = true;
      this.renderTest();
    },

    renderTest() {
      const root = this.root;
      root.textContent = '';

      root.append(el('p', { class: 'hint', id: 'diagHelp' },
        'Organize as peças em sequência de cor, começando pela peça fixa (P). ' +
        'Arraste com o mouse ou o dedo. No teclado: Tab até uma peça, Espaço para pegar, ' +
        'setas ← → para mover, Espaço para soltar.'));

      const row = el('div', { class: 'caps' });
      const ref = el('div', { class: 'cap cap-ref', role: 'img', 'aria-label': 'Peça fixa de referência' });
      ref.style.background = CAP_COLORS[0];
      ref.append(el('span', { class: 'cap-tag', 'aria-hidden': 'true' }, 'P'));
      row.append(ref);

      const list = el('ol', { class: 'cap-list', 'aria-describedby': 'diagHelp', 'aria-label': 'Peças a ordenar' });
      row.append(list);
      root.append(row);
      this.list = list;

      const tools = el('div', { class: 'diag-tools' });
      this.btnLeft = el('button', { type: 'button', class: 'btn-secondary', 'aria-label': 'Mover peça selecionada para a esquerda' }, '◀ Mover');
      this.btnRight = el('button', { type: 'button', class: 'btn-secondary', 'aria-label': 'Mover peça selecionada para a direita' }, 'Mover ▶');
      const btnDone = el('button', { type: 'button' }, 'Concluir');
      const btnShuffle = el('button', { type: 'button', class: 'btn-ghost' }, 'Embaralhar');
      tools.append(this.btnLeft, this.btnRight, btnShuffle, btnDone);
      root.append(tools);

      this.live = el('p', { class: 'sr-only', 'aria-live': 'polite' });
      root.append(this.live);

      this.btnLeft.addEventListener('click', () => this.moveSelected(-1));
      this.btnRight.addEventListener('click', () => this.moveSelected(1));
      btnShuffle.addEventListener('click', () => this.reset());
      btnDone.addEventListener('click', () => this.finish());

      this.bindPointer(list);
      this.renderCaps();
    },

    renderCaps(focusIndex) {
      const list = this.list;
      list.textContent = '';
      this.order.forEach((cap, i) => {
        const li = el('li');
        const b = el('button', {
          type: 'button', class: 'cap', 'data-index': String(i),
          'aria-label': `Peça na posição ${i + 1} de ${N_CAPS}`,
          'aria-pressed': String(this.selected === i),
        });
        b.style.background = CAP_COLORS[cap];
        if (this.selected === i) b.classList.add('is-selected');
        if (this.selected === i && this.grabbed) b.classList.add('is-grabbed');
        b.addEventListener('keydown', (e) => this.onKey(e, i));
        b.addEventListener('click', (e) => {
          if (this._suppressClick) { this._suppressClick = false; return; }
          if (e.detail === 0) return; // Espaço/Enter tratados em keydown
          this.selected = this.selected === i ? null : i;
          this.grabbed = false;
          this.renderCaps(i);
        });
        li.append(b);
        list.append(li);
      });
      const has = this.selected != null;
      this.btnLeft.disabled = !has || this.selected === 0;
      this.btnRight.disabled = !has || this.selected === N_CAPS - 1;
      if (focusIndex != null) {
        const f = list.querySelector(`[data-index="${focusIndex}"]`);
        if (f) f.focus();
      }
    },

    move(from, to) {
      if (to < 0 || to >= N_CAPS || from === to) return false;
      const [cap] = this.order.splice(from, 1);
      this.order.splice(to, 0, cap);
      return true;
    },

    moveSelected(dir) {
      if (this.selected == null) return;
      const to = this.selected + dir;
      if (this.move(this.selected, to)) {
        this.selected = to;
        this.live.textContent = `Peça movida para a posição ${to + 1}.`;
        this.renderCaps(to);
      }
    },

    onKey(e, i) {
      const k = e.key;
      if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        if (this.grabbed && this.selected === i) {
          this.grabbed = false;
          this.live.textContent = `Peça solta na posição ${i + 1}.`;
        } else {
          this.selected = i; this.grabbed = true;
          this.live.textContent = `Peça da posição ${i + 1} pega. Use as setas para mover.`;
        }
        this.renderCaps(i);
      } else if (k === 'Escape' && this.grabbed) {
        this.grabbed = false;
        this.renderCaps(i);
      } else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const dir = (k === 'ArrowLeft' || k === 'ArrowUp') ? -1 : 1;
        if (this.grabbed && this.selected === i) this.moveSelected(dir);
        else {
          const t = Math.min(N_CAPS - 1, Math.max(0, i + dir));
          this.list.querySelector(`[data-index="${t}"]`).focus();
        }
      } else if (k === 'Home' || k === 'End') {
        e.preventDefault();
        const t = k === 'Home' ? 0 : N_CAPS - 1;
        if (this.grabbed && this.selected === i) {
          this.move(i, t); this.selected = t; this.renderCaps(t);
        } else this.list.querySelector(`[data-index="${t}"]`).focus();
      }
    },

    /** Arrastar e soltar com Pointer Events (mouse, toque e caneta). */
    bindPointer(list) {
      let drag = null;
      list.addEventListener('pointerdown', (e) => {
        const b = e.target.closest('.cap');
        if (!b || e.button > 0) return;
        drag = { index: Number(b.dataset.index), x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      });
      list.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
          drag.moved = true;
          try { list.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro sintético */ }
          this.selected = drag.index; this.grabbed = true;
          this.renderCaps();
          list.classList.add('is-dragging');
        }
        e.preventDefault();
        // Peça sob o ponteiro: a mais próxima pelo centro
        const caps = Array.from(list.querySelectorAll('.cap'));
        let best = drag.index, bestD = Infinity;
        caps.forEach((c, i) => {
          const r = c.getBoundingClientRect();
          const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best !== drag.index && this.move(drag.index, best)) {
          drag.index = best; this.selected = best;
          this.renderCaps();
        }
      });
      const end = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (drag.moved) {
          this._suppressClick = true;
          setTimeout(() => { this._suppressClick = false; }, 0);
          this.grabbed = false;
          list.classList.remove('is-dragging');
          this.live.textContent = `Peça solta na posição ${drag.index + 1}.`;
          this.renderCaps();
        }
        drag = null;
      };
      list.addEventListener('pointerup', end);
      list.addEventListener('pointercancel', end);
    },

    finish() {
      const r = score(this.order);
      this.result = r;
      this.renderResult(r);
      if (this.onResult) this.onResult(r);
    },

    renderResult(r) {
      const root = this.root;
      root.textContent = '';
      const box = el('div', { class: 'result', role: 'status' });
      const title = r.normal
        ? 'Sem indicação de deficiência de cor'
        : `${TYPE_NAMES[r.type]} · grau ${Math.round(r.severity * 100)}% (${r.label})`;
      box.append(el('p', { class: 'result-title' }, title));
      box.append(el('p', { class: 'hint' }, r.normal
        ? 'Sua ordenação ficou dentro do esperado. O perfil foi mantido sem correção (grau 0%); ajuste manualmente se quiser.'
        : 'O perfil de correção foi gerado e salvo. Refine o grau e a intensidade no card Perfil.'));

      const dl = el('dl', { class: 'metrics' });
      [
        ['Ângulo', `${r.angle}°`], ['C-index', r.cIndex], ['S-index', Number.isFinite(r.sIndex) ? r.sIndex : '—'],
        ['TES', r.tes], ['Cruzamentos', r.crossings.length],
      ].forEach(([k, v]) => { dl.append(el('dt', {}, k), el('dd', {}, String(v))); });
      box.append(dl);
      box.append(el('p', { class: 'disclaimer' },
        'Triagem apenas: não substitui avaliação oftalmológica. O resultado depende da calibração e do brilho da tela.'));

      const again = el('button', { type: 'button' }, 'Refazer teste');
      again.addEventListener('click', () => this.reset());
      box.append(again);
      root.append(box);

      if (this.canvas) {
        this.canvas.hidden = false;
        drawDiagram(this.canvas, this.order, r);
      }
      again.focus();
    },
  };

  global.Diagnostic = Diagnostic;
  if (typeof module !== 'undefined' && module.exports) module.exports = Diagnostic;
})(typeof window !== 'undefined' ? window : globalThis);
