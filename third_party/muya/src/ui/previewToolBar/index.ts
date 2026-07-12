import type { VNode } from 'snabbdom';
import type Parent from '../../block/base/parent';
import type HTMLBlock from '../../block/commonMark/html';
import type DiagramBlock from '../../block/extra/diagram';
import type MathBlock from '../../block/extra/math';
import type { Muya } from '../../index';
import { ScrollPage } from '../../block/scrollPage';
import { BLOCK_DOM_PROPERTY } from '../../config';
import { isMouseEvent, throttle } from '../../utils';
import {
    canExportDiagramPreview,
    downloadDiagramPreviewAsPng,
} from '../../utils/exportSvgPng';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import {
    DIAGRAM_EXPORT_ICON,
    DIAGRAM_PREVIEW_ICON,
    DIAGRAM_SOURCE_ICON,
    PREVIEW_ICONS,
    type PreviewToolIcon,
} from './config';

import './index.css';

type PreviewBlock = HTMLBlock | MathBlock | DiagramBlock;

const defaultOptions = {
    placement: 'right-start' as const,
    offsetOptions: {
        mainAxis: -95,
        crossAxis: 5,
        alignmentAxis: 0,
    },
    showArrow: false,
};

const DIAGRAM_OPTIONS = {
    placement: 'top' as const,
    offsetOptions: {
        mainAxis: 8,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

const HIDE_DELAY_MS = 280;

const PREVIEW_HOST_RE = /^(html-block|math-block|diagram)$/;

function resolvePreviewHost(
    eles: Element[],
): { block: PreviewBlock; element: HTMLElement } | null {
    for (const ele of eles) {
        const raw = ele[BLOCK_DOM_PROPERTY] as Parent | undefined;
        if (!raw)
            continue;

        const candidate = PREVIEW_HOST_RE.test(raw.blockName)
            ? raw
            : raw.outMostBlock;

        if (
            candidate
            && PREVIEW_HOST_RE.test(candidate.blockName)
            && candidate.domNode
        ) {
            return {
                block: candidate as PreviewBlock,
                element: candidate.domNode,
            };
        }
    }

    return null;
}

export class PreviewToolBar extends BaseFloat {
    static pluginName = 'previewTools';
    private _oldVNode: VNode | null = null;
    private _block: PreviewBlock | null = null;
    private _iconContainer: HTMLDivElement = document.createElement('div');
    private _hideTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(muya: Muya, options = {}) {
        const name = 'mu-preview-tools';
        const opts = Object.assign({}, defaultOptions, options);
        super(muya, name, opts);
        this.options = opts;
        this.container?.appendChild(this._iconContainer);
        this.floatBox?.classList.add('mu-preview-tools-container');
        this.listen();
    }

    private _cancelHide() {
        if (this._hideTimer) {
            clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }
    }

    private _scheduleHide() {
        this._cancelHide();
        this._hideTimer = setTimeout(() => {
            this.hide();
        }, HIDE_DELAY_MS);
    }

    private _isDiagram(block: PreviewBlock | null): block is DiagramBlock {
        return !!block && block.blockName === 'diagram';
    }

    private _diagramPreviewEl(block: DiagramBlock): HTMLElement | null {
        const preview = block.attachments?.head;
        return (preview?.domNode as HTMLElement | undefined) ?? null;
    }

    private _iconsForBlock(block: PreviewBlock): PreviewToolIcon[] {
        if (!this._isDiagram(block))
            return PREVIEW_ICONS;

        const toggle = block.active ? DIAGRAM_PREVIEW_ICON : DIAGRAM_SOURCE_ICON;
        return [toggle, DIAGRAM_EXPORT_ICON];
    }

    private _applyPlacement(block: PreviewBlock) {
        if (this._isDiagram(block))
            Object.assign(this.options, DIAGRAM_OPTIONS);
        else
            Object.assign(this.options, defaultOptions);
    }

    private _deactivateDiagram(block: DiagramBlock) {
        const content = block.firstContentInDescendant();
        content?.domNode?.blur();
        for (const ancestor of content?.getAncestors() ?? [])
            ancestor.active = false;
        block.active = false;
    }

    override listen() {
        const { eventCenter } = this.muya;
        super.listen();

        const handler = throttle((event: Event) => {
            if (!isMouseEvent(event))
                return;

            const target = event.target;
            if (target instanceof Node && this.floatBox?.contains(target)) {
                this._cancelHide();
                return;
            }

            const { x, y } = event;
            const host = resolvePreviewHost([...document.elementsFromPoint(x, y)]);

            if (!host) {
                this._scheduleHide();
                return;
            }

            const { block, element } = host;
            const isDiagram = block.blockName === 'diagram';

            // html/math hide while editing; diagram keeps the toolbar in both modes.
            if (!isDiagram && block.active) {
                this._scheduleHide();
                return;
            }

            if (block.blockName === 'html-block' && this.muya.options.disableHtml) {
                this._scheduleHide();
                return;
            }

            this._cancelHide();
            this._block = block;
            this._applyPlacement(block);
            this.show(element);
            this.render();
        }, 300);

        eventCenter.attachDOMEvent(document.body, 'mousemove', handler);

        // Keep the toolbar while the pointer is over the portal itself.
        eventCenter.attachDOMEvent(this.floatBox!, 'mouseenter', () => {
            this._cancelHide();
        });
        eventCenter.attachDOMEvent(this.floatBox!, 'mouseleave', () => {
            this._scheduleHide();
        });
    }

    render() {
        const { _iconContainer: iconContainer, _oldVNode: oldVNode, _block: block } = this;
        if (!block)
            return;

        const icons = this._iconsForBlock(block);
        const exportable = this._isDiagram(block)
            ? canExportDiagramPreview(this._diagramPreviewEl(block))
            : true;

        const children = icons.map((i) => {
            const iconWrapperSelector = 'div.icon-wrapper';
            const icon = h(
                'i.icon',
                h(
                    'i.icon-inner',
                    {
                        style: {
                            'background': `url(${i.icon}) no-repeat`,
                            'background-size': '100%',
                        },
                    },
                    '',
                ),
            );
            const iconWrapper = h(iconWrapperSelector, icon);

            const disabled = i.type === 'export' && !exportable;
            const itemSelector = disabled
                ? `li.item.${i.type}.disabled`
                : `li.item.${i.type}`;

            return h(
                itemSelector,
                {
                    attrs: {
                        title: this.muya.i18n.t(i.tooltip),
                        'aria-disabled': disabled ? 'true' : 'false',
                    },
                    on: {
                        click: (event) => {
                            if (disabled)
                                return;
                            this.selectItem(event, i);
                        },
                    },
                },
                [iconWrapper],
            );
        });

        const vnode = h('ul', children);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(iconContainer, vnode);

        this._oldVNode = vnode;
    }

    selectItem(event: Event, i: PreviewToolIcon) {
        event.preventDefault();
        event.stopPropagation();
        const { _block: block } = this;
        if (!block)
            return;

        let cursorBlock = null;

        switch (i.type) {
            case 'edit': {
                cursorBlock = block.firstContentInDescendant();
                break;
            }

            case 'delete': {
                const state = {
                    name: 'paragraph',
                    text: '',
                };

                const newBlock = ScrollPage.loadBlock('paragraph').create(
                    this.muya,
                    state,
                );
                block.replaceWith(newBlock);
                cursorBlock = newBlock.firstContentInDescendant();
                break;
            }

            case 'toggle': {
                if (!this._isDiagram(block))
                    break;

                if (block.active) {
                    this._deactivateDiagram(block);
                    this._applyPlacement(block);
                    this.show(block.domNode!);
                    this.render();
                    return;
                }

                cursorBlock = block.firstContentInDescendant();
                break;
            }

            case 'export': {
                if (!this._isDiagram(block))
                    break;
                const preview = this._diagramPreviewEl(block);
                if (!preview || !canExportDiagramPreview(preview))
                    break;
                void downloadDiagramPreviewAsPng(preview).catch((err) => {
                    // Soft-fail: leave markdown/selection untouched.
                    console.warn('[muya] diagram PNG export failed:', err);
                });
                return;
            }
        }

        if (cursorBlock)
            cursorBlock.setCursor(0, 0);

        // After entering source mode, keep the toolbar for diagram so the user
        // can toggle back; html/math hide as before.
        if (this._isDiagram(block)) {
            this._applyPlacement(block);
            // Defer show/render until `.mu-active` has been applied by focus.
            requestAnimationFrame(() => {
                if (this._block !== block)
                    return;
                this.show(block.domNode!);
                this.render();
            });
            return;
        }

        this.hide();
    }

    override hide() {
        this._cancelHide();
        super.hide();
    }

    override destroy() {
        this._cancelHide();
        super.destroy();
    }
}
