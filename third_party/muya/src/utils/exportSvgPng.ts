/**
 * Rasterize an inline SVG (or same-origin / data <img> fallback) to a PNG download.
 * Used by the diagram PreviewToolBar "Export PNG" action.
 */

const DEFAULT_SCALE = 2;
/** Cap canvas pixels to avoid tab OOMs on huge diagrams. */
const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_EDGE = 8192;

function resolveBackground(el: Element): string {
    const host = el.closest('.mu-editor, .mu-portal') ?? document.documentElement;
    const raw = getComputedStyle(host).getPropertyValue('--editor-bg-color').trim();
    return raw || '#ffffff';
}

function parsePositive(value: string | null | undefined): number {
    if (!value)
        return 0;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Resolve intrinsic SVG size. Never falls back to a 1×1 placeholder — hidden
 * previews (`display:none`) report zero layout size and must fail closed.
 */
export function svgPixelSize(svg: SVGSVGElement): { width: number; height: number } | null {
    const viewBox = svg.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0)
        return { width: viewBox.width, height: viewBox.height };

    const attrW = parsePositive(svg.getAttribute('width'));
    const attrH = parsePositive(svg.getAttribute('height'));
    if (attrW > 0 && attrH > 0)
        return { width: attrW, height: attrH };

    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0)
        return { width: rect.width, height: rect.height };

    return null;
}

function clampCanvasSize(width: number, height: number, scale: number): { width: number; height: number; scale: number } {
    let s = scale;
    let w = Math.round(width * s);
    let h = Math.round(height * s);

    if (w > MAX_EDGE || h > MAX_EDGE) {
        const edgeScale = Math.min(MAX_EDGE / width, MAX_EDGE / height);
        s = Math.min(s, edgeScale);
        w = Math.round(width * s);
        h = Math.round(height * s);
    }

    if (w * h > MAX_CANVAS_PIXELS) {
        const pixelScale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
        s = Math.min(s, pixelScale);
        w = Math.max(1, Math.round(width * s));
        h = Math.max(1, Math.round(height * s));
    }

    return { width: Math.max(1, w), height: Math.max(1, h), scale: s };
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    }
    finally {
        // Release after the click has a chance to start the download.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob)
                resolve(blob);
            else
                reject(new Error('Failed to encode PNG'));
        }, 'image/png');
    });
}

function isExportableImageSrc(src: string): boolean {
    const trimmed = src.trim();
    if (!trimmed)
        return false;
    if (/^(data:|blob:)/i.test(trimmed))
        return true;
    try {
        const url = new URL(trimmed, window.location.href);
        return url.origin === window.location.origin;
    }
    catch {
        return false;
    }
}

function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        if (crossOrigin)
            img.crossOrigin = crossOrigin;
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image for PNG export'));
        img.src = src;
    });
}

async function rasterizeImageSource(
    src: string,
    width: number,
    height: number,
    background: string,
    scale: number,
    crossOrigin?: string,
): Promise<Blob> {
    const img = await loadImage(src, crossOrigin);
    const sized = clampCanvasSize(width, height, scale);
    const canvas = document.createElement('canvas');
    canvas.width = sized.width;
    canvas.height = sized.height;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Canvas 2D context unavailable');

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasToPngBlob(canvas);
}

/**
 * Export a diagram preview node as a PNG file download.
 * Prefers an inline <svg>; falls back to same-origin / data PlantUML-style <img>.
 */
export async function downloadDiagramPreviewAsPng(
    preview: HTMLElement,
    filename = 'mermaid-diagram.png',
    scale = DEFAULT_SCALE,
): Promise<void> {
    const background = resolveBackground(preview);
    const svg = preview.querySelector('svg');
    if (svg) {
        const size = svgPixelSize(svg);
        if (!size)
            throw new Error('Diagram has no exportable size');

        const { width, height } = size;
        const clone = svg.cloneNode(true) as SVGSVGElement;
        if (!clone.getAttribute('xmlns'))
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        if (!clone.getAttribute('width'))
            clone.setAttribute('width', String(width));
        if (!clone.getAttribute('height'))
            clone.setAttribute('height', String(height));

        const serializer = new XMLSerializer();
        const svgText = serializer.serializeToString(clone);
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
        const blob = await rasterizeImageSource(dataUrl, width, height, background, scale);
        triggerDownload(blob, filename);
        return;
    }

    const img = preview.querySelector('img');
    if (img?.src) {
        if (!isExportableImageSrc(img.src)) {
            throw new Error(
                'Cross-origin diagram images cannot be exported (canvas would be tainted)',
            );
        }
        const width = img.naturalWidth || img.width || img.getBoundingClientRect().width;
        const height = img.naturalHeight || img.height || img.getBoundingClientRect().height;
        if (!(width > 0 && height > 0))
            throw new Error('Diagram has no exportable size');

        const crossOrigin = /^(data:|blob:)/i.test(img.src) ? undefined : 'anonymous';
        const blob = await rasterizeImageSource(
            img.src,
            width,
            height,
            background,
            scale,
            crossOrigin,
        );
        triggerDownload(blob, filename);
        return;
    }

    throw new Error('No exportable diagram graphic found');
}

/** Whether the preview currently has something that can be exported as PNG. */
export function canExportDiagramPreview(preview: HTMLElement | null | undefined): boolean {
    if (!preview)
        return false;
    if (preview.querySelector('.mu-diagram-error, .mu-empty'))
        return false;

    const svg = preview.querySelector('svg');
    if (svg)
        return svgPixelSize(svg) != null;

    const img = preview.querySelector('img');
    if (!img?.src || !isExportableImageSrc(img.src))
        return false;

    const width = img.naturalWidth || img.width || img.getBoundingClientRect().width;
    const height = img.naturalHeight || img.height || img.getBoundingClientRect().height;
    return width > 0 && height > 0;
}
