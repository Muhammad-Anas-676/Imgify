// public/js/editor.js
// Imgify — Client-side Canvas Image Editor | File 11/43
// ES Module | Zero external dependencies | Canvas API only

/**
 * initEditor(file, onComplete)
 * @param {File} file - Original image File object
 * @param {Function} onComplete - Called with (Blob|null)
 *   Blob  → edited image (replaces original in upload pipeline)
 *   null  → user skipped editor
 */
export function initEditor(file, onComplete) {
  const editor = new ImgifyEditor(file, onComplete);
  editor.mount();
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MAX_UNDO = 10;
const JPEG_QUALITY = 0.92;

// ─────────────────────────────────────────────────────────────────────────────
// EDITOR CLASS
// ─────────────────────────────────────────────────────────────────────────────

class ImgifyEditor {
  constructor(file, onComplete) {
    this.file = file;
    this.mime = file.type || 'image/jpeg';
    this.onComplete = onComplete;

    // Canvas / context references
    this.canvas = null;
    this.ctx = null;

    // Off-screen working canvas (holds current edited state)
    this.workCanvas = document.createElement('canvas');
    this.workCtx = this.workCanvas.getContext('2d');

    // Source image — always original pixels for filter re-application
    this.sourceImg = null;

    // Transform state
    this.rotation = 0;      // degrees: 0, 90, 180, 270
    this.flipH = false;
    this.flipV = false;
    this.brightness = 0;    // -100 to +100
    this.contrast = 0;      // -100 to +100

    // Crop state
    this.cropActive = false;
    this.cropRect = null;   // { x, y, w, h } in canvas display coords
    this.cropStart = null;
    this.isDragging = false;

    // Undo stack — stores ImageData snapshots of workCanvas
    this.undoStack = [];
    this.undoPending = false; // prevent double-push on same gesture

    // DOM references
    this.overlay = null;
    this.brightnessSlider = null;
    this.contrastSlider = null;
    this.brightnessVal = null;
    this.contrastVal = null;
    this.undoBtn = null;
    this.cropBtn = null;
    this.statusEl = null;
  }

  // ─── MOUNT ────────────────────────────────────────────────────────────────

  mount() {
    this._injectStyles();
    this._buildDOM();
    this._loadImage();
  }

  unmount() {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }

  // ─── STYLES ───────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('imgify-editor-styles')) return;
    const style = document.createElement('style');
    style.id = 'imgify-editor-styles';
    style.textContent = `
      .ige-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(0,0,0,0.88);
        display: flex;
        align-items: center;
        justify-content: center;
        animation: ige-fade-in 0.2s ease;
      }
      @keyframes ige-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      .ige-modal {
        background: var(--bg-primary, #ffffff);
        border-radius: 12px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
        max-width: min(96vw, 900px);
        width: 100%;
        max-height: 96vh;
        overflow: hidden;
        font-family: var(--font-body, 'DM Sans', sans-serif);
      }
      .ige-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid var(--border, #e2e0dc);
        flex-shrink: 0;
      }
      .ige-title {
        font-family: var(--font-display, 'Playfair Display', serif);
        font-size: 17px;
        font-weight: 700;
        color: var(--text-primary, #0d0d0d);
      }
      .ige-close {
        width: 30px; height: 30px;
        border: none; background: none; cursor: pointer;
        border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
        color: var(--text-muted, #6b6b6b);
        font-size: 20px;
        transition: background 0.15s, color 0.15s;
      }
      .ige-close:hover {
        background: var(--bg-tertiary, #eeecea);
        color: var(--text-primary, #0d0d0d);
      }
      .ige-body {
        display: flex;
        flex: 1;
        overflow: hidden;
        min-height: 0;
      }
      .ige-canvas-area {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-secondary, #f7f6f3);
        padding: 16px;
        overflow: hidden;
        position: relative;
        cursor: default;
      }
      .ige-canvas-area.crop-mode {
        cursor: crosshair;
      }
      .ige-canvas {
        display: block;
        max-width: 100%;
        max-height: 100%;
        border-radius: 4px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        image-rendering: -webkit-optimize-contrast;
        image-rendering: crisp-edges;
      }
      .ige-crop-overlay {
        position: absolute;
        border: 2px solid var(--accent, #1a56db);
        background: rgba(26,86,219,0.08);
        pointer-events: none;
        display: none;
        box-shadow: 0 0 0 9999px rgba(0,0,0,0.35);
      }
      .ige-crop-overlay.visible { display: block; }
      .ige-sidebar {
        width: 220px;
        flex-shrink: 0;
        border-left: 1px solid var(--border, #e2e0dc);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        background: var(--bg-primary, #ffffff);
      }
      .ige-section {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border, #e2e0dc);
      }
      .ige-section-label {
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--text-hint, #9a9a9a);
        margin-bottom: 10px;
      }
      .ige-btn-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .ige-tool-btn {
        flex: 1;
        min-width: 0;
        padding: 7px 8px;
        border: 1px solid var(--border, #e2e0dc);
        border-radius: 6px;
        background: var(--bg-secondary, #f7f6f3);
        color: var(--text-secondary, #3a3a3a);
        font-family: var(--font-body, 'DM Sans', sans-serif);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s, color 0.15s;
        white-space: nowrap;
        text-align: center;
      }
      .ige-tool-btn:hover {
        background: var(--accent-light, #e8f0fe);
        border-color: var(--accent, #1a56db);
        color: var(--accent, #1a56db);
      }
      .ige-tool-btn.active {
        background: var(--accent, #1a56db);
        border-color: var(--accent, #1a56db);
        color: #ffffff;
      }
      .ige-tool-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .ige-slider-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
      }
      .ige-slider-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        color: var(--text-secondary, #3a3a3a);
        font-weight: 500;
      }
      .ige-slider-val {
        font-family: var(--font-mono, 'JetBrains Mono', monospace);
        font-size: 11px;
        color: var(--text-muted, #6b6b6b);
        min-width: 28px;
        text-align: right;
      }
      .ige-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        border-radius: 2px;
        background: var(--border-strong, #d0cdc8);
        outline: none;
        cursor: pointer;
      }
      .ige-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px; height: 14px;
        border-radius: 50%;
        background: var(--accent, #1a56db);
        border: 2px solid #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        cursor: pointer;
        transition: transform 0.1s;
      }
      .ige-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
      .ige-slider::-moz-range-thumb {
        width: 14px; height: 14px;
        border-radius: 50%;
        background: var(--accent, #1a56db);
        border: 2px solid #fff;
        cursor: pointer;
      }
      .ige-status {
        padding: 8px 16px;
        font-size: 11px;
        color: var(--text-muted, #6b6b6b);
        min-height: 28px;
        background: var(--bg-secondary, #f7f6f3);
        border-top: 1px solid var(--border, #e2e0dc);
        flex-shrink: 0;
        font-style: italic;
      }
      .ige-footer {
        padding: 14px 20px;
        border-top: 1px solid var(--border, #e2e0dc);
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        flex-shrink: 0;
        background: var(--bg-primary, #ffffff);
      }
      .ige-btn-skip {
        padding: 9px 18px;
        border: 1px solid var(--border-strong, #d0cdc8);
        border-radius: 8px;
        background: transparent;
        color: var(--text-secondary, #3a3a3a);
        font-family: var(--font-body, 'DM Sans', sans-serif);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
      }
      .ige-btn-skip:hover { background: var(--bg-secondary, #f7f6f3); }
      .ige-btn-apply {
        padding: 9px 20px;
        border: none;
        border-radius: 8px;
        background: var(--accent, #1a56db);
        color: #ffffff;
        font-family: var(--font-body, 'DM Sans', sans-serif);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .ige-btn-apply:hover { opacity: 0.87; }

      /* Responsive: stack on small screens */
      @media (max-width: 640px) {
        .ige-body { flex-direction: column; }
        .ige-sidebar {
          width: 100%;
          border-left: none;
          border-top: 1px solid var(--border, #e2e0dc);
          max-height: 220px;
        }
        .ige-btn-row { gap: 4px; }
      }

      /* Dark theme */
      [data-theme="dark"] .ige-modal {
        background: var(--bg-primary, #0d0d0d);
      }
      [data-theme="dark"] .ige-canvas-area {
        background: var(--bg-secondary, #161616);
      }
    `;
    document.head.appendChild(style);
  }

  // ─── DOM BUILD ────────────────────────────────────────────────────────────

  _buildDOM() {
    // Overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'ige-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Image Editor');

    // Modal
    const modal = document.createElement('div');
    modal.className = 'ige-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'ige-header';
    const title = document.createElement('span');
    title.className = 'ige-title';
    title.textContent = 'Edit Image';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ige-close';
    closeBtn.setAttribute('aria-label', 'Close editor');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this._skip());
    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'ige-body';

    // Canvas area
    const canvasArea = document.createElement('div');
    canvasArea.className = 'ige-canvas-area';
    this.canvasArea = canvasArea;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ige-canvas';
    this.canvas.setAttribute('aria-label', 'Image preview');
    canvasArea.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Crop overlay div (visual rect indicator)
    this.cropOverlayEl = document.createElement('div');
    this.cropOverlayEl.className = 'ige-crop-overlay';
    canvasArea.appendChild(this.cropOverlayEl);

    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'ige-sidebar';

    // — Transform section —
    const transformSection = this._makeSection('Transform');

    const rotateRow = document.createElement('div');
    rotateRow.className = 'ige-btn-row';

    const rotateCCW = this._makeToolBtn('↺ -90°', () => this._rotate(-90));
    const rotateCW  = this._makeToolBtn('↻ +90°', () => this._rotate(90));
    rotateRow.appendChild(rotateCCW);
    rotateRow.appendChild(rotateCW);

    const flipRow = document.createElement('div');
    flipRow.className = 'ige-btn-row';
    flipRow.style.marginTop = '6px';

    const flipHBtn = this._makeToolBtn('⇄ Flip H', () => this._flip('h'));
    const flipVBtn = this._makeToolBtn('⇅ Flip V', () => this._flip('v'));
    flipRow.appendChild(flipHBtn);
    flipRow.appendChild(flipVBtn);

    transformSection.appendChild(rotateRow);
    transformSection.appendChild(flipRow);

    // — Crop section —
    const cropSection = this._makeSection('Crop');
    const cropRow = document.createElement('div');
    cropRow.className = 'ige-btn-row';

    this.cropBtn = this._makeToolBtn('✂ Select Crop', () => this._toggleCrop());
    const applyCropBtn = this._makeToolBtn('Apply Crop', () => this._applyCrop());
    applyCropBtn.style.flex = 'none';
    applyCropBtn.style.paddingLeft = '10px';
    applyCropBtn.style.paddingRight = '10px';

    cropRow.appendChild(this.cropBtn);
    cropRow.appendChild(applyCropBtn);
    cropSection.appendChild(cropRow);

    // — Adjustments section —
    const adjSection = this._makeSection('Adjustments');

    this.brightnessSlider = this._makeSlider('Brightness', -100, 100, 0, (v) => {
      this.brightness = v;
      this._renderPreview();
    });
    this.contrastSlider = this._makeSlider('Contrast', -100, 100, 0, (v) => {
      this.contrast = v;
      this._renderPreview();
    });
    adjSection.appendChild(this.brightnessSlider.row);
    adjSection.appendChild(this.contrastSlider.row);

    // — Undo section —
    const undoSection = this._makeSection('History');
    const undoRow = document.createElement('div');
    undoRow.className = 'ige-btn-row';
    this.undoBtn = this._makeToolBtn('↩ Undo', () => this._undo());
    this.undoBtn.disabled = true;
    undoRow.appendChild(this.undoBtn);

    const resetBtn = this._makeToolBtn('⊘ Reset', () => this._reset());
    undoRow.appendChild(resetBtn);
    undoSection.appendChild(undoRow);

    sidebar.appendChild(transformSection);
    sidebar.appendChild(cropSection);
    sidebar.appendChild(adjSection);
    sidebar.appendChild(undoSection);

    body.appendChild(canvasArea);
    body.appendChild(sidebar);

    // Status bar
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'ige-status';
    this.statusEl.textContent = 'Loading image…';

    // Footer
    const footer = document.createElement('div');
    footer.className = 'ige-footer';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'ige-btn-skip';
    skipBtn.textContent = 'Skip Editor';
    skipBtn.setAttribute('aria-label', 'Skip editor and upload original');
    skipBtn.addEventListener('click', () => this._skip());

    const applyBtn = document.createElement('button');
    applyBtn.className = 'ige-btn-apply';
    applyBtn.textContent = 'Apply Edits & Continue';
    applyBtn.setAttribute('aria-label', 'Apply edits and continue uploading');
    applyBtn.addEventListener('click', () => this._applyAndExport());

    footer.appendChild(skipBtn);
    footer.appendChild(applyBtn);

    // Assemble
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(this.statusEl);
    modal.appendChild(footer);
    this.overlay.appendChild(modal);
    document.body.appendChild(this.overlay);

    // Crop mouse events on canvas
    this._bindCropEvents();

    // Keyboard shortcut: Escape = skip
    this._escHandler = (e) => { if (e.key === 'Escape') this._skip(); };
    document.addEventListener('keydown', this._escHandler);
  }

  _makeSection(labelText) {
    const section = document.createElement('div');
    section.className = 'ige-section';
    const label = document.createElement('div');
    label.className = 'ige-section-label';
    label.textContent = labelText;
    section.appendChild(label);
    return section;
  }

  _makeToolBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'ige-tool-btn';
    btn.textContent = label;
    btn.type = 'button';
    btn.addEventListener('click', onClick);
    return btn;
  }

  _makeSlider(label, min, max, defaultVal, onChange) {
    const row = document.createElement('div');
    row.className = 'ige-slider-row';
    row.style.marginBottom = '10px';

    const labelRow = document.createElement('div');
    labelRow.className = 'ige-slider-label';
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const valEl = document.createElement('span');
    valEl.className = 'ige-slider-val';
    valEl.textContent = defaultVal;
    labelRow.appendChild(labelEl);
    labelRow.appendChild(valEl);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'ige-slider';
    input.min = min;
    input.max = max;
    input.value = defaultVal;
    input.setAttribute('aria-label', label);

    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10);
      valEl.textContent = v;
      onChange(v);
    });

    row.appendChild(labelRow);
    row.appendChild(input);
    return { row, input, valEl };
  }

  // ─── IMAGE LOAD ───────────────────────────────────────────────────────────

  _loadImage() {
    const url = URL.createObjectURL(this.file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      this.sourceImg = img;
      this.workCanvas.width  = img.naturalWidth;
      this.workCanvas.height = img.naturalHeight;
      this.workCtx.drawImage(img, 0, 0);
      this._renderPreview();
      this._setStatus('Ready. Crop, adjust, or apply edits.');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this._setStatus('Failed to load image.');
    };
    img.src = url;
  }

  // ─── PREVIEW RENDER ───────────────────────────────────────────────────────
  // Applies rotation, flip, brightness, contrast to sourceImg and draws to
  // display canvas. workCanvas always tracks the latest pre-filter state
  // (after crop is applied, workCanvas becomes new source).

  _renderPreview() {
    if (!this.sourceImg) return;

    const src = this._getCurrentSource();
    const radians = (this.rotation * Math.PI) / 180;
    const swapped = this.rotation === 90 || this.rotation === 270;

    const srcW = src.width;
    const srcH = src.height;
    const dstW = swapped ? srcH : srcW;
    const dstH = swapped ? srcW : srcH;

    // Fit inside canvas area
    const area = this.canvasArea;
    const areaW = area.clientWidth  - 32;
    const areaH = area.clientHeight - 32;
    const scale = Math.min(1, areaW / dstW, areaH / dstH);

    this.canvas.width  = Math.round(dstW * scale);
    this.canvas.height = Math.round(dstH * scale);

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
    ctx.rotate(radians);
    if (this.flipH) ctx.scale(-1, 1);
    if (this.flipV) ctx.scale(1, -1);

    const drawW = swapped ? srcH * scale : srcW * scale;
    const drawH = swapped ? srcW * scale : srcH * scale;
    ctx.drawImage(src, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Apply brightness/contrast as pixel filter
    if (this.brightness !== 0 || this.contrast !== 0) {
      this._applyFilters();
    }

    this._updateUndoBtn();
  }

  // Returns the current "source" for rendering
  // After crop operations, workCanvas holds the cropped image
  _getCurrentSource() {
    return this._hasCropApplied ? this.workCanvas : this.sourceImg;
  }

  // Canvas pixel-level brightness + contrast
  _applyFilters() {
    const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imgData.data;
    const b = this.brightness * 2.55;       // scale to 0-255 range
    const c = this.contrast;
    const factor = (259 * (c + 255)) / (255 * (259 - c));

    for (let i = 0; i < data.length; i += 4) {
      data[i]     = this._clamp(factor * (data[i]     - 128) + 128 + b);
      data[i + 1] = this._clamp(factor * (data[i + 1] - 128) + 128 + b);
      data[i + 2] = this._clamp(factor * (data[i + 2] - 128) + 128 + b);
    }
    this.ctx.putImageData(imgData, 0, 0);
  }

  _clamp(v) {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  // ─── CROP ─────────────────────────────────────────────────────────────────

  _toggleCrop() {
    this.cropActive = !this.cropActive;
    this.cropBtn.classList.toggle('active', this.cropActive);
    this.canvasArea.classList.toggle('crop-mode', this.cropActive);
    if (!this.cropActive) {
      this.cropRect = null;
      this.cropOverlayEl.classList.remove('visible');
    }
    this._setStatus(this.cropActive ? 'Drag on the image to select crop area.' : 'Crop cancelled.');
  }

  _bindCropEvents() {
    const getRelPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const onDown = (e) => {
      if (!this.cropActive) return;
      e.preventDefault();
      const pos = getRelPos(e);
      this.cropStart = pos;
      this.isDragging = true;
      this.cropRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    };

    const onMove = (e) => {
      if (!this.isDragging || !this.cropActive) return;
      e.preventDefault();
      const pos = getRelPos(e);
      const x = Math.min(this.cropStart.x, pos.x);
      const y = Math.min(this.cropStart.y, pos.y);
      const w = Math.abs(pos.x - this.cropStart.x);
      const h = Math.abs(pos.y - this.cropStart.y);
      this.cropRect = { x, y, w, h };
      this._drawCropOverlay(x, y, w, h);
    };

    const onUp = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
    };

    this.canvas.addEventListener('mousedown', onDown);
    this.canvas.addEventListener('mousemove', onMove);
    this.canvas.addEventListener('mouseup', onUp);
    this.canvas.addEventListener('touchstart', onDown, { passive: false });
    this.canvas.addEventListener('touchmove', onMove, { passive: false });
    this.canvas.addEventListener('touchend', onUp);
  }

  _drawCropOverlay(x, y, w, h) {
    const canvasRect = this.canvas.getBoundingClientRect();
    const areaRect   = this.canvasArea.getBoundingClientRect();
    const offX = canvasRect.left - areaRect.left;
    const offY = canvasRect.top  - areaRect.top;

    this.cropOverlayEl.style.left   = (offX + x) + 'px';
    this.cropOverlayEl.style.top    = (offY + y) + 'px';
    this.cropOverlayEl.style.width  = w + 'px';
    this.cropOverlayEl.style.height = h + 'px';
    this.cropOverlayEl.classList.add('visible');
  }

  _applyCrop() {
    if (!this.cropRect || this.cropRect.w < 4 || this.cropRect.h < 4) {
      this._setStatus('Draw a crop area first.');
      return;
    }

    // Convert display coords → actual canvas pixel coords
    const scaleX = this.canvas.width  / this.canvas.getBoundingClientRect().width;
    const scaleY = this.canvas.height / this.canvas.getBoundingClientRect().height;

    const sx = Math.round(this.cropRect.x * scaleX);
    const sy = Math.round(this.cropRect.y * scaleY);
    const sw = Math.round(this.cropRect.w * scaleX);
    const sh = Math.round(this.cropRect.h * scaleY);

    if (sw < 2 || sh < 2) {
      this._setStatus('Crop area too small.');
      return;
    }

    // Push undo before mutation
    this._pushUndo();

    // Read current canvas pixels at crop region
    const imageData = this.ctx.getImageData(sx, sy, sw, sh);

    // Write to workCanvas — this becomes new source
    this.workCanvas.width  = sw;
    this.workCanvas.height = sh;
    this.workCtx.putImageData(imageData, 0, 0);
    this._hasCropApplied = true;

    // Reset transforms (crop bakes rotation/flip/filters into result)
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.brightness = 0;
    this.contrast = 0;
    this._resetSliders();

    // Reset crop state
    this.cropActive = false;
    this.cropRect = null;
    this.cropBtn.classList.remove('active');
    this.canvasArea.classList.remove('crop-mode');
    this.cropOverlayEl.classList.remove('visible');

    this._renderPreview();
    this._setStatus('Crop applied.');
  }

  // ─── TRANSFORM ────────────────────────────────────────────────────────────

  _rotate(deg) {
    this._pushUndo();
    this.rotation = ((this.rotation + deg) % 360 + 360) % 360;
    this._renderPreview();
    this._setStatus(`Rotated ${deg > 0 ? '+' : ''}${deg}°`);
  }

  _flip(axis) {
    this._pushUndo();
    if (axis === 'h') this.flipH = !this.flipH;
    else               this.flipV = !this.flipV;
    this._renderPreview();
    this._setStatus(axis === 'h' ? 'Flipped horizontally.' : 'Flipped vertically.');
  }

  // ─── UNDO ─────────────────────────────────────────────────────────────────

  _pushUndo() {
    const snapshot = {
      rotation   : this.rotation,
      flipH      : this.flipH,
      flipV      : this.flipV,
      brightness : this.brightness,
      contrast   : this.contrast,
      hasCrop    : !!this._hasCropApplied,
      workW      : this.workCanvas.width,
      workH      : this.workCanvas.height,
      workData   : this.workCtx.getImageData(0, 0, this.workCanvas.width, this.workCanvas.height)
    };
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this._updateUndoBtn();
  }

  _undo() {
    if (this.undoStack.length === 0) return;
    const snap = this.undoStack.pop();

    this.rotation   = snap.rotation;
    this.flipH      = snap.flipH;
    this.flipV      = snap.flipV;
    this.brightness = snap.brightness;
    this.contrast   = snap.contrast;
    this._hasCropApplied = snap.hasCrop;

    this.workCanvas.width  = snap.workW;
    this.workCanvas.height = snap.workH;
    this.workCtx.putImageData(snap.workData, 0, 0);

    // Sync sliders
    this.brightnessSlider.input.value = this.brightness;
    this.brightnessSlider.valEl.textContent = this.brightness;
    this.contrastSlider.input.value = this.contrast;
    this.contrastSlider.valEl.textContent = this.contrast;

    this._renderPreview();
    this._setStatus('Undo applied.');
    this._updateUndoBtn();
  }

  _updateUndoBtn() {
    if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
  }

  // ─── RESET ────────────────────────────────────────────────────────────────

  _reset() {
    this._pushUndo();
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.brightness = 0;
    this.contrast = 0;
    this._hasCropApplied = false;

    // Restore workCanvas to original image
    this.workCanvas.width  = this.sourceImg.naturalWidth;
    this.workCanvas.height = this.sourceImg.naturalHeight;
    this.workCtx.drawImage(this.sourceImg, 0, 0);

    this._resetSliders();
    this._renderPreview();
    this._setStatus('Reset to original.');
  }

  _resetSliders() {
    this.brightnessSlider.input.value = 0;
    this.brightnessSlider.valEl.textContent = 0;
    this.contrastSlider.input.value = 0;
    this.contrastSlider.valEl.textContent = 0;
  }

  // ─── EXPORT ───────────────────────────────────────────────────────────────

  async _applyAndExport() {
    if (!this.canvas) return;

    this._setStatus('Exporting…');

    // Export from full-resolution off-screen canvas
    const exportCanvas = document.createElement('canvas');
    const src = this._getCurrentSource();
    const radians = (this.rotation * Math.PI) / 180;
    const swapped = this.rotation === 90 || this.rotation === 270;

    const srcW = src.width;
    const srcH = src.height;
    const dstW = swapped ? srcH : srcW;
    const dstH = swapped ? srcW : srcH;

    exportCanvas.width  = dstW;
    exportCanvas.height = dstH;

    const ectx = exportCanvas.getContext('2d');
    ectx.save();
    ectx.translate(dstW / 2, dstH / 2);
    ectx.rotate(radians);
    if (this.flipH) ectx.scale(-1, 1);
    if (this.flipV) ectx.scale(1, -1);
    ectx.drawImage(src, -srcW / 2, -srcH / 2, srcW, srcH);
    ectx.restore();

    // Apply brightness/contrast at full res
    if (this.brightness !== 0 || this.contrast !== 0) {
      const imgData = ectx.getImageData(0, 0, dstW, dstH);
      const data = imgData.data;
      const b = this.brightness * 2.55;
      const c = this.contrast;
      const factor = (259 * (c + 255)) / (255 * (259 - c));
      for (let i = 0; i < data.length; i += 4) {
        data[i]     = this._clamp(factor * (data[i]     - 128) + 128 + b);
        data[i + 1] = this._clamp(factor * (data[i + 1] - 128) + 128 + b);
        data[i + 2] = this._clamp(factor * (data[i + 2] - 128) + 128 + b);
      }
      ectx.putImageData(imgData, 0, 0);
    }

    const mime = this.mime === 'image/jpeg' || this.mime === 'image/jpg'
      ? 'image/jpeg'
      : this.mime === 'image/webp'
        ? 'image/webp'
        : 'image/png';

    const quality = mime === 'image/png' ? undefined : JPEG_QUALITY;

    exportCanvas.toBlob((blob) => {
      if (!blob) {
        this._setStatus('Export failed. Please try again.');
        return;
      }
      window.imgifyWasEdited = true;
      this.unmount();
      document.removeEventListener('keydown', this._escHandler);
      this.onComplete(blob);
    }, mime, quality);
  }

  // ─── SKIP ─────────────────────────────────────────────────────────────────

  _skip() {
    document.removeEventListener('keydown', this._escHandler);
    this.unmount();
    this.onComplete(null);
  }

  // ─── HELPERS ──────────────────────────────────────────────────────────────

  _setStatus(msg) {
    if (this.statusEl) this.statusEl.textContent = msg;
  }
}
