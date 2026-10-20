/**
 * helpDialog.js
 * Shared help dialog for both the main designer and the drawing window.
 * Self-contained: creates its DOM, uses `.help-modal` styles from theme.css,
 * and uses localStorage to auto-show only once per app.
 */

export function showHelpDialog({ title, subtitle, sections, onClose }) {
    // Remove any pre-existing help modal
    document.querySelectorAll('.help-modal').forEach((n) => n.remove());

    const modal = document.createElement('div');
    modal.className = 'help-modal';

    const content = document.createElement('div');
    content.className = 'help-modal-content';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'help-close';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

    const h2 = document.createElement('h2');
    h2.textContent = title || 'Справка';

    content.appendChild(closeBtn);
    content.appendChild(h2);

    if (subtitle) {
        const sub = document.createElement('p');
        sub.className = 'help-subtitle';
        sub.textContent = subtitle;
        content.appendChild(sub);
    }

    const sectionsEl = document.createElement('div');
    sectionsEl.className = 'help-sections';

    for (const section of sections || []) {
        const secEl = document.createElement('section');
        secEl.className = 'help-section';

        const h3 = document.createElement('h3');
        h3.textContent = section.title;
        secEl.appendChild(h3);

        const itemsEl = document.createElement('div');
        itemsEl.className = 'help-items';

        for (const item of section.items || []) {
            const itemEl = document.createElement('div');
            itemEl.className = 'help-item';

            const iconEl = document.createElement('i');
            iconEl.className = `fa-solid ${item.icon || 'fa-circle-info'}`;
            itemEl.appendChild(iconEl);

            const textEl = document.createElement('div');
            textEl.className = 'help-item-text';

            const nameEl = document.createElement('strong');
            nameEl.textContent = item.name;
            const descEl = document.createElement('span');
            descEl.textContent = item.desc;

            textEl.appendChild(nameEl);
            textEl.appendChild(descEl);
            itemEl.appendChild(textEl);
            itemsEl.appendChild(itemEl);
        }

        secEl.appendChild(itemsEl);
        sectionsEl.appendChild(secEl);
    }

    content.appendChild(sectionsEl);

    const footer = document.createElement('div');
    footer.className = 'help-footer';
    const okBtn = document.createElement('button');
    okBtn.className = 'primary';
    okBtn.innerHTML = '<i class="fa-solid fa-check"></i> Понятно';
    footer.appendChild(okBtn);
    content.appendChild(footer);

    modal.appendChild(content);
    document.body.appendChild(modal);

    const onKey = (e) => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            close();
        }
    };

    const close = () => {
        modal.remove();
        document.removeEventListener('keydown', onKey);
        if (onClose) onClose();
    };

    closeBtn.addEventListener('click', close);
    okBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', onKey);

    okBtn.focus();
    return close;
}

/**
 * Show the dialog on the first ever launch (tracked via localStorage).
 * Returns true if the dialog was shown.
 */
export function maybeAutoShowHelp({ storageKey, ...options }) {
    if (!storageKey) {
        showHelpDialog(options);
        return true;
    }

    let alreadyShown = false;
    try { alreadyShown = localStorage.getItem(storageKey) === '1'; } catch { /* ignore */ }
    if (alreadyShown) return false;

    showHelpDialog(options);
    try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
    return true;
}