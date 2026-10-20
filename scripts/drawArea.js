/**
 * drawArea.js
 *
 * Masking model
 * -------------
 * A mask + its masked child live in a `Konva.Group` that is *cached* so that
 * `source-atop` composites against the mask only — it does not see the t-shirt
 * or other objects below. Cache quality is adaptive to zoom (so zooming in
 * stays crisp) and re-caches when the zoom settles.
 *
 * Double-click (or the toolbar button / Enter) enters *edit mode*: the group
 * is temporarily uncached, only the group's children are draggable, and every
 * other object is dimmed. Exit by clicking outside, pressing Escape, or clicking
 * the group's background. On exit the group is re-cached.
 */

let stage = null;
let contentLayer = null;
let viewportGroup = null;
let transformer = null;

const maskGroups = new Map();          // maskedNode -> group

let pendingMaskNode = null;
let editingMaskGroup = null;
let currentTool = 'select';
let isPanning = false;
let panStart = null;
let touchState = null;

let onStatus = () => {};
let onSelectionChange = () => {};

let nextNodeId = 1;
let importCascade = 0;

const viewport = { x: 0, y: 0, scale: 1 };
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

const SHIRT_PATH =
    'M 70 15 L 100 32 L 130 15 L 180 50 L 150 85 L 135 70 ' +
    'L 135 185 Q 100 196 65 185 L 65 70 L 50 85 L 20 50 Z';

const SAVED_ATTRS = [
    'id', 'x', 'y', 'width', 'height',
    'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'offsetX', 'offsetY',
    'draggable', 'name', 'opacity', 'visible', 'listening',
    'fill', 'stroke', 'strokeWidth', 'lineJoin', 'lineCap',
    'dash', 'dashOffset', 'tension', 'points', 'data',
    'radius', 'radiusX', 'radiusY', 'closed', 'cornerRadius',
    'text', 'fontSize', 'fontFamily', 'fontStyle', 'align',
    'globalCompositeOperation',
];

/* ------------------------------------------------------------------ init -- */

export function initDrawArea({
    container = '.drawArea',
    onStatus: statusCb,
    onSelectionChange: selectionCb,
} = {}) {
    if (statusCb) onStatus = statusCb;
    if (selectionCb) onSelectionChange = selectionCb;

    stage = new Konva.Stage({
        container,
        width: window.innerWidth,
        height: window.innerHeight,
    });

    contentLayer = new Konva.Layer();
    stage.add(contentLayer);

    viewportGroup = new Konva.Group();
    contentLayer.add(viewportGroup);

    transformer = new Konva.Transformer({
        rotateEnabled: true,
        borderStroke: '#4a90e2',
        anchorStroke: '#4a90e2',
        anchorFill: '#ffffff',
        anchorSize: 10,
        ignoreStroke: true,
        boundBoxFunc: (oldBox, newBox) =>
            newBox.width < 8 || newBox.height < 8 ? oldBox : newBox,
    });
    contentLayer.add(transformer);
    transformer.moveToTop();

    transformer.on('transformend', () => {
        transformer.nodes().forEach((node) => {
            refreshImageCache(node);
            const group = node.getAttr && node.getAttr('_isMaskGroup')
                ? node
                : getMaskGroupOf(node);
            if (group && !group.getAttr('_editingMask')) cacheMaskGroup(group);
        });
    });

    stage.on('click tap', onStageClick);
    stage.on('dblclick dbltap', onStageDblClick);
    installViewportEvents();

    window.addEventListener('resize', () => {
        stage.size({ width: window.innerWidth, height: window.innerHeight });
        if (transformer.nodes().length) transformer.forceUpdate();
    });

    return stage;
}

export function getStage() { return stage; }
export function getSelectedNode() { return transformer.nodes()[0] || null; }
export function getSelectedImageNode() {
    const node = getSelectedNode();
    return node instanceof Konva.Image ? node : null;
}

function notifySelection() { onSelectionChange(getSelectedNode()); }

/* ------------------------------------------------------------ tool state -- */

export function setMainTool(tool) {
    currentTool = tool;

    viewportGroup.getChildren().forEach((n) => {
        if (n.getAttr && n.getAttr('_isMaskGroup')) {
            // The group is the draggable unit unless we're editing its content.
            n.draggable(tool === 'select' && n !== editingMaskGroup);
        } else {
            n.draggable(tool === 'select');
        }
    });

    stage.container().style.cursor = tool === 'pan' ? 'grab' : 'default';
    if (tool === 'pan') select(null);
}

/* ------------------------------------------------------- viewport ------- */

let lastCachedScale = -1;
let recacheTimer = null;

