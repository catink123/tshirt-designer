/**
 * drawWindow.js
 * Free-hand + shapes + text + select/move, undo/redo, edit-mode base layer.
 */

import { showHelpDialog, maybeAutoShowHelp } from './helpDialog.js';

const containerEl  = document.getElementById('canvasContainer');
const colorEl      = document.getElementById('color');
const sizeEl       = document.getElementById('size');
const sizeValueEl  = document.getElementById('sizeValue');
const undoBtn      = document.getElementById('undoBtn');
const redoBtn      = document.getElementById('redoBtn');
const clearBtn     = document.getElementById('clearBtn');
const cancelBtn    = document.getElementById('cancelBtn');
const doneBtn      = document.getElementById('doneBtn');
const checkerBtn   = document.getElementById('checkerBtn');
const toolButtons  = [...document.querySelectorAll('[data-tool]')];
const helpBtn = document.getElementById('helpBtn');

const DRAW_HELP = {
    title: 'Окно рисования',
    subtitle: 'Краткое руководство по инструментам',
    sections: [
        {
            title: 'Инструменты',
            items: [
                { icon: 'fa-arrow-pointer', name: 'Выделение',
                  desc: 'Выбирайте, перемещайте и масштабируйте нарисованные элементы.' },
                { icon: 'fa-paintbrush', name: 'Кисть',
                  desc: 'Свободное рисование от руки.' },
                { icon: 'fa-eraser', name: 'Ластик',
                  desc: 'Стирает нарисованное, в том числе из базового рисунка при редактировании.' },
                { icon: 'fa-slash', name: 'Линия',
                  desc: 'Проведите прямую линию.' },
                { icon: 'fa-arrow-right-long', name: 'Стрелка',
                  desc: 'Линия со стрелкой на конце.' },
                { icon: 'fa-square', name: 'Прямоугольник',
                  desc: 'Нарисуйте прямоугольник, протянув от угла к углу.' },
                { icon: 'fa-circle', name: 'Эллипс',
                  desc: 'Нарисуйте овал или круг.' },
                { icon: 'fa-font', name: 'Текст',
                  desc: 'Кликните на холсте и введите текст.' },
            ],
        },
        {
            title: 'Параметры',
            items: [
                { icon: 'fa-palette', name: 'Цвет',
                  desc: 'Цвет штриха и фигур.' },
                { icon: 'fa-circle-half-stroke', name: 'Размер',
                  desc: 'Толщина штриха или размер шрифта.' },
                { icon: 'fa-chess-board', name: 'Шахматный фон',
                  desc: 'Показывает прозрачные области. Отключите для чистого белого фона.' },
            ],
        },
        {
            title: 'История',
            items: [
                { icon: 'fa-rotate-left', name: 'Отменить',
                  desc: 'Отменяет последнее действие (Ctrl+Z).' },
                { icon: 'fa-rotate-right', name: 'Повторить',
                  desc: 'Возвращает отменённое действие (Ctrl+Y или Ctrl+Shift+Z).' },
                { icon: 'fa-trash', name: 'Очистить всё',
                  desc: 'Скрывает все штрихи. Можно отменить.' },
            ],
        },
        {
            title: 'Экспорт',
            items: [
                { icon: 'fa-xmark', name: 'Отмена',
                  desc: 'Закрыть окно без сохранения.' },
                { icon: 'fa-check', name: 'Добавить в дизайн',
                  desc: 'Рисунок станет объектом на футболке.' },
            ],
        },
        {
            title: 'Горячие клавиши',
            items: [
                { icon: 'fa-keyboard', name: 'Delete / Backspace',          desc: 'Удалить выбранный элемент.' },
                { icon: 'fa-keyboard', name: 'Ctrl + Z',                    desc: 'Отменить.' },
                { icon: 'fa-keyboard', name: 'Ctrl + Y / Ctrl + Shift + Z', desc: 'Повторить.' },
            ],
        },
    ],
};

helpBtn.addEventListener('click', () => showHelpDialog(DRAW_HELP));

maybeAutoShowHelp({
    storageKey: 'tshirt-help-draw-shown-v1',
    ...DRAW_HELP,
});

let tool = 'brush';

const stage = new Konva.Stage({
    container: 'canvasContainer',
    width: Math.max(1, containerEl.clientWidth),
    height: Math.max(1, containerEl.clientHeight),
});

const linesLayer = new Konva.Layer();
stage.add(linesLayer);

const transformer = new Konva.Transformer({
    rotateEnabled: true,
    borderStroke: '#4a90e2',
    anchorStroke: '#4a90e2',
    anchorFill: '#fff',
    anchorSize: 8,
    ignoreStroke: true,
});
linesLayer.add(transformer);

