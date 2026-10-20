/**
 * bgRemoval.js
 * Modal for chroma-key / flood-fill background removal.
 *
 * The processing works on the original image at its native resolution.
 * The preview canvas is scaled down to fit the modal; click coordinates are
 * converted back with `displayScale`.
 */

let modalEl, canvasEl, hintEl;
let toleranceEl, toleranceValEl, featherEl, featherValEl;
let connectedEl, previewEl;
let applyBtn, cancelBtn;

let onApply = () => {};

let sourceURL = null;
let originalData = null;   // ImageData
let processedData = null;  // ImageData
let samplePoint = null;    // { x, y } in original pixels
let sampleColor = null;    // [r, g, b]
let displayScale = 1;
let reprocessTimer = null;

/* ------------------------------------------------------------------ init -- */

export function initBgRemoval({ onApply: cb } = {}) {
    if (cb) onApply = cb;

    modalEl = document.getElementById('bgRemovalModal');
    canvasEl = document.getElementById('bgRemovalCanvas');
    hintEl = document.getElementById('bgRemovalHint');
    toleranceEl = document.getElementById('bgTolerance');
    toleranceValEl = document.getElementById('bgToleranceVal');
    featherEl = document.getElementById('bgFeather');
    featherValEl = document.getElementById('bgFeatherVal');
    connectedEl = document.getElementById('bgConnectedOnly');
    previewEl = document.getElementById('bgPreview');
    applyBtn = document.getElementById('bgApply');
    cancelBtn = document.getElementById('bgCancel');

    toleranceEl.addEventListener('input', () => {
        toleranceValEl.textContent = toleranceEl.value;
        scheduleReprocess();
    });
    featherEl.addEventListener('input', () => {
        featherValEl.textContent = featherEl.value;
        scheduleReprocess();
    });
    connectedEl.addEventListener('change', scheduleReprocess);
    previewEl.addEventListener('change', () => {
        if (!sampleColor) return;
        if (previewEl.checked) drawProcessed();
        else drawOriginal();
    });

    canvasEl.addEventListener('click', onCanvasClick);

    applyBtn.addEventListener('click', applyAndClose);
    cancelBtn.addEventListener('click', closeModal);

    // Close on Esc while not blocking other handlers.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) {
            e.stopPropagation();
            closeModal();
        }
    }, true);
}

/* ----------------------------------------------------------------- open --- */

export function openBgRemoval(url) {
    sourceURL = url;
    samplePoint = null;
    sampleColor = null;
    processedData = null;
    applyBtn.disabled = true;

    loadImage(url)
        .then((img) => {
            const off = document.createElement('canvas');
            off.width = img.naturalWidth;
            off.height = img.naturalHeight;
            const octx = off.getContext('2d');
            octx.drawImage(img, 0, 0);

            try {
                originalData = octx.getImageData(0, 0, off.width, off.height);
            } catch (err) {
                alert('Could not read the image pixels. Is it tainted by CORS?');
                return;
            }

            const maxW = Math.min(window.innerWidth * 0.85, 900);
            const maxH = window.innerHeight * 0.55;
            displayScale = Math.min(
                maxW / originalData.width,
                maxH / originalData.height,
                1
            );

            canvasEl.width = Math.max(1, Math.round(originalData.width * displayScale));
            canvasEl.height = Math.max(1, Math.round(originalData.height * displayScale));

            hintEl.textContent = 'Click on the background to sample its color.';
            modalEl.classList.remove('hidden');
            drawOriginal();
        })
        .catch(() => {
            alert('Could not load the image.');
        });
}

function closeModal() {
    modalEl.classList.add('hidden');
    originalData = null;
    processedData = null;
    samplePoint = null;
    sampleColor = null;
    sourceURL = null;
}

function applyAndClose() {
    if (!processedData) {
        closeModal();
        return;
    }
    const tmp = document.createElement('canvas');
    tmp.width = processedData.width;
    tmp.height = processedData.height;
    tmp.getContext('2d').putImageData(processedData, 0, 0);
    const dataURL = tmp.toDataURL('image/png');
    onApply(dataURL);
    closeModal();
}

/* ---------------------------------------------------------------- click --- */

function onCanvasClick(e) {
    if (!originalData) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / displayScale);
    const y = Math.round((e.clientY - rect.top) / displayScale);

    if (x < 0 || x >= originalData.width || y < 0 || y >= originalData.height) return;

    const p = (y * originalData.width + x) * 4;
    sampleColor = [
        originalData.data[p],
        originalData.data[p + 1],
        originalData.data[p + 2],
    ];
    samplePoint = { x, y };

    reprocess();
}

/* ---------------------------------------------------------- processing --- */

function scheduleReprocess() {
    clearTimeout(reprocessTimer);
    reprocessTimer = setTimeout(reprocess, 60);
}