function applyViewport() {
    viewportGroup.position({ x: viewport.x, y: viewport.y });
    viewportGroup.scale({ x: viewport.scale, y: viewport.scale });
    if (transformer.nodes().length) {
        try { transformer.forceUpdate(); } catch { /* older Konva */ }
    }
    contentLayer.batchDraw();

    // Re-cache mask groups when zoom changes enough to matter for quality.
    if (lastCachedScale > 0 &&
        Math.abs(viewport.scale - lastCachedScale) / viewport.scale > 0.15) {
        scheduleRecacheGroups();
    }
}

function clampScale(s) { return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)); }

export function zoomAt(screenPoint, newScale) {
    newScale = clampScale(newScale);
    const world = {
        x: (screenPoint.x - viewport.x) / viewport.scale,
        y: (screenPoint.y - viewport.y) / viewport.scale,
    };
    viewport.scale = newScale;
    viewport.x = screenPoint.x - world.x * newScale;
    viewport.y = screenPoint.y - world.y * newScale;
    applyViewport();
}

export function panBy(dx, dy) { viewport.x += dx; viewport.y += dy; applyViewport(); }
export function zoomIn()  { zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, viewport.scale * 1.2); }
export function zoomOut() { zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, viewport.scale / 1.2); }

export function resetView() {
    viewport.x = 0; viewport.y = 0; viewport.scale = 1;
    applyViewport();
    scheduleRecacheGroups();
}

export function fitView() {
    const children = viewportGroup.getChildren().filter((n) => n.visible());
    if (!children.length) { resetView(); return; }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of children) {
        const r = n.getClientRect({ relativeTo: viewportGroup });
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
    }
    if (!isFinite(minX)) { resetView(); return; }

    const pad = 50;
    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxY - minY);
    const s = clampScale(Math.min(
        (stage.width() - pad * 2) / worldW,
        (stage.height() - pad * 2) / worldH
    ));

    viewport.scale = s;
    viewport.x = stage.width() / 2 - (minX + worldW / 2) * s;
    viewport.y = stage.height() / 2 - (minY + worldH / 2) * s;
    applyViewport();
    scheduleRecacheGroups();
}

function installViewportEvents() {
    stage.on('wheel', (e) => {
        e.evt.preventDefault();
        if (e.evt.ctrlKey || e.evt.metaKey) {
            const p = stage.getPointerPosition();
            if (!p) return;
            const factor = e.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
            zoomAt(p, viewport.scale * factor);
        } else {
            panBy(-e.evt.deltaX, -e.evt.deltaY);
        }
    });

    stage.on('mousedown touchstart', (e) => {
        if (currentTool !== 'pan') return;
        const p = getEventPointer(e);
        if (!p) return;
        isPanning = true;
        panStart = { x: p.x, y: p.y, vx: viewport.x, vy: viewport.y };
        stage.container().style.cursor = 'grabbing';
        e.evt.preventDefault();
    });

    stage.on('mousemove touchmove', (e) => {
        if (isPanning && panStart) {
            const p = getEventPointer(e);
            if (!p) return;
            viewport.x = panStart.vx + (p.x - panStart.x);
            viewport.y = panStart.vy + (p.y - panStart.y);
            applyViewport();
            return;
        }

        const touches = e.evt.touches;
        if (touches && touches.length === 2) {
            e.evt.preventDefault();
            const dist = touchDist(touches[0], touches[1]);
            const center = touchCenter(touches[0], touches[1]);

            if (touchState) {
                if (touchState.dist > 0) {
                    const factor = dist / touchState.dist;
                    const stageRect = stage.container().getBoundingClientRect();
                    zoomAt(
                        { x: center.x - stageRect.left, y: center.y - stageRect.top },
                        viewport.scale * factor
                    );
                }
                panBy(center.x - touchState.center.x, center.y - touchState.center.y);
            }
            touchState = { dist, center };
        }
    });

    stage.on('mouseup touchend mouseleave touchcancel', () => {
        if (isPanning) {
            isPanning = false; panStart = null;
            stage.container().style.cursor = currentTool === 'pan' ? 'grab' : 'default';
        }
        touchState = null;
    });
}

function getEventPointer(e) {
    const evt = e.evt;
    if (evt.touches && evt.touches.length)
        return { x: evt.touches[0].clientX, y: evt.touches[0].clientY };
    if (evt.changedTouches && evt.changedTouches.length)
        return { x: evt.changedTouches[0].clientX, y: evt.changedTouches[0].clientY };
    if (typeof evt.clientX === 'number')
        return { x: evt.clientX, y: evt.clientY };
    return null;
}
function touchDist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
function touchCenter(a, b) {
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
}

/* --------------------------------------------------- node registration --- */

function registerNode(node, forcedId = null) {
    if (forcedId) {
        node.id(forcedId);
        const m = /^node_(\d+)$/.exec(forcedId);
        if (m) nextNodeId = Math.max(nextNodeId, Number(m[1]) + 1);
    } else if (!node.id()) {
        node.id('node_' + (nextNodeId++));
    }
    return node;
}