let bgNode = null;
let bgSource = null;
let selectedNode = null;

/* ---------------------------------------------------------- undo / redo --- */

const undoStack = [];
const redoStack = [];

function pushCommand(cmd) {
    undoStack.push(cmd);
    redoStack.length = 0;
    updateHistoryButtons();
}

function undo() {
    const cmd = undoStack.pop();
    if (!cmd) return;
    clearSelection();
    cmd.undo();
    redoStack.push(cmd);
    updateHistoryButtons();
    linesLayer.batchDraw();
}

function redo() {
    const cmd = redoStack.pop();
    if (!cmd) return;
    clearSelection();
    cmd.redo();
    undoStack.push(cmd);
    updateHistoryButtons();
    linesLayer.batchDraw();
}

function updateHistoryButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
}

/* ---------------------------------------------------------------- tools --- */

function setTool(newTool) {
    tool = newTool;
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));

    const selectable = tool === 'select';
    linesLayer.getChildren().forEach((n) => {
        if (n === bgNode || n === transformer) return;
        n.draggable(selectable);
    });

    if (!selectable) clearSelection();

    containerEl.style.cursor = selectable ? 'default' : 'crosshair';
    linesLayer.batchDraw();
}

toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

sizeEl.addEventListener('input', () => {
    sizeValueEl.textContent = sizeEl.value;
});

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

clearBtn.addEventListener('click', () => {
    const children = linesLayer.getChildren().slice()
        .filter((n) => n !== bgNode && n !== transformer && n.visible());
    if (!children.length) return;

    clearSelection();

    const cmds = children.map((n) => ({
        undo: () => { n.visible(true); linesLayer.batchDraw(); },
        redo: () => { n.visible(false); linesLayer.batchDraw(); },
    }));

    children.forEach((n) => n.visible(false));
    linesLayer.batchDraw();

    pushCommand({
        undo: () => cmds.forEach((c) => c.undo()),
        redo: () => cmds.forEach((c) => c.redo()),
    });
});

cancelBtn.addEventListener('click', () => window.close());

/* -------------------------------------------------------------- selection -- */

function selectNode(node) {
    if (!node || node === bgNode || node === transformer) {
        transformer.nodes([]);
        selectedNode = null;
        linesLayer.batchDraw();
        return;
    }
    transformer.nodes([node]);
    transformer.moveToTop();
    selectedNode = node;
    linesLayer.batchDraw();
}

function clearSelection() {
    transformer.nodes([]);
    selectedNode = null;
    linesLayer.batchDraw();
}

function deleteSelected() {
    const node = selectedNode;
    if (!node) return;
    clearSelection();
    node.visible(false);
    linesLayer.batchDraw();

    pushCommand({
        undo: () => { node.visible(true); linesLayer.batchDraw(); },
        redo: () => { node.visible(false); linesLayer.batchDraw(); },
    });
}

// Node drag → push a move command
linesLayer.on('dragstart', (e) => {
    const node = e.target;
    if (node === bgNode || node === transformer) return;
    node._dragFrom = { x: node.x(), y: node.y() };
});

linesLayer.on('dragend', (e) => {
    const node = e.target;
    if (node === bgNode || node === transformer) return;
    if (!node._dragFrom) return;
    const from = node._dragFrom;
    const to = { x: node.x(), y: node.y() };
    delete node._dragFrom;
    if (from.x === to.x && from.y === to.y) return;

    pushCommand({
        undo: () => { node.position(from); linesLayer.batchDraw(); },
        redo: () => { node.position(to);   linesLayer.batchDraw(); },
    });
});

/* -------------------------------------------------------------- layout --- */

function resize() {
    stage.size({
        width: Math.max(1, containerEl.clientWidth),
        height: Math.max(1, containerEl.clientHeight),
    });
    placeBackground();
}

window.addEventListener('resize', resize);

function placeBackground() {
    if (!bgNode || !bgSource) return;
    const pad = 20;
    const fit = Math.min(1,
        (stage.width() - pad * 2) / bgSource.width,
        (stage.height() - pad * 2) / bgSource.height
    );
    const s = Math.max(0.05, fit);
    const w = bgSource.width * s;
    const h = bgSource.height * s;

    bgNode.size({ width: w, height: h });
    bgNode.position({ x: (stage.width() - w) / 2, y: (stage.height() - h) / 2 });
    linesLayer.batchDraw();
}

/* -------------------------------------------------------------- drawing --- */

let isDrawing = false;
let currentLine = null;
let lastPoint = null;
let drawingShape = null;
let shapeStartPos = null;

