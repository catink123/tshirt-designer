import { hideToolbar, initToolbar, toggleToolbar } from './toolbar.js';
import {
    initDrawArea,
    addDemoShirt,
    addDrawingFromDataURL,
    updateDrawingNode,
    importImageFiles,
    replaceSelectedImage,
    setNodeImageInPlace,
    deleteSelected,
    startMaskPick,
    cancelMaskPick,
    clearMaskOfSelected,
    getSelectedImageNode,
    applyImageAdjustments,
    serializeDesign,
    loadDesign,
    setMainTool,
    zoomIn, zoomOut, resetView, fitView,
    moveSelectedToTop,
    moveSelectedUp,
    moveSelectedDown,
    moveSelectedToBottom,
    enterMaskEditMode,
    exitMaskEditMode,
    isEditingMask,
    exportDesignToPNG,
} from './drawArea.js';
import { initBgRemoval, openBgRemoval } from './bgRemoval.js';
import { showHelpDialog, maybeAutoShowHelp } from './helpDialog.js';

const hintEl = document.querySelector('#hint');

function setStatus(text) {
    if (!hintEl) return;
    hintEl.textContent = text || '';
    hintEl.classList.toggle('hidden', !text);
}

let currentSelection = null;
let currentTool = 'select';

initDrawArea({
    container: '.drawArea',
    onStatus: setStatus,
    onSelectionChange: (node) => {
        currentSelection = node;
        updateToolbarState();
        updateImagePanel();
    },
});

addDemoShirt();

initBgRemoval({
    onApply: async (dataURL) => {
        if (!bgTargetNode) return;
        await setNodeImageInPlace(bgTargetNode, dataURL);
        bgTargetNode = null;
    },
});

/* ------------------------------------------------------------ tool state -- */

document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
        currentTool = btn.dataset.tool;
        setMainTool(currentTool);
        document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => {
            b.classList.toggle('active', b === btn);
        });
    });
});

/* ------------------------------------------------------------- dialogs --- */

function showConfirm({ title, message, confirmLabel = 'Да', cancelLabel = 'Нет' }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        overlay.innerHTML = `
            <div class="dialog-box">
                <h3></h3>
                <p></p>
                <div class="dialog-actions">
                    <button class="dialog-cancel"></button>
                    <button class="dialog-confirm primary"></button>
                </div>
            </div>`;
        overlay.querySelector('h3').textContent = title;
        overlay.querySelector('p').textContent = message;
        overlay.querySelector('.dialog-confirm').textContent = confirmLabel;
        overlay.querySelector('.dialog-cancel').textContent = cancelLabel;
        const close = (answer) => { overlay.remove(); resolve(answer); };
        overlay.querySelector('.dialog-confirm').onclick = () => close(true);
        overlay.querySelector('.dialog-cancel').onclick = () => close(false);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
        document.addEventListener('keydown', function onKey(e) {
            if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false); }
        });
        document.body.appendChild(overlay);
    });
}

/* ------------------------------------------------------------ toolbar ----- */

initToolbar();
hideToolbar();
document.querySelector('#toolbarButton').addEventListener('click', toggleToolbar);

/* --------------------------------------------------------------- help ---- */

