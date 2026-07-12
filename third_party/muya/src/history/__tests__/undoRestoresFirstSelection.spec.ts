// @vitest-environment happy-dom

// Regression: Quill-style selection lag leaves the *first* undo entry with a
// null selection. After undo rewrites the DOM, the browser caret then collapses
// to offset 0 (line start). History must seed a pre-edit caret from
// selection-change so the first undo still restores the cursor.

import type Format from '../../block/base/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
    delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function firstContent(muya: Muya): Format {
    return muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;
}

function undoEntrySelection(muya: Muya) {
    // @ts-expect-error — reach into the private stack for test assertions.
    return muya.editor.history._stack.undo[0]?.selection ?? null;
}

describe('first undo restores pre-edit caret', () => {
    it('records a non-null selection on the first undo entry and restores it', async () => {
        const muya = bootMuya('hello world\n');
        const content = firstContent(muya);

        // Place the caret after "hello " before the edit so selection-change
        // seeds History._beforeEditSelection.
        content.setCursor(6, 6, true);

        content.text = 'hello X world';
        content.checkInlineUpdate();
        await vi.waitFor(() => {
            expect(muya.getMarkdown()).toContain('hello X world');
        });

        const recorded = undoEntrySelection(muya);
        expect(recorded).not.toBeNull();
        expect(recorded!.anchor.offset).toBe(6);
        expect(recorded!.focus.offset).toBe(6);

        muya.undo();

        expect(muya.getMarkdown().trim()).toBe('hello world');
        const restored = muya.editor.selection.getSelection();
        expect(restored?.anchor.offset).toBe(6);
        expect(restored?.focus.offset).toBe(6);
    });
});
