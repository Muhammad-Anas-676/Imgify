// public/js/qrcode-helper.js
// File 12/43 — Imgify | Author: Muhammad Anas | imgify.site

const QR_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
let _qrLoaded = false;
let _qrLoading = null;

function loadQRLib() {
  if (_qrLoaded) return Promise.resolve();
  if (_qrLoading) return _qrLoading;

  _qrLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QR_CDN;
    script.onload = () => {
      _qrLoaded = true;
      _qrLoading = null;
      resolve();
    };
    script.onerror = () => {
      _qrLoading = null;
      reject(new Error('[qrcode-helper] Failed to load qrcode.js from CDN.'));
    };
    document.head.appendChild(script);
  });

  return _qrLoading;
}

/**
 * Renders a QR code into the given container.
 *
 * @param {HTMLElement|string} containerEl - DOM element OR string ID
 * @param {string} url
 * @param {Object} [options]
 * @param {string} [options.fg]
 * @param {string} [options.bg]
 * @param {number} [options.size]
 */
export async function generateQRCode(containerEl, url, options = {}) {
  // FIX: accept string ID or HTMLElement
  const el = typeof containerEl === 'string'
    ? document.getElementById(containerEl)
    : containerEl;
  if (!el) throw new Error('[qrcode-helper] Container not found: ' + containerEl);
  if (!url || typeof url !== 'string') throw new Error('[qrcode-helper] url is required.');

  await loadQRLib();

  el.innerHTML = '';

  const { fg = '#000000', bg = '#ffffff', size = 200 } = options;

  new window.QRCode(el, {
    text: url,
    width: size,
    height: size,
    colorDark: fg,
    colorLight: bg,
    correctLevel: window.QRCode.CorrectLevel.M,
  });
}

/**
 * Downloads the QR canvas as PNG.
 *
 * @param {HTMLElement|string} containerEl - DOM element OR string ID
 * @param {string} [filename]
 */
export function downloadQRCode(containerEl, filename = 'qrcode.png') {
  // FIX: accept string ID or HTMLElement
  const el = typeof containerEl === 'string'
    ? document.getElementById(containerEl)
    : containerEl;
  if (!el) throw new Error('[qrcode-helper] Container not found: ' + containerEl);

  const canvas = el.querySelector('canvas');
  if (!canvas) {
    console.warn('[qrcode-helper] No <canvas> found. Call generateQRCode() first.');
    return;
  }

  const dataURL = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}