const MAIN_HELP = {
    title: 'Дизайнер футболок',
    subtitle: 'Краткое руководство по инструментам и приёмам работы',
    sections: [
        {
            title: 'Инструменты',
            items: [
                { icon: 'fa-arrow-pointer', name: 'Выделение',
                  desc: 'Выбирайте объекты, перемещайте их мышью, меняйте размер и поворот маркерами.' },
                { icon: 'fa-hand', name: 'Перемещение',
                  desc: 'Перетаскивайте холст, чтобы просмотреть другую часть дизайна.' },
                { icon: 'fa-pen-nib', name: 'Новый рисунок',
                  desc: 'Открывает окно рисования. Рисунок добавится на футболку как объект.' },
                { icon: 'fa-image', name: 'Импорт изображения',
                  desc: 'Загружает изображения. Также можно перетащить файлы прямо на холст.' },
                { icon: 'fa-arrows-rotate', name: 'Заменить изображение',
                  desc: 'Меняет картинку выбранного изображения, сохраняя размер и положение.' },
                { icon: 'fa-wand-magic-sparkles', name: 'Удалить фон',
                  desc: 'Открывает редактор для вырезания фона по образцу цвета.' },
                { icon: 'fa-pencil', name: 'Редактировать рисунок',
                  desc: 'Повторно открывает ранее созданный рисунок в окне редактирования.' },
                { icon: 'fa-trash', name: 'Удалить',
                  desc: 'Удаляет выбранный объект или всю группу маски.' },
            ],
        },
        {
            title: 'Слои',
            items: [
                { icon: 'fa-angle-double-up', name: 'На передний план',
                  desc: 'Перемещает объект в самый верх.' },
                { icon: 'fa-angle-up', name: 'Выше',
                  desc: 'Поднимает объект на один слой вверх.' },
                { icon: 'fa-angle-down', name: 'Ниже',
                  desc: 'Опускает объект на один слой вниз.' },
                { icon: 'fa-angle-double-down', name: 'На задний план',
                  desc: 'Перемещает объект в самый низ.' },
            ],
        },
        {
            title: 'Маски',
            items: [
                { icon: 'fa-mask', name: 'Использовать как маску',
                  desc: 'Выберите объект A, нажмите кнопку, затем кликните по объекту B. A будет виден только внутри B.' },
                { icon: 'fa-pen-to-square', name: 'Редактировать содержимое',
                  desc: 'Двойной клик по группе или эта кнопка — можно двигать содержимое внутри маски. Esc или клик вне группы — выйти.' },
                { icon: 'fa-xmark', name: 'Очистить маску',
                  desc: 'Разъединяет маску и содержимое обратно в два независимых объекта.' },
            ],
        },
        {
            title: 'Навигация и масштаб',
            items: [
                { icon: 'fa-plus', name: 'Приблизить',
                  desc: 'Увеличивает масштаб. Ctrl + колесо мыши тоже работает (зум под курсором).' },
                { icon: 'fa-minus', name: 'Отдалить',
                  desc: 'Уменьшает масштаб.' },
                { icon: 'fa-compress', name: 'Сброс масштаба',
                  desc: 'Возвращает масштаб 100% и центрирует холст.' },
                { icon: 'fa-expand', name: 'Показать всё',
                  desc: 'Вписывает все объекты в экран.' },
                { icon: 'fa-hand-pointer', name: 'Тач-жесты',
                  desc: 'Один палец — панорамирование (в режиме «Перемещение»), щипок двумя пальцами — зум.' },
            ],
        },
        {
            title: 'Файлы и настройки',
            items: [
                { icon: 'fa-floppy-disk', name: 'Сохранить',
                  desc: 'Экспортирует дизайн в JSON-файл для последующей загрузки.' },
                { icon: 'fa-folder-open', name: 'Загрузить',
                  desc: 'Загружает ранее сохранённый дизайн (или перетащите JSON прямо в окно).' },
                { icon: 'fa-file-image', name: 'Скачать PNG',
                  desc: 'Сохраняет весь дизайн в PNG с прозрачным фоном. Разрешение не зависит от текущего масштаба.' },
                { icon: 'fa-sun', name: 'Настройки изображения',
                  desc: 'Панель внизу появляется при выборе изображения: яркость, контраст, оттенки серого.' },
            ],
        },
        {
            title: 'Горячие клавиши',
            items: [
                { icon: 'fa-keyboard', name: 'Delete / Backspace', desc: 'Удалить выбранный объект.' },
                { icon: 'fa-keyboard', name: 'Enter',              desc: 'Войти в режим редактирования содержимого маски.' },
                { icon: 'fa-keyboard', name: 'Esc',                desc: 'Отменить выбор маски или выйти из режима редактирования.' },
                { icon: 'fa-keyboard', name: 'Ctrl + 0 / + / −',   desc: 'Сброс масштаба, приближение, отдаление.' },
            ],
        },
    ],
};

document.querySelector('#helpButton').addEventListener('click', () => {
    showHelpDialog(MAIN_HELP);
});

maybeAutoShowHelp({
    storageKey: 'tshirt-help-main-shown-v1',
    ...MAIN_HELP,
});

