let toolbarEl;

export function initToolbar() {
    toolbarEl = document.querySelector(".toolbar");
}

export function toggleToolbar() {
    if (!toolbarEl) return;
    toolbarEl.classList.toggle("hidden");
}

export function hideToolbar() {
    if (!toolbarEl || toolbarEl.classList.contains("hidden")) return;
    toolbarEl.classList.add("hidden");
}

export function showToolbar() {
    if (!toolbarEl || !toolbarEl.classList.contains("hidden")) return;
    toolbarEl.classList.remove("hidden");
}