/* ------------------------------------------------------------ demo shirt -- */

export function addDemoShirt() {
    const scale = 1.6;
    const worldCenter = {
        x: (stage.width() / 2 - viewport.x) / viewport.scale,
        y: (stage.height() / 2 - viewport.y) / viewport.scale,
    };

    const shirt = new Konva.Path({
        data: SHIRT_PATH,
        fill: '#ffffff',
        stroke: '#c9ced8',
        strokeWidth: 2,
        lineJoin: 'round',
        draggable: currentTool === 'select',
        name: 'shirt',
        x: worldCenter.x - 100 * scale,
        y: worldCenter.y - 100 * scale,
        scaleX: scale,
        scaleY: scale,
    });

    viewportGroup.add(shirt);
    registerNode(shirt);
    contentLayer.batchDraw();
    return shirt;
}

/* ------------------------------------------------------------- selection -- */

function topLevelNodeOf(node) {
    let current = node;
    while (current && current.getParent() && current.getParent() !== viewportGroup) {
        current = current.getParent();
    }
    if (!current || current.getParent() !== viewportGroup) return null;
    if (current === transformer) return null;
    return current;
}

function isTransformerTarget(node) {
    let current = node;
    while (current) {
        if (current === transformer) return true;
        current = current.getParent();
    }
    return false;
}

export function select(node) {
    if (node) {
        transformer.nodes([node]);
        transformer.moveToTop();
    } else {
        transformer.nodes([]);
    }
    notifySelection();
    contentLayer.batchDraw();
}

function onStageClick(e) {
    if (isTransformerTarget(e.target)) return;

    // Edit mode: clicks inside the group select children; clicks outside exit.
    if (editingMaskGroup) {
        const topLevel = topLevelNodeOf(e.target);
        if (!topLevel || topLevel !== editingMaskGroup) {
            exitMaskEditMode();
            if (topLevel) select(topLevel);
            else select(null);
            return;
        }
        if (e.target !== editingMaskGroup) {
            transformer.nodes([e.target]);
            transformer.moveToTop();
            contentLayer.batchDraw();
        }
        return;
    }

    if (currentTool === 'pan') return;

    const clicked = topLevelNodeOf(e.target);

    if (pendingMaskNode) {
        if (!clicked || clicked === pendingMaskNode) { cancelMaskPick(); return; }
        const masked = pendingMaskNode;
        pendingMaskNode = null;
        setMaskCursor(false);
        onStatus('');
        applyMask(masked, clicked);
        return;
    }

    if (clicked) select(clicked);
    else if (e.target === stage || e.target === viewportGroup) select(null);
}

function onStageDblClick(e) {
    if (isTransformerTarget(e.target)) return;
    if (editingMaskGroup) return;
    if (currentTool === 'pan') return;

    const node = topLevelNodeOf(e.target);
    if (node && node.getAttr && node.getAttr('_isMaskGroup')) {
        enterMaskEditMode(node);
    }
}

/* ------------------------------------------------------------- masking ---- */

function setComposite(node, op) {
    if (node instanceof Konva.Group) {
        node.getChildren().forEach((child) => setComposite(child, op));
    } else {
        node.globalCompositeOperation(op);
    }
}

function getMaskGroupOf(node) {
    let current = node;
    while (current) {
        if (current.getAttr && current.getAttr('_isMaskGroup')) return current;
        current = current.getParent();
    }
    return null;
}

export function applyMask(maskedNode, maskNode, options = {}) {
    if (!maskedNode || !maskNode || maskedNode === maskNode) return false;
    const { reselect = true } = options;

    if (getMaskGroupOf(maskedNode) || getMaskGroupOf(maskNode)) return false;

    const maskZ = maskNode.zIndex();
    const maskedZ = maskedNode.zIndex();
    const targetZ = Math.min(maskZ, maskedZ);

    const box = maskNode.getClientRect({ relativeTo: viewportGroup });
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const maskPos = maskNode.position();
    const maskedPos = maskedNode.position();

    maskNode.remove();
    maskedNode.remove();

    const group = new Konva.Group({
        x: cx, y: cy,
        draggable: currentTool === 'select',
    });
    group.setAttr('_isMaskGroup', true);
    registerNode(group);

    maskNode.position({ x: maskPos.x - cx, y: maskPos.y - cy });
    maskedNode.position({ x: maskedPos.x - cx, y: maskedPos.y - cy });
    maskNode.draggable(false);
    maskedNode.draggable(false);

    group.add(maskNode);
    group.add(maskedNode);
    setComposite(maskedNode, 'source-atop');

    viewportGroup.add(group);
    const maxIdx = viewportGroup.getChildren().length - 1;
    group.zIndex(Math.max(0, Math.min(targetZ, maxIdx)));

    maskGroups.set(maskedNode, group);
    cacheMaskGroup(group);

    transformer.moveToTop();
    if (reselect) select(group);
    contentLayer.batchDraw();
    return true;
}

