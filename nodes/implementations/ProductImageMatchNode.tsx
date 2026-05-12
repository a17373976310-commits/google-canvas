import React from 'react';
import { NodeProps } from 'reactflow';
import { FileText, Filter, Images, Rows3 } from 'lucide-react';
import { BaseNode } from '../BaseNode';
import { NodeData, ProductImageCandidateAnalysis, ProductImageMatchOutput, StandardFilePayload, TaskSelectionTask } from '../../types';
import { useStore } from '../../store';

type MatchImageValue = string | StandardFilePayload;

const isStandardFilePayload = (value: unknown): value is StandardFilePayload => (
    !!value
    && typeof value === 'object'
    && 'id' in value
    && 'type' in value
    && 'source' in value
);

const normalizeImageValues = (value: unknown): MatchImageValue[] => {
    if (Array.isArray(value)) {
        return value.flatMap(normalizeImageValues);
    }

    if (!value) {
        return [];
    }

    if (typeof value === 'string') {
        return value.trim() ? [value] : [];
    }

    if (isStandardFilePayload(value)) {
        return value.type === 'image' ? [value] : [];
    }

    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (Array.isArray(record.image)) return normalizeImageValues(record.image);
        if (Array.isArray(record.selectedImages)) return normalizeImageValues(record.selectedImages);
        if (Array.isArray(record.referenceImages)) return normalizeImageValues(record.referenceImages);
        if (Array.isArray(record.embeddedImages)) return normalizeImageValues(record.embeddedImages);
    }

    return [];
};

const getPreviewSrc = (value: MatchImageValue) => {
    if (typeof value === 'string') return value;
    return String(value.previewData || value.url || value.data || '');
};

const extractTask = (value: unknown): TaskSelectionTask | null => {
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    if (record.task && typeof record.task === 'object') {
        return extractTask(record.task);
    }

    if (!('requirementZh' in record)) return null;

    return {
        taskId: String(record.taskId || ''),
        rowNumber: Number(record.rowNumber || 0),
        serialNo: String(record.serialNo || ''),
        sheetTaskIndex: typeof record.sheetTaskIndex === 'number' ? record.sheetTaskIndex : undefined,
        size: String(record.size || ''),
        requirementZh: String(record.requirementZh || ''),
        referenceText: typeof record.referenceText === 'string' ? record.referenceText : undefined,
        textLayers: Array.isArray(record.textLayers) ? record.textLayers.map((item) => String(item || '')).filter(Boolean) : [],
        referenceImageCount: Array.isArray(record.referenceImages)
            ? record.referenceImages.length
            : Number(record.referenceImageCount || 0),
        embeddedImageCount: Array.isArray(record.embeddedImages)
            ? record.embeddedImages.length
            : Number(record.embeddedImageCount || 0),
        source: {
            sheetName: String((record.source as Record<string, unknown> | undefined)?.sheetName || ''),
            rowNumber: Number((record.source as Record<string, unknown> | undefined)?.rowNumber || 0)
        },
        rawRow: typeof record.rawRow === 'object' && record.rawRow
            ? { ...(record.rawRow as Record<string, string>) }
            : {},
        visualSpec: typeof record.visualSpec === 'object' && record.visualSpec
            ? (record.visualSpec as TaskSelectionTask['visualSpec'])
            : undefined
    };
};

const buildTaskPreview = (value: unknown) => {
    const task = extractTask(value);
    if (!task) return '';

    const parts = [
        task.serialNo ? `#${task.serialNo}` : '',
        task.source.sheetName || '',
        task.visualSpec?.targetAspectRatio || task.size || '',
        task.requirementZh || ''
    ].filter(Boolean);

    return parts.join(' · ');
};

