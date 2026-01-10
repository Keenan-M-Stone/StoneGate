export default function ComponentDialog({ id, status, schema: _schema, onClose, onStageSet, onStageZero }: {
    id: string;
    status: any;
    schema: any;
    onClose?: () => void;
    onStageSet?: (params: any) => void;
    onStageZero?: () => void;
}): import("react/jsx-runtime").JSX.Element;
