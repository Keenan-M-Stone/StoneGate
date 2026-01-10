import type { DeviceStatus } from '../../../../shared/protocol/MessageTypes';
export default function ComponentNode({ id: _id, label, type, status, schema: _schema, buildMode, width, height, onResize, spacing }: {
    id: string;
    label: string;
    type: string;
    status?: DeviceStatus | null;
    schema?: any;
    buildMode?: boolean;
    width?: number;
    height?: number;
    onResize?: (w: number, h: number) => void;
    spacing?: number;
}): import("react/jsx-runtime").JSX.Element;