/**
 * Pixel ratio that keeps the cached bitmap crisp at the current zoom level.
 * Bounded so memory stays sane on large groups.
 */
function getEffectiveCachePixelRatio(group = null) {
    const dpr = window.devicePixelRatio || 1;
    const zoom = Math.max(1, viewport.scale);
    let groupScale = 1;
    if (group) {
        groupScale = Math.max(1, Math.abs(group.scaleX()), Math.abs(group.scaleY()));
    }
    return Math.min(4, Math.max(2, zoom * dpr * groupScale));
}

function scheduleRecacheGroups() {
    clearTimeout(recacheTimer);
    recacheTimer = setTimeout(() => {
        lastCachedScale = viewport.scale;
        viewportGroup.getChildren().forEach((n) => {
            if (n.getAttr && n.getAttr('_isMaskGroup') && !n.getAttr('_editingMask')) {
                cacheMaskGroup(n);
            }
        });
        contentLayer.batchDraw();
    }, 200);
}

function cacheMaskGroup(group, forcedPixelRatio = null) {
    if (!group || !group.getStage()) return;
    if (group.getAttr('_editingMask')) return;

    const children = group.getChildren();
    if (!children.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of children) {
        const r = child.getClientRect({ relativeTo: group });
        if (!r || !isFinite(r.width) || !isFinite(r.height)) continue;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
    }
    if (!isFinite(minX) || maxX <= minX || maxY <= minY) return;

    const pixelRatio = (forcedPixelRatio != null)
        ? forcedPixelRatio
        : getEffectiveCachePixelRatio(group);

    group.clearCache();
    try {
        group.cache({
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            pixelRatio,
        });
        if (forcedPixelRatio == null) lastCachedScale = viewport.scale;
    } catch (err) {
        console.warn('Could not cache mask group:', err);
    }
}

function flattenMaskGroup(group) {
    if (!group || !group.getAttr('_isMaskGroup')) return false;
    if (group === editingMaskGroup) exitMaskEditMode();

    const children = group.getChildren().slice();
    const groupZ = group.zIndex();
    const worldToLocal = viewportGroup.getAbsoluteTransform().copy().invert();

    children.forEach((child, i) => {
        const abs = child.getAbsoluteTransform();
        const m = abs.getMatrix();
        const worldX = m[4], worldY = m[5];
        const scaleX = Math.sqrt(m[0] * m[0] + m[1] * m[1]) || 1;
        const scaleY = Math.sqrt(m[2] * m[2] + m[3] * m[3]) || 1;
        const rotation = Math.atan2(m[1], m[0]) * 180 / Math.PI;
        const localPos = worldToLocal.point({ x: worldX, y: worldY });

        child.remove();
        viewportGroup.add(child);
        child.position(localPos);
        child.scaleX(scaleX);
        child.scaleY(scaleY);
        child.rotation(rotation);
        child.draggable(currentTool === 'select');
        setComposite(child, 'source-over');
        registerNode(child);
        child.zIndex(Math.min(groupZ + i, viewportGroup.getChildren().length - 1));
    });

    for (const [masked, g] of Array.from(maskGroups)) {
        if (g === group) maskGroups.delete(masked);
    }

    group.destroy();
    return true;
}

export function clearMask(node) {
    if (!node) return false;
    if (node.getAttr && node.getAttr('_isMaskGroup')) return flattenMaskGroup(node);
    const group = getMaskGroupOf(node);
    if (group) return flattenMaskGroup(group);
    return false;
}

export function clearMaskOfSelected() {
    const node = getSelectedNode();
    return node ? clearMask(node) : false;
}

/* ------------------------------------------- mask content edit mode ----- */

export function isEditingMask() { return editingMaskGroup !== null; }

export function enterMaskEditMode(group) {
    if (!group || !group.getAttr || !group.getAttr('_isMaskGroup')) return false;
    if (editingMaskGroup === group) return true;
    if (editingMaskGroup) exitMaskEditMode();

    editingMaskGroup = group;
    group.setAttr('_editingMask', true);
    group.clearCache();
    group.draggable(false);

    const children = group.getChildren();
    children.forEach((c) => {
        c.draggable(true);
        c.listening(true);
    });

    // Dim other objects so the composite "leak" during editing is faint.
    viewportGroup.getChildren().forEach((n) => {
        if (n === group) return;
        n._editModeSavedOpacity = n.opacity();
        n.opacity(Math.min(n.opacity(), 0.15));
    });

    const target = children[1] || children[0];
    if (target) {
        transformer.nodes([target]);
        transformer.moveToTop();
    }

    onStatus('Режим редактирования маски: перетащите содержимое. Esc или клик вне группы — выйти.');
    contentLayer.batchDraw();
    return true;
}

