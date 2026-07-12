// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    canExportDiagramPreview,
    downloadDiagramPreviewAsPng,
} from '../exportSvgPng';

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function makePreviewWithSvg(opts?: {
    viewBox?: string;
    width?: string;
    height?: string;
    empty?: boolean;
    error?: boolean;
}): HTMLElement {
    const preview = document.createElement('div');
    preview.className = 'mu-diagram-preview';
    document.body.appendChild(preview);

    if (opts?.empty) {
        preview.innerHTML = '<div class="mu-empty">&lt; Empty Diagram &gt;</div>';
        return preview;
    }
    if (opts?.error) {
        preview.innerHTML = '<div class="mu-diagram-error">fail</div>';
        return preview;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (opts?.viewBox)
        svg.setAttribute('viewBox', opts.viewBox);
    if (opts?.width)
        svg.setAttribute('width', opts.width);
    if (opts?.height)
        svg.setAttribute('height', opts.height);
    svg.innerHTML = '<rect width="10" height="10" fill="#000"/>';
    preview.appendChild(svg);
    return preview;
}

describe('canExportDiagramPreview', () => {
    it('is true when an svg has a viewBox size', () => {
        expect(canExportDiagramPreview(makePreviewWithSvg({ viewBox: '0 0 100 40' }))).toBe(true);
    });

    it('is false for empty / error / missing preview', () => {
        expect(canExportDiagramPreview(null)).toBe(false);
        expect(canExportDiagramPreview(makePreviewWithSvg({ empty: true }))).toBe(false);
        expect(canExportDiagramPreview(makePreviewWithSvg({ error: true }))).toBe(false);
    });

    it('is false for a zero-size svg with no viewBox (hidden preview)', () => {
        const preview = makePreviewWithSvg({});
        // No viewBox / width / height attributes and no layout box.
        expect(canExportDiagramPreview(preview)).toBe(false);
    });

    it('is false for cross-origin plantuml-style images', () => {
        const preview = document.createElement('div');
        preview.className = 'mu-diagram-preview';
        const img = document.createElement('img');
        img.src = 'https://www.plantuml.com/plantuml/svg/example';
        Object.defineProperty(img, 'naturalWidth', { value: 200 });
        Object.defineProperty(img, 'naturalHeight', { value: 100 });
        preview.appendChild(img);
        document.body.appendChild(preview);
        expect(canExportDiagramPreview(preview)).toBe(false);
    });
});

describe('downloadDiagramPreviewAsPng', () => {
    beforeEach(() => {
        // happy-dom Image may not paint data URLs; stub a successful load.
        vi.stubGlobal(
            'Image',
            class {
                onload: (() => void) | null = null;
                onerror: (() => void) | null = null;
                crossOrigin: string | null = null;
                width = 100;
                height = 40;
                naturalWidth = 100;
                naturalHeight = 40;
                set src(_value: string) {
                    queueMicrotask(() => this.onload?.());
                }
            },
        );

        HTMLCanvasElement.prototype.getContext = vi.fn(() => {
            return {
                fillStyle: '',
                fillRect: vi.fn(),
                drawImage: vi.fn(),
            } as unknown as CanvasRenderingContext2D;
        }) as never;

        HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback) => {
            cb(new Blob(['png'], { type: 'image/png' }));
        }) as never;
    });

    it('downloads a png and revokes the object URL', async () => {
        const preview = makePreviewWithSvg({ viewBox: '0 0 100 40' });
        const createObjectURL = vi.fn(() => 'blob:diagram-test');
        const revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL,
            revokeObjectURL,
        });

        const click = vi.fn();
        const originalCreate = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
            const el = originalCreate(tag);
            if (tag === 'a')
                el.click = click;
            return el;
        }) as typeof document.createElement);

        await downloadDiagramPreviewAsPng(preview, 'demo.png');

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:diagram-test');
        });
    });

    it('rejects when the preview has no graphic', async () => {
        const preview = makePreviewWithSvg({ empty: true });
        await expect(downloadDiagramPreviewAsPng(preview)).rejects.toThrow(
            /No exportable diagram graphic/,
        );
    });

    it('rejects zero-size svg without inventing a 1x1 canvas', async () => {
        const preview = makePreviewWithSvg({});
        await expect(downloadDiagramPreviewAsPng(preview)).rejects.toThrow(
            /no exportable size/i,
        );
    });

    it('rejects cross-origin images instead of producing a tainted canvas', async () => {
        const preview = document.createElement('div');
        preview.className = 'mu-diagram-preview';
        const img = document.createElement('img');
        img.src = 'https://www.plantuml.com/plantuml/svg/example';
        Object.defineProperty(img, 'naturalWidth', { value: 200 });
        Object.defineProperty(img, 'naturalHeight', { value: 100 });
        preview.appendChild(img);
        document.body.appendChild(preview);

        await expect(downloadDiagramPreviewAsPng(preview)).rejects.toThrow(
            /Cross-origin/,
        );
    });
});
