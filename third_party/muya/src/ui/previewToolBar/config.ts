import CodeIcon from '../../assets/icons/code/2.png';
import DeleteIcon from '../../assets/icons/delete/2.png';
import EditIcon from '../../assets/icons/edit.png';
import ImageIcon from '../../assets/icons/format_image/2.png';

export type PreviewToolIcon = {
    type: string;
    tooltip: string;
    icon: string;
    glyph?: 'line-chart';
};

/** Default tools for html-block / math-block. */
export const PREVIEW_ICONS: PreviewToolIcon[] = [
    {
        type: 'edit',
        tooltip: 'edit',
        icon: EditIcon,
    },
    {
        type: 'delete',
        tooltip: 'delete block',
        icon: DeleteIcon,
    },
];

/** Diagram tools: toggle source/preview + export PNG. */
export const DIAGRAM_SOURCE_ICON: PreviewToolIcon = {
    type: 'toggle',
    tooltip: 'View Source',
    icon: CodeIcon,
};

export const DIAGRAM_PREVIEW_ICON: PreviewToolIcon = {
    type: 'toggle',
    tooltip: 'View Diagram',
    icon: '',
    glyph: 'line-chart',
};

export const DIAGRAM_EXPORT_ICON: PreviewToolIcon = {
    type: 'export',
    tooltip: 'Export PNG',
    icon: ImageIcon,
};

// Back-compat default export used by older call sites / tests.
export default PREVIEW_ICONS;