export function exitMaskEditMode() {
    if (!editingMaskGroup) return false;

    const group = editingMaskGroup;
    editingMaskGroup = null;
    group.setAttr('_editingMask', false);

    viewportGroup.getChildren().forEach((n) => {
        if (n._editModeSavedOpacity !== undefined) {
            n.opacity(n._editModeSavedOpacity);
            delete n._editModeSavedOpacity;
        }
    });

    group.getChildren().forEach((c) => c.draggable(false));
    if (group.getChildren().length >= 2) {
        setComposite(group.getChildren()[1], 'source-atop');
    }
    group.draggable(currentTool === 'select');

    cacheMaskGroup(group);

    transformer.nodes([group]);
    transformer.moveToTop();

    onStatus('');
    contentLayer.batchDraw();
    return true;
}

/* ---------------------------------------------------------- layer order --- */

function moveSelected(delta, absolute) {
    const node = getSelectedNode();
    if (!node) return;
    // While editing mask content, the selection is a child — no layer moves.
    if (editingMaskGroup) return;

    const parent = node.getParent();
    if (!parent) return;
    const total = parent.getChildren().length;
    if (total <= 1) return;

    let newIdx;
    if (absolute === 'top')         newIdx = total - 1;
    else if (absolute === 'bottom') newIdx = 0;
    else newIdx = Math.max(0, Math.min(total - 1, node.zIndex() + delta));

    if (newIdx !== node.zIndex()) {
        node.zIndex(newIdx);
        contentLayer.batchDraw();
        notifySelection();
    }
}

export function moveSelectedToTop()    { moveSelected(0, 'top'); }
export function moveSelectedUp()       { moveSelected(1, false); }
export function moveSelectedDown()     { moveSelected(-1, false); }
export function moveSelectedToBottom() { moveSelected(0, 'bottom'); }

/* --------------------------------------------------------------- objects -- */

export function deleteSelected() {
    if (editingMaskGroup) exitMaskEditMode();
    const node = getSelectedNode();
    if (!node) return;
    removeNode(node);
    transformer.nodes([]);
    notifySelection();
    contentLayer.batchDraw();
}

export function removeNode(node) {
    if (editingMaskGroup) {
        const group = getMaskGroupOf(node) ||
            (node.getAttr && node.getAttr('_isMaskGroup') ? node : null);
        if (group === editingMaskGroup) exitMaskEditMode();
    }

    if (node.getAttr && node.getAttr('_isMaskGroup')) {
        for (const [masked, g] of Array.from(maskGroups)) {
            if (g === node) maskGroups.delete(masked);
        }
        node.destroy();
        return;
    }

    const group = getMaskGroupOf(node);
    if (group) {
        for (const [masked, g] of Array.from(maskGroups)) {
            if (g === group) maskGroups.delete(masked);
        }
        group.destroy();
        return;
    }

    node.destroy();
}

export function startMaskPick() {
    const node = getSelectedNode();
    if (!node) { onStatus('Сначала выберите объект, который нужно замаскировать.'); return false; }
    if (node.getAttr && node.getAttr('_isMaskGroup')) {
        onStatus('Нельзя применить маску к группе с маской.');
        return false;
    }
    if (getMaskGroupOf(node)) {
        onStatus('Объект уже имеет маску.');
        return false;
    }
    pendingMaskNode = node;
    setMaskCursor(true);
    onStatus('Теперь нажмите на фигуру, которая будет маской (Esc — отмена).');
    return true;
}

export function cancelMaskPick() {
    if (!pendingMaskNode) return;
    pendingMaskNode = null;
    setMaskCursor(false);
    onStatus('');
}

function setMaskCursor(on) {
    stage.container().style.cursor = on ? 'crosshair' : 'default';
}

/* ---------------------------------------------------------------- images -- */

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load image'));
        img.src = src;
    });
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function visualCenterWorld() {
    return {
        x: (stage.width() / 2 - viewport.x) / viewport.scale,
        y: (stage.height() / 2 - viewport.y) / viewport.scale,
    };
}

function maxVisibleWorld() {
    return Math.min(stage.width(), stage.height()) * 0.5 / viewport.scale;
}

export async function importImageFiles(files) {
    const list = Array.from(files || []).filter((f) => f && f.type.startsWith('image/'));
    const nodes = [];
    for (const file of list) {
        try { nodes.push(await createImageNodeFromFile(file)); }
        catch (err) { console.warn('Import failed:', file.name, err); }
    }
    if (nodes.length) {
        select(nodes[nodes.length - 1]);
        contentLayer.batchDraw();
    }
    return nodes;
}