const toolbarButtons = {};
document.querySelectorAll('.toolbar [data-action]').forEach((btn) => {
    toolbarButtons[btn.dataset.action] = btn;
});

function updateToolbarState() {
    const node = currentSelection;
    const isGroup = !!(node && node.getAttr && node.getAttr('_isMaskGroup'));
    const isImage = node instanceof Konva.Image;
    const source = node && node.getAttr ? node.getAttr('source') : null;

    if (toolbarButtons.delete)     toolbarButtons.delete.disabled = !node;
    if (toolbarButtons.useMask)    toolbarButtons.useMask.disabled = !node || isGroup;
    if (toolbarButtons.clearMask)  toolbarButtons.clearMask.disabled = !node || !isGroup;
    if (toolbarButtons.replaceImage) toolbarButtons.replaceImage.disabled = !isImage;
    if (toolbarButtons.removeBg)   toolbarButtons.removeBg.disabled = !isImage;
    if (toolbarButtons.editDrawing) {
        toolbarButtons.editDrawing.disabled = !(
            isImage && source && source.kind === 'drawing' && node.image()
        );
    }
    if (toolbarButtons.editMaskContent) {
        toolbarButtons.editMaskContent.disabled = !isGroup;
    }

    // Layer ordering
    const parent = node && node.getParent ? node.getParent() : null;
    const children = parent ? parent.getChildren() : [];
    const idx = node ? node.zIndex() : -1;
    const maxIdx = children.length - 1;
    const noLayer = !node;
    const atTop = idx >= maxIdx;
    const atBottom = idx <= 0;

    if (toolbarButtons.moveToTop)    toolbarButtons.moveToTop.disabled = noLayer || atTop;
    if (toolbarButtons.moveUp)       toolbarButtons.moveUp.disabled = noLayer || atTop;
    if (toolbarButtons.moveDown)     toolbarButtons.moveDown.disabled = noLayer || atBottom;
    if (toolbarButtons.moveToBottom) toolbarButtons.moveToBottom.disabled = noLayer || atBottom;
}

document.querySelectorAll('.toolbar [data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
        switch (btn.dataset.action) {
            case 'newDrawing':     openDrawingWindow(null); break;
            case 'importImage':    importInput.click(); break;

            case 'replaceImage':
                if (!getSelectedImageNode()) { setStatus('Сначала выберите изображение.'); return; }
                replaceInput.click();
                break;

            case 'removeBg':       startBgRemovalForSelected(); break;

            case 'editDrawing': {
                const node = currentSelection;
                const source = node && node.getAttr ? node.getAttr('source') : null;
                if (!node || !source || source.kind !== 'drawing' || !node.image()) {
                    setStatus('Сначала выберите рисунок.');
                    return;
                }
                openDrawingWindow(node);
                break;
            }

            case 'editMaskContent': {
                const node = currentSelection;
                if (node && node.getAttr && node.getAttr('_isMaskGroup')) {
                    enterMaskEditMode(node);
                }
                break;
            }

            case 'moveToTop':    moveSelectedToTop(); break;
            case 'moveUp':       moveSelectedUp(); break;
            case 'moveDown':     moveSelectedDown(); break;
            case 'moveToBottom': moveSelectedToBottom(); break;

            case 'delete':       deleteSelected(); setStatus(''); break;
            case 'useMask':      startMaskPick(); break;
            case 'clearMask':    setStatus(clearMaskOfSelected() ? '' : 'У этого объекта нет маски.'); break;
            case 'save':         saveDesignToFile(); break;
            case 'load':         loadInput.click(); break;
            case 'savePng':      saveDesignAsPNG(); break;
        }
    });
});

updateToolbarState();

/* ------------------------------------------------------------- zoom UI --- */

document.querySelector('#zoomIn').addEventListener('click', zoomIn);
document.querySelector('#zoomOut').addEventListener('click', zoomOut);
document.querySelector('#zoomReset').addEventListener('click', resetView);
document.querySelector('#zoomFit').addEventListener('click', fitView);

/* --------------------------------------------------------------- inputs --- */

const importInput = document.querySelector('#imageFileInput');
const replaceInput = document.querySelector('#replaceFileInput');
const loadInput = document.querySelector('#loadFileInput');

