// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_DOM_PROPERTY } from '../../../config';
import { Muya } from '../../../muya';
import { zhCN } from '../../../locales/zh-CN';
import { PreviewToolBar } from '../index';

const bootedHosts: HTMLElement[] = [];
const toolbars: PreviewToolBar[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
    if (typeof globalThis.ResizeObserver === 'undefined') {
        globalThis.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as never;
    }
});

afterEach(() => {
    while (toolbars.length)
        toolbars.pop()!.destroy();
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.querySelectorAll('.mu-portal').forEach(n => n.remove());
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, {
        markdown,
        locale: zhCN,
    } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function makeToolbar(muya: Muya): PreviewToolBar {
    const toolbar = new PreviewToolBar(muya);
    toolbars.push(toolbar);
    return toolbar;
}

describe('PreviewToolBar — diagram hover tools', () => {
    it('renders View Source + Export PNG for an inactive diagram block', () => {
        const muya = bootMuya('```mermaid\ngraph TD; A-->B\n```\n');
        const toolbar = makeToolbar(muya);
        const figure = muya.domNode.querySelector('figure.mu-diagram-block') as HTMLElement;
        expect(figure).toBeTruthy();

        const block = figure[BLOCK_DOM_PROPERTY] as { active: boolean; blockName: string };
        expect(block.blockName).toBe('diagram');
        expect(block.active).toBe(false);

        // Drive the private show/render path the same way hover would.
        // @ts-expect-error — test reaches into private field
        toolbar._block = block;
        toolbar.show(figure);
        toolbar.render();

        const items = toolbar.container!.querySelectorAll('li.item');
        expect(items).toHaveLength(2);
        expect(items[0].classList.contains('toggle')).toBe(true);
        expect(items[0].getAttribute('title')).toBe('查看源码');
        expect(items[1].classList.contains('export')).toBe(true);
        expect(items[1].getAttribute('title')).toBe('导出 PNG');
    });

    it('toggles the label to View Diagram while the block is active', () => {
        const muya = bootMuya('```mermaid\ngraph TD; A-->B\n```\n');
        const toolbar = makeToolbar(muya);
        const figure = muya.domNode.querySelector('figure.mu-diagram-block') as HTMLElement;
        const block = figure[BLOCK_DOM_PROPERTY] as { active: boolean };

        block.active = true;
        // @ts-expect-error — test reaches into private field
        toolbar._block = block;
        toolbar.show(figure);
        toolbar.render();

        const toggle = toolbar.container!.querySelector('li.item.toggle')!;
        expect(toggle.getAttribute('title')).toBe('查看图形');
    });

    it('keeps the toolbar open when the pointer moves onto the float portal', () => {
        vi.useFakeTimers();
        const muya = bootMuya('```mermaid\ngraph TD; A-->B\n```\n');
        const toolbar = makeToolbar(muya);
        const figure = muya.domNode.querySelector('figure.mu-diagram-block') as HTMLElement;
        // @ts-expect-error — private
        toolbar._block = figure[BLOCK_DOM_PROPERTY];
        toolbar.show(figure);
        toolbar.render();
        expect(toolbar.status).toBe(true);

        // Simulate leaving the diagram without entering the toolbar: schedule hide.
        // @ts-expect-error — private
        toolbar._scheduleHide();
        // Moving onto the portal cancels the pending hide.
        toolbar.floatBox!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(toolbar.status).toBe(true);
    });

    it('still exposes edit + delete for math blocks', () => {
        const muya = bootMuya('$$\nx = 1\n$$\n');
        const toolbar = makeToolbar(muya);
        const figure = muya.domNode.querySelector('figure.mu-math-block') as HTMLElement;
        expect(figure).toBeTruthy();

        // @ts-expect-error — private
        toolbar._block = figure[BLOCK_DOM_PROPERTY];
        toolbar.show(figure);
        toolbar.render();

        const items = [...toolbar.container!.querySelectorAll('li.item')].map(
            el => el.className,
        );
        expect(items.some(c => c.includes('edit'))).toBe(true);
        expect(items.some(c => c.includes('delete'))).toBe(true);
        expect(items.some(c => c.includes('export'))).toBe(false);
    });
});
