import type { DeviceStatus } from '../../../../shared/protocol/MessageTypes';
export default function ComponentNode({ id, label, type, status, schema }: {
    id: string;
    label: string;
    type: string;
    status?: DeviceStatus | null;
    schema?: any;
}): import("react/jsx-runtime").JSX.Element;