function reprocess() {
    if (!originalData || !sampleColor || !samplePoint) return;

    hintEl.textContent = 'Processing…';
    // Yield to let the hint paint before we block.
    requestAnimationFrame(() => {
        try {
            processedData = runBackgroundRemoval(originalData, {
                sampleColor,
                samplePoint,
                tolerance: Number(toleranceEl.value),
                feather: Number(featherEl.value),
                connectedOnly: connectedEl.checked,
            });
            applyBtn.disabled = false;
            hintEl.textContent =
                'Click another point to sample a different color, or click Apply.';
            if (previewEl.checked) drawProcessed();
            else drawOriginal();
        } catch (err) {
            console.error(err);
            hintEl.textContent = 'Processing failed.';
        }
    });
}

function runBackgroundRemoval(srcImageData, opts) {
    const { sampleColor: [sr, sg, sb], samplePoint, tolerance, feather, connectedOnly } = opts;
    const w = srcImageData.width;
    const h = srcImageData.height;
    const src = srcImageData.data;

    const out = new ImageData(new Uint8ClampedArray(src), w, h);
    const data = out.data;

    const tol2 = tolerance * tolerance;
    const mask = new Uint8Array(w * h);   // 0 / 1

    if (connectedOnly) {
        floodFillMask(src, w, h, samplePoint.x, samplePoint.y, sr, sg, sb, tol2, mask);
    } else {
        for (let i = 0, p = 0; i < w * h; i++, p += 4) {
            const dr = src[p] - sr;
            const dg = src[p + 1] - sg;
            const db = src[p + 2] - sb;
            if (dr * dr + dg * dg + db * db <= tol2) mask[i] = 1;
        }
    }

    const alphaMask = feather > 0 ? blurMask(mask, w, h, feather) : mask;

    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
        const a = alphaMask[i];
        if (a) {
            data[p + 3] = Math.max(0, Math.round(data[p + 3] * (1 - a)));
        }
    }

    return out;
}

/**
 * 4-way flood fill, matching pixels within the squared RGB tolerance.
 * Pushes each neighbour at most once (visited flag set on push) so the
 * Int32Array stack can't exceed width*height.
 */
function floodFillMask(src, w, h, startX, startY, sr, sg, sb, tol2, mask) {
    const startIdx = startY * w + startX;
    if (startIdx < 0 || startIdx >= w * h) return;

    const visited = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let sp = 0;

    stack[sp++] = startIdx;
    visited[startIdx] = 1;

    while (sp > 0) {
        const idx = stack[--sp];
        const p = idx * 4;
        const dr = src[p] - sr;
        const dg = src[p + 1] - sg;
        const db = src[p + 2] - sb;

        if (dr * dr + dg * dg + db * db > tol2) continue;

        mask[idx] = 1;

        const x = idx % w;
        const y = (idx / w) | 0;

        if (x > 0)      maybePush(idx - 1);
        if (x < w - 1)  maybePush(idx + 1);
        if (y > 0)      maybePush(idx - w);
        if (y < h - 1)  maybePush(idx + w);
    }

    function maybePush(n) {
        if (!visited[n]) {
            visited[n] = 1;
            stack[sp++] = n;
        }
    }
}

/** Separable box blur on the (binary) mask, returned as 0..1 floats. */
function blurMask(mask, w, h, radius) {
    const tmp = new Float32Array(w * h);
    const diam = radius * 2 + 1;

    // Horizontal pass
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let dx = -radius; dx <= radius; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < w) sum += mask[row + nx];
            }
            tmp[row + x] = sum / diam;
        }
    }

    // Vertical pass
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                const ny = y + dy;
                if (ny >= 0 && ny < h) sum += tmp[ny * w + x];
            }
            out[y * w + x] = sum / diam;
        }
    }

    return out;
}

/* --------------------------------------------------------------- drawing -- */

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load image'));
        img.src = src;
    });
}

function drawCheckerboard(ctx, w, h, size = 10) {
    for (let y = 0; y < h; y += size) {
        for (let x = 0; x < w; x += size) {
            const dark = ((x / size) + (y / size)) % 2 === 0;
            ctx.fillStyle = dark ? '#ddd' : '#fff';
            ctx.fillRect(x, y, size, size);
        }
    }
}

function drawOriginal() {
    if (!originalData) return;
    const ctx = canvasEl.getContext('2d');
    const tmp = new OffscreenOrCanvas(originalData.width, originalData.height);
    tmp.ctx.putImageData(originalData, 0, 0);

    drawCheckerboard(ctx, canvasEl.width, canvasEl.height);
    ctx.drawImage(tmp.canvas, 0, 0, canvasEl.width, canvasEl.height);
    drawMarker(ctx);
}

function drawProcessed() {
    if (!processedData) return;
    const ctx = canvasEl.getContext('2d');
    const tmp = new OffscreenOrCanvas(processedData.width, processedData.height);
    tmp.ctx.putImageData(processedData, 0, 0);

    drawCheckerboard(ctx, canvasEl.width, canvasEl.height);
    ctx.drawImage(tmp.canvas, 0, 0, canvasEl.width, canvasEl.height);
    drawMarker(ctx);
}

function drawMarker(ctx) {
    if (!samplePoint) return;
    const sx = samplePoint.x * displayScale;
    const sy = samplePoint.y * displayScale;

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
}

function OffscreenOrCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
}