function strokeWidth() {
    return Math.max(1, Number(sizeEl.value) || 1);
}

function startFreehand(pos) {
    isDrawing = true;
    lastPoint = pos;

    currentLine = new Konva.Line({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: colorEl.value,
        strokeWidth: strokeWidth(),
        lineCap: 'round',
        lineJoin: 'round',
        tension: 0.4,
        listening: false,
        globalCompositeOperation:
            tool === 'eraser' ? 'destination-out' : 'source-over',
    });

    linesLayer.add(currentLine);
    currentLine.moveToTop();
    transformer.moveToTop();
    linesLayer.batchDraw();
}

function continueFreehand(pos) {
    if (!isDrawing || !currentLine) return;
    const dx = pos.x - lastPoint.x;
    const dy = pos.y - lastPoint.y;
    if (dx * dx + dy * dy < 4) return;
    lastPoint = pos;
    const points = currentLine.points();
    points.push(pos.x, pos.y);
    currentLine.points(points);
    linesLayer.batchDraw();
}

function endFreehand() {
    if (!currentLine) { isDrawing = false; return; }
    const node = currentLine;
    currentLine = null;
    isDrawing = false;
    lastPoint = null;
    node.listening(tool === 'select');
    pushCommand({
        undo: () => { node.visible(false); linesLayer.batchDraw(); },
        redo: () => { node.visible(true);  linesLayer.batchDraw(); },
    });
}

function startShape(pos) {
    shapeStartPos = pos;
    const stroke = colorEl.value;
    const size = strokeWidth();

    if (tool === 'line') {
        drawingShape = new Konva.Line({
            points: [pos.x, pos.y, pos.x, pos.y],
            stroke, strokeWidth: size, lineCap: 'round', lineJoin: 'round',
        });
    } else if (tool === 'arrow') {
        drawingShape = new Konva.Arrow({
            points: [pos.x, pos.y, pos.x, pos.y],
            stroke, fill: stroke, strokeWidth: size,
            lineCap: 'round', lineJoin: 'round',
            pointerLength: Math.max(8, size * 2),
            pointerWidth: Math.max(8, size * 2),
        });
    } else if (tool === 'rect') {
        drawingShape = new Konva.Rect({
            x: pos.x, y: pos.y, width: 0, height: 0,
            stroke, strokeWidth: size,
        });
    } else if (tool === 'ellipse') {
        drawingShape = new Konva.Ellipse({
            x: pos.x, y: pos.y, radiusX: 0, radiusY: 0,
            stroke, strokeWidth: size,
        });
    }

    if (drawingShape) {
        drawingShape.listening(false);
        linesLayer.add(drawingShape);
        drawingShape.moveToTop();
        transformer.moveToTop();
        linesLayer.batchDraw();
    }
}

function updateShape(pos) {
    if (!drawingShape || !shapeStartPos) return;
    const sx = shapeStartPos.x, sy = shapeStartPos.y;

    if (tool === 'line' || tool === 'arrow') {
        drawingShape.points([sx, sy, pos.x, pos.y]);
    } else if (tool === 'rect') {
        drawingShape.setAttrs({
            x: Math.min(sx, pos.x), y: Math.min(sy, pos.y),
            width: Math.abs(pos.x - sx), height: Math.abs(pos.y - sy),
        });
    } else if (tool === 'ellipse') {
        drawingShape.setAttrs({
            x: (sx + pos.x) / 2, y: (sy + pos.y) / 2,
            radiusX: Math.abs(pos.x - sx) / 2,
            radiusY: Math.abs(pos.y - sy) / 2,
        });
    }
    linesLayer.batchDraw();
}

function endShape() {
    if (!drawingShape) { shapeStartPos = null; return; }
    const node = drawingShape;
    drawingShape = null;
    shapeStartPos = null;

    const rect = node.getClientRect();
    if (rect.width < 2 && rect.height < 2) {
        node.destroy();
        linesLayer.batchDraw();
        return;
    }

    node.listening(tool === 'select');
    node.draggable(tool === 'select');
    linesLayer.batchDraw();

    pushCommand({
        undo: () => { node.visible(false); linesLayer.batchDraw(); },
        redo: () => { node.visible(true);  linesLayer.batchDraw(); },
    });
}

function placeText(pos) {
    const text = prompt('Введите текст:', '');
    if (!text) return;

    const node = new Konva.Text({
        x: pos.x,
        y: pos.y,
        text,
        fontSize: Math.max(14, strokeWidth() * 2),
        fontFamily: 'system-ui, sans-serif',
        fill: colorEl.value,
        draggable: tool === 'select',
    });
    linesLayer.add(node);
    node.moveToTop();
    transformer.moveToTop();
    linesLayer.batchDraw();

    pushCommand({
        undo: () => { node.visible(false); linesLayer.batchDraw(); },
        redo: () => { node.visible(true);  linesLayer.batchDraw(); },
    });
}