importInput.addEventListener('change', async () => {
    const files = Array.from(importInput.files || []);
    importInput.value = '';
    if (!files.length) return;
    setStatus('');
    const nodes = await importImageFiles(files);
    for (const node of nodes) {
        if (await shouldOfferBgRemoval(node)) await askAndEditBackground(node);
    }
});

replaceInput.addEventListener('change', async () => {
    const file = replaceInput.files && replaceInput.files[0];
    replaceInput.value = '';
    if (!file) return;
    if (await replaceSelectedImage(file)) setStatus('');
});

loadInput.addEventListener('change', async () => {
    const file = loadInput.files && loadInput.files[0];
    loadInput.value = '';
    if (!file) return;
    await loadDesignFile(file);
});

/* ------------------------------------------------------------- drag&drop -- */

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const jsonFiles = files.filter((f) => f.type === 'application/json' || f.name.endsWith('.json'));

    if (jsonFiles.length) { await loadDesignFile(jsonFiles[0]); return; }
    if (!imageFiles.length) return;

    setStatus('');
    const nodes = await importImageFiles(imageFiles);
    for (const node of nodes) {
        if (await shouldOfferBgRemoval(node)) await askAndEditBackground(node);
    }
});

/* ------------------------------------------------------ background removal -- */

let bgTargetNode = null;

async function shouldOfferBgRemoval(node) {
    if (!(node instanceof Konva.Image) || !node.image()) return false;
    const img = node.image();
    const src = img.src || '';
    if (!src) return false;
    try {
        const small = document.createElement('canvas');
        small.width = Math.min(img.naturalWidth || 64, 64);
        small.height = Math.min(img.naturalHeight || 64, 64);
        const ctx = small.getContext('2d');
        ctx.drawImage(img, 0, 0, small.width, small.height);
        const data = ctx.getImageData(0, 0, small.width, small.height).data;
        const corners = [
            [0, 0], [small.width - 1, 0],
            [0, small.height - 1], [small.width - 1, small.height - 1],
        ];
        let opaque = 0;
        for (const [x, y] of corners) {
            if (data[(y * small.width + x) * 4 + 3] > 128) opaque++;
        }
        return opaque >= 3;
    } catch { return false; }
}

async function askAndEditBackground(node) {
    const source = node.getAttr('source') || {};
    const name = source.name || 'этого изображения';
    const yes = await showConfirm({
        title: 'Удалить фон?',
        message: `Хотите удалить фон у ${name}? Это можно сделать и позже из панели инструментов.`,
        confirmLabel: 'Удалить фон',
        cancelLabel: 'Оставить как есть',
    });
    if (!yes) return;
    openBgEditorForNode(node);
}

function startBgRemovalForSelected() {
    const node = getSelectedImageNode();
    if (!node) { setStatus('Сначала выберите изображение.'); return; }
    openBgEditorForNode(node);
}

function openBgEditorForNode(node) {
    if (!(node instanceof Konva.Image) || !node.image()) return;
    const source = node.getAttr('source') || {};
    const url = (source.kind === 'image' && source.originalDataURL)
        ? source.originalDataURL
        : node.image().src;
    if (!url) { setStatus('У этого изображения нет источника для редактирования.'); return; }
    bgTargetNode = node;
    openBgRemoval(url);
}

/* ------------------------------------------------------- save / load ----- */

function saveDesignToFile() {
    try {
        const data = serializeDesign();
        const json = JSON.stringify(data);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `дизайн-футболки-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
        console.error(err);
        setStatus('Не удалось сохранить дизайн.');
    }
}

async function saveDesignAsPNG() {
    try {
        setStatus('Готовим PNG…');
        const dataURL = await exportDesignToPNG({ pixelRatio: 2, padding: 20 });
        setStatus('');
        if (!dataURL) {
            setStatus('Нечего сохранять — на холсте нет объектов.');
            return;
        }
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `дизайн-футболки-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (err) {
        console.error(err);
        setStatus('Не удалось сохранить PNG.');
    }
}

async function loadDesignFile(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        await loadDesign(data);
        setStatus('');
    } catch (err) {
        console.error(err);
        setStatus('Не удалось загрузить дизайн. Файл повреждён?');
    }
}