async function createImageNodeFromFile(file) {
    const dataURL = await fileToDataURL(file);
    const img = await loadImage(dataURL);
    const nw = img.naturalWidth || img.width || 1;
    const nh = img.naturalHeight || img.height || 1;
    const maxDim = maxVisibleWorld();
    const scale = Math.min(1, maxDim / Math.max(nw, nh));
    const w = Math.max(1, nw * scale);
    const h = Math.max(1, nh * scale);
    const c = visualCenterWorld();
    const jitter = (importCascade++ % 6) * 14;

    const node = new Konva.Image({
        image: img, width: w, height: h,
        x: c.x - w / 2 + jitter, y: c.y - h / 2 + jitter,
        draggable: currentTool === 'select',
        name: 'image',
    });
    node.setAttr('source', { kind: 'image', name: file.name, originalDataURL: dataURL });

    viewportGroup.add(node);
    registerNode(node);
    transformer.moveToTop();
    return node;
}

export async function replaceSelectedImage(file) {
    const node = getSelectedImageNode();
    if (!node || !file) return false;
    const dataURL = await fileToDataURL(file);
    const img = await loadImage(dataURL);
    swapNodeImage(node, img);
    node.setAttr('source', { kind: 'image', name: file.name, originalDataURL: dataURL });
    contentLayer.batchDraw();
    return true;
}

function swapNodeImage(node, img) {
    const sx = node.scaleX(), sy = node.scaleY();
    const boxW = Math.max(1, node.width() * Math.abs(sx));
    const boxH = Math.max(1, node.height() * Math.abs(sy));
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const fit = Math.min(boxW / iw, boxH / ih);
    const dispW = Math.max(1, iw * fit);
    const dispH = Math.max(1, ih * fit);

    const oldCenter = node.getAbsoluteTransform().point({ x: node.width() / 2, y: node.height() / 2 });
    node.image(img);
    node.offset({ x: 0, y: 0 });
    node.width(dispW / Math.abs(sx || 1));
    node.height(dispH / Math.abs(sy || 1));
    const newCenter = node.getAbsoluteTransform().point({ x: node.width() / 2, y: node.height() / 2 });
    shiftNodeByAbsoluteDelta(node, oldCenter.x - newCenter.x, oldCenter.y - newCenter.y);
    refreshImageCache(node);
}

export async function setNodeImageInPlace(node, dataURL) {
    if (!(node instanceof Konva.Image)) return false;
    const img = await loadImage(dataURL);
    node.image(img);
    refreshImageCache(node);
    contentLayer.batchDraw();
    return true;
}

/* ------------------------------------------------------------- drawings --- */

export async function addDrawingFromDataURL(dataURL, width, height) {
    const img = await loadImage(dataURL);
    const maxDim = maxVisibleWorld() * 1.2;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const w = Math.max(1, width * scale);
    const h = Math.max(1, height * scale);
    const c = visualCenterWorld();

    const node = new Konva.Image({
        image: img, width: w, height: h,
        x: c.x - w / 2, y: c.y - h / 2,
        draggable: currentTool === 'select',
        name: 'drawing',
    });
    node.setAttr('source', { kind: 'drawing', width, height });

    viewportGroup.add(node);
    registerNode(node);
    select(node);
    contentLayer.batchDraw();
    return node;
}

export async function updateDrawingNode(node, dataURL, crop, editInfo) {
    if (!node || !node.getStage()) return null;
    const source = node.getAttr('source');
    if (!source || source.kind !== 'drawing') return null;

    const img = await loadImage(dataURL);
    const origW = editInfo.origW || source.width || 1;
    const origH = editInfo.origH || source.height || 1;
    const s = editInfo.s || 1;
    const kx = node.width() / origW;
    const ky = node.height() / origH;
    const ox = (crop.x - editInfo.bgX) / s;
    const oy = (crop.y - editInfo.bgY) / s;
    const ow = crop.w / s;
    const oh = crop.h / s;

    const targetAbs = node.getAbsoluteTransform().point({ x: ox * kx, y: oy * ky });
    node.image(img);
    node.width(Math.max(1, ow * kx));
    node.height(Math.max(1, oh * ky));
    const originAbs = node.getAbsoluteTransform().point({ x: 0, y: 0 });
    shiftNodeByAbsoluteDelta(node, targetAbs.x - originAbs.x, targetAbs.y - originAbs.y);
    node.setAttr('source', { kind: 'drawing', width: ow, height: oh });
    refreshImageCache(node);
    contentLayer.batchDraw();
    return node;
}