/* --------------------------------------------------- pointer events -------- */

function pointerCount() {
    return (stage.getPointersPositions && stage.getPointersPositions().length) || 0;
}

stage.on('mousedown touchstart', (e) => {
    if (pointerCount() > 1) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (tool === 'select') {
        const clicked = e.target;
        if (clicked === stage || clicked === bgNode || clicked === transformer) {
            selectNode(null);
            return;
        }
        selectNode(clicked);
        return;
    }

    if (tool === 'text') {
        placeText(pos);
        return;
    }

    e.evt.preventDefault();

    if (tool === 'brush' || tool === 'eraser') startFreehand(pos);
    else startShape(pos);
});

stage.on('mousemove touchmove', (e) => {
    if (pointerCount() > 1) return;
    if (tool === 'select') return;
    if (tool === 'text') return;

    const pos = stage.getPointerPosition();
    if (!pos) return;
    e.evt.preventDefault();

    if (tool === 'brush' || tool === 'eraser') continueFreehand(pos);
    else updateShape(pos);
});

function finishPointer() {
    if (tool === 'brush' || tool === 'eraser') endFreehand();
    else endShape();
}

stage.on('mouseup touchend mouseleave touchcancel', finishPointer);
window.addEventListener('mouseup', finishPointer);

/* ---------------------------------------------------------------- export -- */

function getContentBox() {
    const children = linesLayer.getChildren().filter((n) => n !== transformer && n.visible());
    if (!children.length) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of children) {
        const r = node.getClientRect();
        if (!r || !isFinite(r.x)) continue;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
    }
    if (!isFinite(minX)) return null;

    const pad = bgNode ? 0 : 4;
    const x = Math.max(0, minX - pad);
    const y = Math.max(0, minY - pad);
    const w = Math.min(stage.width(), maxX + pad) - x;
    const h = Math.min(stage.height(), maxY + pad) - y;
    if (w <= 0 || h <= 0) return null;
    return { x, y, w, h };
}

doneBtn.addEventListener('click', () => {
    const box = getContentBox();
    if (!box) { alert('Сначала что-нибудь нарисуйте.'); return; }

    clearSelection();

    const dataURL = stage.toDataURL({
        x: box.x, y: box.y, width: box.w, height: box.h,
        pixelRatio: 2, mimeType: 'image/png',
    });

    const editInfo = (bgNode && bgSource)
        ? {
            bgX: bgNode.x(), bgY: bgNode.y(),
            s: bgNode.width() / bgSource.width,
            origW: bgSource.width, origH: bgSource.height,
        }
        : null;

    if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
            { type: 'tshirt:drawing', dataURL, crop: box, editInfo },
            '*'
        );
    }
    window.close();
});

/* --------------------------------------------------- edit-mode handshake --- */

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load image'));
        img.src = src;
    });
}

async function loadEditBase(dataURL, width, height) {
    const img = await loadImage(dataURL);

    bgSource = {
        width: Math.max(1, width || img.naturalWidth),
        height: Math.max(1, height || img.naturalHeight),
    };

    if (bgNode) bgNode.destroy();

    bgNode = new Konva.Image({ image: img, listening: false, x: 0, y: 0 });
    linesLayer.add(bgNode);
    bgNode.moveToBottom();
    transformer.moveToTop();

    placeBackground();
    document.title = 'Редактирование рисунка';
}

window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin && event.origin !== 'null') return;
    const data = event.data;
    if (data && data.type === 'tshirt:edit') {
        loadEditBase(data.dataURL, data.width, data.height).catch(() => {});
    }
});

if (window.opener && !window.opener.closed) {
    window.opener.postMessage({ type: 'tshirt:ready' }, '*');
}

/* ---------------------------------------------------------- keyboard ------ */

window.addEventListener('keydown', (e) => {
    if (document.querySelector('.help-modal')) return;   // let the dialog handle its own keys

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode && document.activeElement === document.body) {
        e.preventDefault();
        deleteSelected();
    }
});

/* ---------------------------------------------------- checker background --- */

checkerBtn.classList.toggle('active', !containerEl.classList.contains('checker-off'));

checkerBtn.addEventListener('click', () => {
    const isOff = containerEl.classList.toggle('checker-off');
    checkerBtn.classList.toggle('active', !isOff);
});

/* --------------------------------------------------------------- init ----- */

resize();
setTool('brush');
updateHistoryButtons();