// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { getLabelFromEvent } from '../config';

describe('paragraphQuickInsertMenu shortcut matching', () => {
    it('maps command-number shortcuts to heading labels', () => {
        const event = new KeyboardEvent('keydown', {
            code: 'Digit1',
            key: '1',
            metaKey: true,
            ctrlKey: true,
        });

        expect(getLabelFromEvent(event)).toBe('atx-heading 1');
    });

    it('maps common list shortcuts to list labels', () => {
        const event = new KeyboardEvent('keydown', {
            code: 'KeyO',
            key: 'o',
            altKey: true,
            metaKey: true,
            ctrlKey: true,
        });

        expect(getLabelFromEvent(event)).toBe('order-list');
    });
});
