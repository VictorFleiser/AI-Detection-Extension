console.log("content.js loaded and ready.");
let overlay = null, selectionBox = null, startX, startY;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "initiateSelection") {
        cleanup(); 
        hideModifiedOutlines();
        startSelection(request.type);
    } 
    else if (request.action === "cleanupSelectionUI") {
        cleanup();
        restoreModifiedOutlines();
        sendResponse({ success: true });
    }
    return true;
});

function startSelection(type) {
    document.body.style.cursor = 'crosshair';
    overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.3)', zIndex: '999999'
    });
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', handleMouseDown);
    overlay.dataset.selectionType = type;
}

function handleMouseDown(e) {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    selectionBox = document.createElement('div');
    Object.assign(selectionBox.style, {
        position: 'fixed', border: '2px dashed #fff', zIndex: '1000000',
        left: `${startX}px`, top: `${startY}px`
    });
    document.body.appendChild(selectionBox);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
}

function handleMouseMove(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectionBox) return;
    const width = e.clientX - startX;
    const height = e.clientY - startY;
    Object.assign(selectionBox.style, {
        width: `${Math.abs(width)}px`, height: `${Math.abs(height)}px`,
        left: `${width > 0 ? startX : e.clientX}px`, top: `${height > 0 ? startY : e.clientY}px`
    });
}

function handleMouseUp(e) {
    e.preventDefault();
    e.stopPropagation();
    const rect = selectionBox.getBoundingClientRect();
    const selectionType = overlay.dataset.selectionType;

    chrome.runtime.sendMessage({
        action: "selectionComplete",
        type: selectionType,
        rect: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
        },
        devicePixelRatio: window.devicePixelRatio
    });
}

function cleanup() {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    if (overlay) overlay.remove();
    if (selectionBox) selectionBox.remove();
    overlay = selectionBox = null;
    document.body.style.cursor = 'default';
}

chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === "CREATE_TABS") {
        const mod = await import(chrome.runtime.getURL("create_tabs.js"));
        mod.createTabs();
    };
});

function hideModifiedOutlines() {
    const modifiedElements = document.querySelectorAll('[data-modified-by-extension="true"]');
    modifiedElements.forEach(el => {
        el.dataset.originalOutline = el.style.outline;
        el.style.outline = 'none';
    });
}

function restoreModifiedOutlines() {
    const modifiedElements = document.querySelectorAll('[data-modified-by-extension="true"]');
    modifiedElements.forEach(el => {
        if (el.dataset.originalOutline) {
            el.style.outline = el.dataset.originalOutline;
            delete el.dataset.originalOutline;
        }
    });
}