export const ProductImageMatchNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    const output = data.output as ProductImageMatchOutput | undefined;
    const candidateImages = React.useMemo(
        () => normalizeImageValues(data.inputs?.image),
        [data.inputs?.image]
    );
    const selectedImages = React.useMemo(
        () => normalizeImageValues(output?.selectedImages || output?.image),
        [output?.selectedImages, output?.image]
    );
    const candidateAnalyses = Array.isArray(output?.candidateAnalyses)
        ? output.candidateAnalyses as ProductImageCandidateAnalysis[]
        : [];
    const selectedAnalyses = Array.isArray(output?.selectedAnalyses)
        ? output.selectedAnalyses as ProductImageCandidateAnalysis[]
        : [];
    const maxSelections = Math.max(1, Math.min(6, Number(data.config.maxSelections || 3)));
    const taskPreview = buildTaskPreview(data.inputs?.task);
    const promptPreview = typeof data.inputs?.prompt === 'string' ? data.inputs.prompt : '';
    const notes = String(data.config.matchNotes || '');

    return (
        <BaseNode id={id} data={data} icon={Filter} color="bg-sky-500" selected={selected}>
            <div className="p-4 space-y-3 flex-1 overflow-hidden">
                <div className="flex flex-wrap gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${data.inputs?.task ? 'border-teal-500/25 bg-teal-500/10 text-teal-300' : 'theme-border-subtle theme-text-muted'}`}>
                        <Rows3 size={10} />
                        任务
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${data.inputs?.prompt ? 'border-blue-500/25 bg-blue-500/10 text-blue-300' : 'theme-border-subtle theme-text-muted'}`}>
                        <FileText size={10} />
                        提示词
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${candidateImages.length > 0 ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' : 'theme-border-subtle theme-text-muted'}`}>
                        <Images size={10} />
                        候选图 {candidateImages.length || ''}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                        <span className="text-[8px] font-black theme-text-muted uppercase tracking-widest">最多选图</span>
                        <input
                            type="text"
                            inputMode="numeric"
                            className="w-full theme-bg-input border theme-border-medium rounded-xl px-3 py-2 text-[11px] theme-text-primary focus:outline-none focus:border-sky-500/50"
                            value={String(maxSelections)}
                            onChange={(e) => {
                                const nextValue = e.target.value.replace(/[^\d]/g, '');
                                updateNodeData(id, {
                                    config: {
                                        ...data.config,
                                        maxSelections: Math.max(1, Math.min(6, Number(nextValue || 1)))
                                    }
                                });
                            }}
                        />
                    </label>

                    <div className="rounded-2xl border theme-border-medium theme-bg-input px-3 py-2 flex flex-col justify-center">
                        <span className="text-[8px] font-black theme-text-muted uppercase tracking-widest">连接状态</span>
                        <span className="text-[11px] text-sky-300 mt-1">
                            {candidateImages.length > 0 ? `${candidateImages.length} 张候选图` : '等待图片输入'}
                        </span>
                    </div>
                </div>

                <label className="block space-y-1">
                    <span className="text-[8px] font-black theme-text-muted uppercase tracking-widest">筛选附加说明</span>
                    <textarea
                        className="w-full theme-bg-input border theme-border-medium rounded-xl px-3 py-2 text-[11px] theme-text-primary focus:outline-none focus:border-sky-500/50 h-20 resize-none"
                        placeholder="例如：优先选白底主机图；配件任务优先选刷头特写。"
                        value={notes}
                        onChange={(e) => updateNodeData(id, { config: { ...data.config, matchNotes: e.target.value } })}
                    />
                </label>

                <div className="rounded-2xl border theme-border-medium theme-bg-input p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest theme-text-secondary">当前任务</span>
                        <span className="text-[9px] theme-text-muted">
                            {selectedImages.length > 0
                                ? `已选 ${selectedImages.length} 张 / 已分析 ${candidateAnalyses.length || candidateImages.length} 张`
                                : '待运行'}
                        </span>
                    </div>
                    <div className="text-[10px] theme-text-secondary whitespace-pre-wrap break-all line-clamp-4">
                        {taskPreview || promptPreview || '请连接任务选择节点或提示词工程节点。'}
                    </div>
                    {output?.reason && (
                        <div className="text-[9px] text-sky-300 whitespace-pre-wrap break-all">
                            {output.reason}
                        </div>
                    )}
                    {output?.selectedIndexes?.length ? (
                        <div className="text-[9px] theme-text-muted">
                            命中序号：{output.selectedIndexes.join('、')}
                        </div>
                    ) : null}
                </div>

                <div className="rounded-2xl border theme-border-medium theme-bg-input p-3 min-h-[150px]">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[9px] font-black uppercase tracking-widest theme-text-secondary">筛选结果</span>
                        <span className="text-[9px] theme-text-muted">
                            {selectedImages.length > 0 ? `${selectedImages.length}/${candidateImages.length}` : '暂无'}
                        </span>
                    </div>

                    {selectedImages.length > 0 ? (
                        <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                                {selectedImages.slice(0, 6).map((image, index) => {
                                    const preview = getPreviewSrc(image);
                                    return (
                                        <div
                                            key={`${id}-selected-${index}`}
                                            className="relative aspect-square rounded-xl overflow-hidden border theme-border-medium bg-black"
                                        >
                                            {preview ? (
                                                <img
                                                    src={preview}
                                                    alt={`selected-${index + 1}`}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[9px] theme-text-muted">
                                                    无预览
                                                </div>
                                            )}
                                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/70 text-[8px] text-white/80">
                                                {output?.selectedIndexes?.[index] ?? index + 1}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            {selectedAnalyses.length > 0 && (
                                <div className="space-y-2">
                                    {selectedAnalyses.slice(0, 3).map((analysis) => (
                                        <div
                                            key={`${id}-analysis-${analysis.index}`}
                                            className="rounded-xl border theme-border-medium theme-bg-input px-3 py-2"
                                        >
                                            <div className="text-[9px] text-sky-300 font-black">
                                                图 {analysis.index} · {analysis.primaryCategory || '未分类'}
                                            </div>
                                            <div className="text-[10px] theme-text-secondary mt-1 line-clamp-2">
                                                {analysis.summaryZh || '暂无摘要'}
                                            </div>
                                            {(analysis.tags?.length || 0) > 0 && (
                                                <div className="text-[9px] theme-text-muted mt-1 truncate">
                                                    标签：{analysis.tags.join(' / ')}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="h-[110px] rounded-xl border border-dashed theme-border-medium flex items-center justify-center text-[10px] theme-text-muted text-center px-4">
                            连接“多图上传”到左侧图片插槽，再连接“任务选择”或“智能对话”后运行。
                        </div>
                    )}
                </div>
            </div>

        </BaseNode>
    );
};
