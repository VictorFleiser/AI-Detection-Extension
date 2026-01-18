// This script runs in the offscreen document.

chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(request) {
  // We only expect one type of message now: a request to crop an image.
  if (request.action === 'cropImage') {
    await handleImageCrop(request);
  }
}

async function handleImageCrop({ type, dataUrl, rect, devicePixelRatio, url }) {
    const img = new Image();
    img.onload = () => {
        const canvas = new OffscreenCanvas(rect.width * devicePixelRatio, rect.height * devicePixelRatio);
        const ctx = canvas.getContext('2d');

        const sx = rect.x * devicePixelRatio;
        const sy = rect.y * devicePixelRatio;
        const sWidth = rect.width * devicePixelRatio;
        const sHeight = rect.height * devicePixelRatio;

        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

        canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 }).then(blob => {
            const reader = new FileReader();
            reader.onload = () => {
                chrome.runtime.sendMessage({
                    action: 'croppedCaptureComplete',
                    type: type,
                    dataUrl: reader.result,
                    url: url
                });
            };
            reader.readAsDataURL(blob);
        });
    };
    img.src = dataUrl;
}