/* ------------------------------------------------------ image adjustments -- */

const panel = document.querySelector('#imagePanel');
const brightnessEl = document.querySelector('#brightness');
const brightnessVal = document.querySelector('#brightnessVal');
const contrastEl = document.querySelector('#contrast');
const contrastVal = document.querySelector('#contrastVal');
const grayscaleEl = document.querySelector('#grayscale');
const resetAdjustBtn = document.querySelector('#resetAdjust');

function readAdjust() {
    return {
        brightness: Number(brightnessEl.value) / 100,
        contrast: Number(contrastEl.value),
        grayscale: grayscaleEl.checked,
    };
}

function updateImagePanel() {
    const node = getSelectedImageNode();
    if (!node) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const adjust = node.getAttr('adjust') || { brightness: 0, contrast: 0, grayscale: false };
    brightnessEl.value = Math.round((adjust.brightness || 0) * 100);
    contrastEl.value = adjust.contrast || 0;
    grayscaleEl.checked = !!adjust.grayscale;
    brightnessVal.textContent = brightnessEl.value;
    contrastVal.textContent = contrastEl.value;
}

[brightnessEl, contrastEl].forEach((el) => {
    el.addEventListener('input', () => {
        brightnessVal.textContent = brightnessEl.value;
        contrastVal.textContent = contrastEl.value;
        const node = getSelectedImageNode();
        if (node) applyImageAdjustments(node, readAdjust());
    });
});

grayscaleEl.addEventListener('change', () => {
    const node = getSelectedImageNode();
    if (node) applyImageAdjustments(node, readAdjust());
});

resetAdjustBtn.addEventListener('click', () => {
    const node = getSelectedImageNode();
    if (!node) return;
    brightnessEl.value = 0; contrastEl.value = 0; grayscaleEl.checked = false;
    brightnessVal.textContent = '0'; contrastVal.textContent = '0';
    applyImageAdjustments(node, readAdjust());
});

/* ------------------------------------------------- drawing popup window --- */

let pendingEditNode = null;

function openDrawingWindow(editNode = null) {
    pendingEditNode = editNode || null;
    const w = 900, h = 680;
    const left = Math.max(0, (window.screen.availWidth - w) / 2);
    const top = Math.max(0, (window.screen.availHeight - h) / 2);
    const win = window.open(
        'draw.html', 'tshirtDrawingWindow',
        `popup=yes,width=${w},height=${h},left=${left},top=${top}`
    );
    if (!win) {
        setStatus('Всплывающее окно заблокировано — разрешите всплывающие окна.');
        pendingEditNode = null;
        return;
    }
    win.focus();
}

window.addEventListener('message', async (event) => {
    if (event.origin !== window.location.origin && event.origin !== 'null') return;
    const data = event.data;
    if (!data) return;

    if (data.type === 'tshirt:ready') {
        const node = pendingEditNode;
        if (node && node.getStage && node.image()) {
            const source = node.getAttr('source') || {};
            event.source?.postMessage(
                { type: 'tshirt:edit', dataURL: node.image().src, width: source.width || 0, height: source.height || 0 },
                '*'
            );
        }
        return;
    }

    if (data.type === 'tshirt:drawing') {
        const editTarget = pendingEditNode;
        pendingEditNode = null;
        try {
            let updated = null;
            if (data.editInfo && editTarget) {
                updated = await updateDrawingNode(editTarget, data.dataURL, data.crop, data.editInfo);
            }
            if (!updated) await addDrawingFromDataURL(data.dataURL, data.crop.w, data.crop.h);
            setStatus('');
        } catch (err) {
            console.warn(err);
            setStatus('Не удалось добавить рисунок.');
        }
    }
});

/* -------------------------------------------------------------- keyboard -- */

window.addEventListener('keydown', (e) => {
    if (document.querySelector('.help-modal')) return;   // let the dialog handle its own keys

    if (e.key === 'Escape') {
        if (isEditingMask()) exitMaskEditMode();
        else cancelMaskPick();
        setStatus('');
        return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === document.body) {
        e.preventDefault();
        deleteSelected();
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '0') { e.preventDefault(); resetView(); }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '-') { e.preventDefault(); zoomOut(); }
});