/**
 * export.js – Sistema de exportação e portabilidade.
 *
 * O que fará:
 *  - svgSnippet(): <svg> com <feColorMatrix> + regra CSS filter: url(#...).
 *  - cubeLUT(): arquivo 3D LUT .cube (padrão Adobe/Resolve, usado no OBS).
 *  - profileJSON(): perfil .json (lido de volta pelo import.js).
 *  - bookmarklet(): javascript:... que injeta o filtro SVG em qualquer página.
 *  Todos usam a mesma matriz afim do ColorMatrix.
 */
(function (global) {
  'use strict';

  const fmt = (n) => Number(n.toFixed(6));
  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  const Export = {
    svgSnippet(profile) {
      const values = ColorMatrix.toFeColorMatrix(profile).map(fmt).join(' ');
      return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">
  <filter id="cvd-filter" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="${values}"/>
  </filter>
</svg>

/* CSS */
html { filter: url(#cvd-filter); }`;
    },

    /** Gera o texto de um .cube de tamanho N (17, 33 ou 65). Ordem: R varia mais rápido. */
    cubeLUT(profile, size = 33) {
      const { m, offset } = ColorMatrix.affine(profile);
      const lines = [
        `TITLE "Daltonismo ${profile.type}"`,
        `LUT_3D_SIZE ${size}`,
        'DOMAIN_MIN 0.0 0.0 0.0',
        'DOMAIN_MAX 1.0 1.0 1.0',
      ];
      const n = size - 1;
      for (let b = 0; b < size; b++)
        for (let g = 0; g < size; g++)
          for (let r = 0; r < size; r++) {
            const R = r / n, G = g / n, B = b / n;
            const o = [
              m[0] * R + m[1] * G + m[2] * B + offset,
              m[3] * R + m[4] * G + m[5] * B + offset,
              m[6] * R + m[7] * G + m[8] * B + offset,
            ].map((v) => clamp01(v).toFixed(6));
            lines.push(o.join(' '));
          }
      return lines.join('\n') + '\n';
    },

    /** Perfil em JSON (o mesmo formato que o import.js lê de volta). Precisão total. */
    profileJSON(profile) {
      const out = {
        app: 'filtro-cromatico',
        version: 1,
        type: profile.type,
        severity: profile.severity,
        intensity: profile.intensity,
        matrix: profile.matrix.slice(),
        adjust: { contrast: profile.adjust.contrast, brightness: profile.adjust.brightness },
        createdAt: profile.createdAt || new Date().toISOString(),
        exportedAt: new Date().toISOString(),
      };
      if (profile.source === 'imported') out.source = 'imported';
      return JSON.stringify(out, null, 2) + '\n';
    },

    bookmarklet(profile) {
      const values = ColorMatrix.toFeColorMatrix(profile).map(fmt).join(' ');
      // Alterna: clicar de novo remove o filtro
      const code = `(function(){var id='cvd-bm';var e=document.getElementById(id);` +
        `if(e){e.remove();document.documentElement.style.filter='';return;}` +
        `var d=document.createElement('div');d.id=id;` +
        `d.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute"><filter id="cvd-bm-f" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${values}"/></filter></svg>';` +
        `document.body.appendChild(d);document.documentElement.style.filter='url(#cvd-bm-f)';})();`;
      return 'javascript:' + encodeURIComponent(code);
    },

    download(filename, text, mime = 'text/plain') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: mime }));
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };

  global.Export = Export;
  if (typeof module !== 'undefined' && module.exports) module.exports = Export;
})(typeof window !== 'undefined' ? window : globalThis);