function shiftNodeByAbsoluteDelta(node, dx, dy) {
    if (!dx && !dy) return;
    const parent = node.getParent();
    const inv = parent ? parent.getAbsoluteTransform().copy().invert() : null;
    if (inv) {
        const a = inv.point({ x: 0, y: 0 });
        const b = inv.point({ x: dx, y: dy });
        node.position({ x: node.x() + (b.x - a.x), y: node.y() + (b.y - a.y) });
    } else {
        node.position({ x: node.x() + dx, y: node.y() + dy });
    }
}

/* ----------------------------------------------------- image adjustments -- */

export function applyImageAdjustments(node, adjust) {
    if (!(node instanceof Konva.Image)) return;
    node.setAttr('adjust', adjust);
    const filters = [];
    if (adjust.brightness) filters.push(Konva.Filters.Brightness);
    if (adjust.contrast) filters.push(Konva.Filters.Contrast);
    if (adjust.grayscale) filters.push(Konva.Filters.Grayscale);
    node.filters(filters);
    node.brightness(adjust.brightness || 0);
    node.contrast(adjust.contrast || 0);
    refreshImageCache(node);
}

function refreshImageCache(node) {
    if (!(node instanceof Konva.Image) || !contentLayer) return;
    if (!node.width() || !node.height()) return;

    const hasFilters = Array.isArray(node.filters()) && node.filters().length > 0;
    node.clearCache();
    if (hasFilters) {
        try {
            node.cache({ pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
        } catch (err) {
            console.warn('Could not cache image for filters', err);
        }
    }

    const group = getMaskGroupOf(node);
    if (group && !group.getAttr('_editingMask')) cacheMaskGroup(group);

    contentLayer.batchDraw();
}

/* ---------------------------------------------------------- serialize ----- */

function extractAttrs(node) {
    const attrs = {};
    SAVED_ATTRS.forEach((key) => {
        const val = node.getAttr(key);
        if (val === undefined || val === null) return;
        const t = typeof val;
        if (t === 'string' || t === 'number' || t === 'boolean') attrs[key] = val;
        else if (Array.isArray(val) && val.every((v) => typeof v !== 'object')) attrs[key] = val.slice();
    });
    return attrs;
}

function serializeNodeForSave(node) {
    if (node.getAttr && node.getAttr('_isMaskGroup')) {
        return {
            type: 'MaskGroup',
            attrs: extractAttrs(node),
            children: node.getChildren().map(serializeNodeForSave),
        };
    }

    const entry = { type: node.getClassName(), attrs: extractAttrs(node) };
    if (node instanceof Konva.Image && node.image() && node.image().src) {
        entry.imageSrc = node.image().src;
    }
    const source = node.getAttr('source');
    if (source) entry.source = source;
    const adjust = node.getAttr('adjust');
    if (adjust) entry.adjust = adjust;
    return entry;
}

export function serializeDesign() {
    return {
        schema: 'tshirt-design',
        version: 2,
        createdAt: new Date().toISOString(),
        stage: { width: stage.width(), height: stage.height() },
        viewport: { x: viewport.x, y: viewport.y, scale: viewport.scale },
        nodes: viewportGroup.getChildren().map(serializeNodeForSave),
    };
}

async function createNodeFromSave(entry) {
    if (entry.type === 'MaskGroup') {
        const group = new Konva.Group({ ...(entry.attrs || {}) });
        group.setAttr('_isMaskGroup', true);
        group.draggable(currentTool === 'select');

        for (const childEntry of entry.children || []) {
            const child = await createNodeFromSave(childEntry);
            if (child) {
                child.draggable(false);
                group.add(child);
            }
        }

        const children = group.getChildren();
        if (children.length >= 2) setComposite(children[1], 'source-atop');
        registerNode(group);
        return group;
    }

    const attrs = { ...(entry.attrs || {}) };
    let node = null;
    try {
        if (entry.type === 'Image') {
            if (!entry.imageSrc) return null;
            attrs.image = await loadImage(entry.imageSrc);
            node = new Konva.Image(attrs);
        } else if (entry.type === 'Path')   node = new Konva.Path(attrs);
        else if (entry.type === 'Rect')     node = new Konva.Rect(attrs);
        else if (entry.type === 'Line')     node = new Konva.Line(attrs);
        else if (entry.type === 'Arrow')    node = new Konva.Arrow(attrs);
        else if (entry.type === 'Circle')   node = new Konva.Circle(attrs);
        else if (entry.type === 'Ellipse')  node = new Konva.Ellipse(attrs);
        else if (entry.type === 'Text')     node = new Konva.Text(attrs);
        else return null;
    } catch (err) {
        console.warn('Could not create node', entry, err);
        return null;
    }

    if (entry.source) node.setAttr('source', entry.source);
    if (entry.adjust) node.setAttr('adjust', entry.adjust);
    node.draggable(currentTool === 'select');
    registerNode(node, entry.attrs && entry.attrs.id);
    return node;
}

export async function loadDesign(data) {
    if (!data || !Array.isArray(data.nodes)) throw new Error('Invalid design data');

    if (editingMaskGroup) exitMaskEditMode();

    viewportGroup.getChildren().slice().forEach((n) => n.destroy());
    maskGroups.clear();
    transformer.nodes([]);
    importCascade = 0;

    for (const entry of data.nodes) {
        const node = await createNodeFromSave(entry);
        if (node) viewportGroup.add(node);
    }

    viewportGroup.getChildren().forEach((n) => {
        if (n.getAttr && n.getAttr('_isMaskGroup')) cacheMaskGroup(n);
        if (n instanceof Konva.Image && n.getAttr('adjust')) {
            applyImageAdjustments(n, n.getAttr('adjust'));
        }
    });

    if (data.viewport) {
        viewport.x = Number(data.viewport.x) || 0;
        viewport.y = Number(data.viewport.y) || 0;
        viewport.scale = clampScale(Number(data.viewport.scale) || 1);
    } else {
        viewport.x = 0; viewport.y = 0; viewport.scale = 1;
    }

    applyViewport();
    transformer.moveToTop();
    notifySelection();
}

/* --------------------------------------------------------- PNG export ----- */

/**
 * Render the whole design to a PNG data URL.
 *
 * Temporarily resets pan/zoom (so output resolution is independent of the
 * user's current view), hides the transformer, re-caches mask groups at a
 * resolution that stays crisp on the output, captures the bounding box of
 * every visible top-level object, and then restores the previous state.
 *
 * Returns `null` if the canvas is empty.
 */
export async function exportDesignToPNG({
    pixelRatio = 2,
    padding = 20,
    maxDimension = 4096,
} = {}) {
    if (editingMaskGroup) exitMaskEditMode();

    const children = viewportGroup.getChildren().filter((n) => n.visible());
    if (!children.length) return null;

    // Bounding box of everything visible, in viewportGroup-local coords.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of children) {
        const r = n.getClientRect({ relativeTo: viewportGroup });
        if (!r || !isFinite(r.x) || !isFinite(r.width)) continue;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
    }
    if (!isFinite(minX) || maxX <= minX || maxY <= minY) return null;

    const width  = Math.ceil(maxX - minX + padding * 2);
    const height = Math.ceil(maxY - minY + padding * 2);

    // Cap the effective pixelRatio so the output bitmap stays reasonably sized.
    let pr = Math.max(1, pixelRatio);
    if (width  * pr > maxDimension) pr = Math.min(pr, maxDimension / width);
    if (height * pr > maxDimension) pr = Math.min(pr, maxDimension / height);
    pr = Math.max(0.5, pr);

    const savedViewport = { x: viewport.x, y: viewport.y, scale: viewport.scale };
    const savedNodes = transformer.nodes().slice();
    const savedTransformerVisible = transformer.visible();

    // Pre-cache mask groups at export quality (accounting for their own scale).
    viewportGroup.getChildren().forEach((n) => {
        if (n.getAttr && n.getAttr('_isMaskGroup') && !n.getAttr('_editingMask')) {
            const gs = Math.max(1, Math.abs(n.scaleX()), Math.abs(n.scaleY()));
            const ratio = Math.min(4, Math.max(2, pr * gs));
            cacheMaskGroup(n, ratio);
        }
    });

    try {
        transformer.visible(false);
        transformer.nodes([]);

        // Reset the viewport so the crop is measured directly in world coords.
        viewport.x = 0;
        viewport.y = 0;
        viewport.scale = 1;
        viewportGroup.position({ x: 0, y: 0 });
        viewportGroup.scale({ x: 1, y: 1 });
        contentLayer.draw();

        // Let the browser paint the resized canvas before we capture it.
        await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
        );

        return stage.toDataURL({
            x: minX - padding,
            y: minY - padding,
            width,
            height,
            pixelRatio: pr,
            mimeType: 'image/png',
        });
    } finally {
        viewport.x = savedViewport.x;
        viewport.y = savedViewport.y;
        viewport.scale = savedViewport.scale;
        viewportGroup.position({ x: viewport.x, y: viewport.y });
        viewportGroup.scale({ x: viewport.scale, y: viewport.scale });

        transformer.visible(savedTransformerVisible);
        transformer.nodes(savedNodes);
        contentLayer.batchDraw();

        // Restore caches to the current zoom's quality.
        viewportGroup.getChildren().forEach((n) => {
            if (n.getAttr && n.getAttr('_isMaskGroup') && !n.getAttr('_editingMask')) {
                cacheMaskGroup(n);
            }
        });
        lastCachedScale = viewport.scale;
    }
}