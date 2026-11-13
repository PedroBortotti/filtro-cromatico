/**
 * lab.js – Laboratório de validação visual (antes e depois).
 *
 * O que fará:
 *  - Carregar imagem ou vídeo enviado pelo usuário (<input type="file">).
 *  - Desenhar o original em #originalCanvas e a versão filtrada em #filteredCanvas.
 *  - Para vídeo, renderizar frame a frame com requestAnimationFrame.
 *  - Controlar a divisão split-screen com o slider (#splitSlider) via clip-path.
 *  - useSource(): usa uma fonte já pronta (ex.: imagem de demonstração gerada no canvas).
 *  - Futuro: motor WebGL para vídeo em alta resolução, e webcam.
 */
(function (global) {
  'use strict';

  const Lab = {
    els: null,
    getProfile: null,   // função que devolve o perfil atual
    raf: null,
    current: null,      // <img> ou <video> em uso

    init(els, getProfile) {
      this.els = els;
      this.getProfile = getProfile;
      els.input.addEventListener('change', (e) => this.load(e.target.files[0]));
      els.slider.addEventListener('input', () => this.updateSplit());
      this.updateSplit();
    },

    load(file) {
      if (!file) return;
      this.stop();
      const url = URL.createObjectURL(file);
      if (file.type.startsWith('video/')) {
        const v = this.els.video;
        v.src = url;
        v.onloadeddata = () => { this.current = v; v.play(); this.loop(); };
      } else {
        const img = new Image();
        img.onload = () => { this.current = img; this.render(); };
        img.src = url;
      }
    },

    /** Usa uma fonte já carregada (img, canvas ou vídeo pronto). */
    useSource(src) {
      this.stop();
      this.current = src;
      this.render();
    },

    /** Redesenha original e filtrado a partir da mídia atual. */
    render() {
      if (!this.current) return;
      ColorMatrix.renderFiltered(this.current, this.els.original, null);
      ColorMatrix.renderFiltered(this.current, this.els.filtered, this.getProfile());
    },

    loop() {
      const v = this.els.video;
      if (v.paused || v.ended) { this.raf = null; return; }
      this.render();
      this.raf = requestAnimationFrame(() => this.loop());
    },

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.els.video.pause();
    },

    updateSplit() {
      const pct = this.els.slider.value;
      this.els.filtered.style.clipPath = `inset(0 0 0 ${pct}%)`;
      if (this.els.line) this.els.line.style.left = `${pct}%`;
      if (this.els.output) this.els.output.value = `${pct}%`;
    },
  };

  global.Lab = Lab;
})(window);
