/**
 * app.js – Orquestração.
 * Liga os controles do perfil ao motor, salva no localStorage, mostra os valores
 * dos sliders, inicia o laboratório (com imagem de demonstração), o diagnóstico,
 * a exportação e a importação.
 *
 * Perfil importado (profile.source === 'imported'): a matriz importada é mantida
 * enquanto o usuário mexe só em intensidade, contraste e brilho. Mexer em tipo ou
 * grau (ou rodar o diagnóstico) volta a gerar a matriz pelo modelo.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const ui = {
    type: $('cvdType'), severity: $('severity'), intensity: $('intensity'),
    contrast: $('contrast'), brightness: $('brightness'),
  };
  const outs = {
    severity: $('severityOut'), intensity: $('intensityOut'),
    contrast: $('contrastOut'), brightness: $('brightnessOut'),
  };
  const status = $('profileStatus');

  const badge = $('importBadge');
  let profile = ColorMatrix.loadProfile();
  let bookmarkletShown = false;

  // Perfil importado salvo: revalida antes de confiar na matriz guardada
  if (profile && profile.source === 'imported') {
    try {
      const keep = { source: 'imported', createdAt: profile.createdAt, importedAt: profile.importedAt };
      profile = Object.assign(ImportProfile.validateProfile(profile).profile, keep);
    } catch (e) { profile = null; }
  }

  /** Reflete um perfil nos controles (tipo, grau, intensidade, contraste, brilho). */
  function setControls(p) {
    ui.type.value = p.type;
    ui.severity.value = Math.round(p.severity * 100);
    ui.intensity.value = Math.round(p.intensity * 100);
    ui.contrast.value = Math.round(p.adjust.contrast * 100);
    ui.brightness.value = Math.round(p.adjust.brightness * 100);
    // Matriz personalizada não tem "grau" no modelo
    ui.severity.disabled = p.type === 'custom';
  }

  if (profile && profile.adjust) {
    setControls(profile);
    status.textContent = profile.source === 'imported' ? 'Perfil importado carregado.' : 'Perfil salvo carregado.';
  }

  function updateOutputs() {
    outs.severity.value = `${ui.severity.value}%`;
    outs.intensity.value = `${ui.intensity.value}%`;
    outs.contrast.value = `${ui.contrast.value}%`;
    const b = Number(ui.brightness.value);
    outs.brightness.value = b > 0 ? `+${b}` : String(b);
  }

  function showMatrix() {
    const m = ColorMatrix.effectiveMatrix(profile).map((v) => v.toFixed(3).padStart(7));
    $('matrixOut').textContent = `${m[0]} ${m[1]} ${m[2]}\n${m[3]} ${m[4]} ${m[5]}\n${m[6]} ${m[7]} ${m[8]}`;
  }

  /** Salva e redesenha tudo a partir do perfil atual (sem recalcular a matriz). */
  function refresh() {
    ColorMatrix.saveProfile(profile);
    badge.hidden = profile.source !== 'imported';
    updateOutputs();
    showMatrix();
    Lab.render();
    if (bookmarkletShown) refreshBookmarklet();
  }

  /** Gera a matriz pelo modelo (tipo + grau) a partir dos controles. */
  function rebuild() {
    if (ui.type.value === 'custom') ui.type.value = 'deuteranopia';
    ui.severity.disabled = false;
    profile = ColorMatrix.createProfile({
      type: ui.type.value,
      severity: ui.severity.value / 100,
      intensity: ui.intensity.value / 100,
      contrast: ui.contrast.value / 100,
      brightness: ui.brightness.value / 100,
    });
    refresh();
  }

  Object.entries(ui).forEach(([key, el]) => el.addEventListener('input', () => {
    status.textContent = '';
    if (profile && profile.source === 'imported' && key !== 'type' && key !== 'severity') {
      // Mantém a matriz importada; só atualiza o controle que mudou
      if (key === 'intensity') profile.intensity = el.value / 100;
      else profile.adjust[key] = el.value / 100;
      refresh();
    } else {
      rebuild();
    }
  }));

  // ---------- Laboratório ----------
  Lab.init({
    input: $('mediaInput'), original: $('originalCanvas'), filtered: $('filteredCanvas'),
    slider: $('splitSlider'), video: $('sourceVideo'), line: $('splitLine'), output: $('splitOut'),
  }, () => profile);

  /** Imagem de demonstração: espectro de matizes + pares de cores que se confundem. */
  function makeSample() {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 500;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, c.width, c.height);
    // Espectro: matiz na horizontal, luminosidade na vertical
    for (let x = 0; x < 800; x += 4) {
      for (let y = 0; y < 180; y += 4) {
        ctx.fillStyle = `hsl(${x / 800 * 360}, 85%, ${30 + y / 180 * 45}%)`;
        ctx.fillRect(x, y, 4, 4);
      }
    }
    // Pares de confusão típicos
    const pairs = [
      ['#d7263d', '#4c9a2a', 'vermelho / verde'],
      ['#e07b00', '#8a9a00', 'laranja / oliva'],
      ['#2a6fdb', '#7b3fa0', 'azul / roxo'],
      ['#e6c229', '#7fc8a9', 'amarelo / verde-água'],
    ];
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    pairs.forEach(([a, b, label], i) => {
      const cx = 100 + i * 200;
      ctx.fillStyle = a; ctx.beginPath(); ctx.arc(cx - 38, 290, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = b; ctx.beginPath(); ctx.arc(cx + 38, 290, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillText(label, cx, 375);
    });
    // Faixa estilo gráfico/legenda
    const bars = ['#d62728', '#2ca02c', '#ff7f0e', '#1f77b4', '#9467bd', '#8c564b', '#e377c2', '#bcbd22'];
    bars.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(40 + i * 92, 410, 80, 60); });
    return c;
  }
  Lab.useSource(makeSample());

  // ---------- Diagnóstico ----------
  Diagnostic.start($('diagCanvas'), $('diagnosticControls'), (result) => {
    if (result.normal) {
      // Sem indicação: mantém o tipo atual, mas sem correção (matriz identidade)
      ui.severity.value = 0;
      status.textContent = 'Diagnóstico sem indicação: grau ajustado para 0%.';
    } else {
      ui.type.value = result.type;
      ui.severity.value = Math.round(result.severity * 100);
      ui.intensity.value = 100;
      status.textContent = `Perfil gerado pelo diagnóstico: ${Diagnostic.TYPE_NAMES[result.type]}, grau ${ui.severity.value}%.`;
    }
    rebuild();
  });

  // ---------- Exportar ----------
  const out = $('exportOutput');
  const bmBox = $('bookmarkletBox');
  /** O bookmarklet só existe como resultado gerado (não é um link fixo da página). */
  function refreshBookmarklet() {
    const code = Export.bookmarklet(profile);
    bmBox.replaceChildren();
    const a = document.createElement('a');
    a.className = 'bookmarklet';
    a.href = code;
    a.textContent = 'Filtro Cromático';
    a.title = 'Arraste para a barra de favoritos';
    a.addEventListener('click', (e) => e.preventDefault()); // aqui só serve para arrastar
    bmBox.append(a);
    bmBox.hidden = false;
    out.textContent = 'Arraste o botão "Filtro Cromático" acima para a barra de favoritos.\n' +
      'Clique nele em qualquer página para ligar/desligar o filtro.\n\n' + code;
  }
  function hideBookmarklet() {
    bookmarkletShown = false;
    bmBox.hidden = true;
    bmBox.replaceChildren();
  }

  $('btnSvg').addEventListener('click', () => {
    hideBookmarklet();
    out.textContent = Export.svgSnippet(profile);
  });
  $('btnJson').addEventListener('click', () => {
    hideBookmarklet();
    const json = Export.profileJSON(profile);
    Export.download(`filtro-cromatico-${profile.type}.json`, json, 'application/json');
    out.textContent = `Arquivo filtro-cromatico-${profile.type}.json gerado.\n` +
      'Use o bloco Importar para carregá-lo de volta.\n\n' + json;
  });
  $('btnCube').addEventListener('click', () => {
    hideBookmarklet();
    Export.download(`daltonismo-${profile.type}.cube`, Export.cubeLUT(profile));
    out.textContent = `Arquivo daltonismo-${profile.type}.cube gerado (LUT 3D 33x33x33).\n` +
      'No OBS: Filtros → Aplicar LUT → selecione o arquivo.';
  });
  $('btnBookmarklet').addEventListener('click', () => {
    bookmarkletShown = true;
    refreshBookmarklet();
  });
  $('btnCopy').addEventListener('click', async () => {
    const btn = $('btnCopy');
    try {
      await navigator.clipboard.writeText(out.textContent);
      btn.textContent = 'Copiado!';
    } catch (e) {
      // file:// pode bloquear a área de transferência: seleciona o texto para Ctrl+C
      const r = document.createRange(); r.selectNodeContents(out);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      btn.textContent = 'Selecionado (Ctrl+C)';
    }
    setTimeout(() => { btn.textContent = 'Copiar'; }, 1800);
  });

  // ---------- Importar ----------
  const impCard = $('importar');
  const impFile = $('importFile');
  const impText = $('importText');
  const impStatus = $('importStatus');

  function showImportMessage(kind, lines) {
    impStatus.className = `msg msg-${kind}`;
    impStatus.replaceChildren();
    lines.forEach((t, i) => {
      if (i) impStatus.append(document.createElement('br'));
      impStatus.append(document.createTextNode(t));
    });
  }

  function applyImport(result, sourceName) {
    profile = result.profile;
    setControls(profile);
    refresh();
    const from = sourceName ? ` de "${sourceName}"` : '';
    const first = result.kind === 'cube'
      ? `LUT .cube ${result.fit.size}³ importada${from}, convertida em matriz (erro RMS ${result.fit.rms.toFixed(4).replace('.', ',')}) e salva.`
      : `Perfil .json importado${from} e salvo.`;
    const lines = [first].concat(result.warnings);
    showImportMessage(result.warnings.length ? 'warn' : 'ok', lines);
    status.textContent = 'Perfil importado aplicado. Mexer em tipo ou grau volta ao modelo.';
  }

  function importError(e) {
    const msg = e && e.name === 'ImportError' ? e.message : 'Não foi possível ler o arquivo.';
    showImportMessage('error', [msg, 'O perfil atual não foi alterado.']);
    if (!(e && e.name === 'ImportError')) console.warn(e);
  }

  async function importFileObj(file) {
    try { applyImport(await ImportProfile.readFile(file), file.name); } catch (e) { importError(e); }
  }

  impFile.addEventListener('change', () => {
    if (impFile.files[0]) importFileObj(impFile.files[0]);
    impFile.value = ''; // permite reimportar o mesmo arquivo
  });
  $('btnImport').addEventListener('click', () => {
    try { applyImport(ImportProfile.parseAny(impText.value, ''), ''); } catch (e) { importError(e); }
  });

  // Arrastar e soltar um arquivo no bloco Importar
  ['dragenter', 'dragover'].forEach((ev) => impCard.addEventListener(ev, (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    impCard.classList.add('drop-active');
  }));
  ['dragleave', 'dragend'].forEach((ev) => impCard.addEventListener(ev, (e) => {
    if (!impCard.contains(e.relatedTarget)) impCard.classList.remove('drop-active');
  }));
  impCard.addEventListener('drop', (e) => {
    e.preventDefault();
    impCard.classList.remove('drop-active');
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) importFileObj(f);
  });

  // ---------- Botões do topo ----------
  function goTo(card, focusEl) {
    card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    (focusEl || card).focus({ preventScroll: true });
  }
  $('topImport').addEventListener('click', () => {
    goTo(impCard, impFile);
    impFile.click(); // abre o seletor de arquivo
  });
  $('topExport').addEventListener('click', () => goTo($('exportar'), $('btnSvg')));

  if (profile && profile.source === 'imported') refresh(); else rebuild();
})();
