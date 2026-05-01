import React from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import { Image as ImageIcon, Palette, Rows3, Wand2 } from 'lucide-react';
import { BaseNode } from '../BaseNode';
import { NodeData, StyleGuideOutput, TaskSelectionTask } from '../../types';
import { useStore } from '../../store';

const splitList = (value: unknown) => String(value ?? '')
    .split(/[\n,，;；、]/)
    .map((item) => item.trim())
    .filter(Boolean);

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
        referenceImageCount: Array.isArray(record.referenceImages) ? record.referenceImages.length : Number(record.referenceImageCount || 0),
        embeddedImageCount: Array.isArray(record.embeddedImages) ? record.embeddedImages.length : Number(record.embeddedImageCount || 0),
        source: {
            sheetName: String((record.source as Record<string, unknown> | undefined)?.sheetName || ''),
            rowNumber: Number((record.source as Record<string, unknown> | undefined)?.rowNumber || 0)
        },
        rawRow: typeof record.rawRow === 'object' && record.rawRow ? { ...(record.rawRow as Record<string, string>) } : {},
        visualSpec: typeof record.visualSpec === 'object' && record.visualSpec ? (record.visualSpec as TaskSelectionTask['visualSpec']) : undefined
    };
};

const countImages = (value: unknown): number => {
    if (Array.isArray(value)) {
        return value.reduce((total, item) => total + countImages(item), 0);
    }
    if (!value) return 0;
    if (typeof value === 'string') return value.trim() ? 1 : 0;
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (Array.isArray(record.image)) return countImages(record.image);
        if (Array.isArray(record.selectedImages)) return countImages(record.selectedImages);
        if ('type' in record && record.type === 'image') return 1;
    }
    return 0;
};

export const StyleGuideNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    const output = data.output as StyleGuideOutput | undefined;
    const task = React.useMemo(
        () => extractTask(data.inputs?.task ?? data.meta?.task ?? data.meta?.batchTask),
        [data.inputs?.task, data.meta?.task, data.meta?.batchTask]
    );
    const imageCount = React.useMemo(() => countImages(data.inputs?.image), [data.inputs?.image]);
    const paletteList = splitList(data.config.palette || '');
    const qualityList = splitList(data.config.qualityKeywords || '');
    const negativeList = splitList(data.config.negativeRules || '');
    const consistencyList = splitList(data.config.consistencyRules || '');

    const handleConfigChange = (key: string, value: string) => {
        updateNodeData(id, {
            config: {
                ...data.config,
                [key]: value
            }
        });
    };

    return (
        <BaseNode id={id} data={data} icon={Palette} color="bg-violet-500" selected={selected}>
            <div className="flex flex-col py-2">
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="task"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${task ? '!bg-emerald-500' : '!bg-[#2a2a3a] group-hover/row:!bg-emerald-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <Rows3 size={10} className="text-emerald-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">任务输入</span>
                    </div>
                    {task && (
                        <div className="ml-auto">
                            <span className="text-[7px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 font-black uppercase">已连接</span>
                        </div>
                    )}
                </div>

                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="image"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${imageCount > 0 ? '!bg-orange-500' : '!bg-[#2a2a3a] group-hover/row:!bg-orange-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-orange-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">风格参考图</span>
                    </div>
                    {imageCount > 0 && (
                        <div className="ml-auto">
                            <span className="text-[7px] bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded border border-orange-500/20 font-black uppercase">{imageCount} 张</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="px-4 pb-4 space-y-3 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">风格名称</span>
                        <input
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                            value={data.config.styleName || ''}
                            onChange={(e) => handleConfigChange('styleName', e.target.value)}
                            placeholder="如：清洁科技极简风"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">整体调性</span>
                        <input
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                            value={data.config.tone || ''}
                            onChange={(e) => handleConfigChange('tone', e.target.value)}
                            placeholder="高级、干净、可信赖"
                        />
                    </label>
                </div>

                <label className="block space-y-1">
                    <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">配色方案</span>
                    <input
                        className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                        value={data.config.palette || ''}
                        onChange={(e) => handleConfigChange('palette', e.target.value)}
                        placeholder="暖白、银灰、浅木色、少量品牌色"
                    />
                </label>

                <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">光线风格</span>
                        <input
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                            value={data.config.lighting || ''}
                            onChange={(e) => handleConfigChange('lighting', e.target.value)}
                            placeholder="柔和自然光、整体通透"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">背景环境</span>
                        <input
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                            value={data.config.background || ''}
                            onChange={(e) => handleConfigChange('background', e.target.value)}
                            placeholder="简洁家居、避免杂乱"
                        />
                    </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">构图规则</span>
                        <input
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                            value={data.config.composition || ''}
                            onChange={(e) => handleConfigChange('composition', e.target.value)}
                            placeholder="主体突出、留白充足"
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">镜头语言</span>
                        <input
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                            value={data.config.camera || ''}
                            onChange={(e) => handleConfigChange('camera', e.target.value)}
                            placeholder="中近景、平视或轻俯拍"
                        />
                    </label>
                </div>

                <label className="block space-y-1">
                    <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">材质表现</span>
                    <input
                        className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                        value={data.config.material || ''}
                        onChange={(e) => handleConfigChange('material', e.target.value)}
                        placeholder="金属真实、玻璃通透、蒸汽细节自然"
                    />
                </label>

                <label className="block space-y-1">
                    <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">质量关键词</span>
                    <textarea
                        className="w-full h-16 resize-none bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                        value={data.config.qualityKeywords || ''}
                        onChange={(e) => handleConfigChange('qualityKeywords', e.target.value)}
                        placeholder="商业摄影质感、高清细节、主体真实、适合电商详情页"
                    />
                </label>

                <label className="block space-y-1">
                    <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">连贯性规则</span>
                    <textarea
                        className="w-full h-16 resize-none bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                        value={data.config.consistencyRules || ''}
                        onChange={(e) => handleConfigChange('consistencyRules', e.target.value)}
                        placeholder="统一光线方向、统一景深、统一色彩密度、统一道具语言"
                    />
                </label>

                <label className="block space-y-1">
                    <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">负面约束</span>
                    <textarea
                        className="w-full h-16 resize-none bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-violet-500/50"
                        value={data.config.negativeRules || ''}
                        onChange={(e) => handleConfigChange('negativeRules', e.target.value)}
                        placeholder="避免产品变形、避免背景杂乱、避免风格漂移、避免多余元素"
                    />
                </label>

                <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-2xl border border-[#2a2a3a] bg-[#0b0b0f] p-3">
                        <div className="flex items-center gap-2 mb-2">
                            <Wand2 size={10} className="text-violet-400" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">当前任务</span>
                        </div>
                        {task ? (
                            <div className="space-y-1">
                                <div className="text-[10px] text-white font-bold">#{task.serialNo || task.rowNumber}</div>
                                <div className="text-[10px] text-gray-400 line-clamp-3">{task.requirementZh || '暂无任务文案'}</div>
                                <div className="text-[9px] text-violet-300">{task.visualSpec?.targetAspectRatio || task.size || '未指定尺寸'}</div>
                            </div>
                        ) : (
                            <div className="text-[10px] text-gray-500">未连接任务时，将按当前配置输出通用风格约束。</div>
                        )}
                    </div>

                    <div className="rounded-2xl border border-[#2a2a3a] bg-[#0b0b0f] p-3">
                        <div className="flex items-center gap-2 mb-2">
                            <Palette size={10} className="text-violet-400" />
                            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">风格摘要</span>
                        </div>
                        <div className="space-y-1">
                            <div className="text-[10px] text-white font-bold">{data.config.styleName || '未命名风格'}</div>
                            <div className="text-[10px] text-gray-400 line-clamp-3">{output?.summary || '运行后会输出结构化风格提示词。'}</div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-violet-500/10 bg-violet-500/[0.03] p-2.5">
                        <div className="text-[8px] font-black text-violet-300 uppercase tracking-widest mb-1">配色 / 质量</div>
                        <div className="text-[10px] text-gray-400 line-clamp-4">
                            {[...paletteList, ...qualityList].join(' · ') || '未设置'}
                        </div>
                    </div>
                    <div className="rounded-xl border border-rose-500/10 bg-rose-500/[0.03] p-2.5">
                        <div className="text-[8px] font-black text-rose-300 uppercase tracking-widest mb-1">负面 / 连贯</div>
                        <div className="text-[10px] text-gray-400 line-clamp-4">
                            {[...consistencyList, ...negativeList].join(' · ') || '未设置'}
                        </div>
                    </div>
                </div>

                {output?.stylePrompt && (
                    <div className="rounded-2xl border border-violet-500/10 bg-violet-500/[0.03] p-3 space-y-2">
                        <div className="text-[8px] font-black text-violet-300 uppercase tracking-widest">风格输出预览</div>
                        <div className="text-[10px] text-gray-400 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                            {output.stylePrompt}
                        </div>
                    </div>
                )}
            </div>

            <div className="absolute -right-[3px] top-[38%] -translate-y-1/2 group/out">
                <Handle
                    type="source"
                    position={Position.Right}
                    id="style"
                    className="!w-3 !h-3 !bg-violet-500 !border-2 !border-[#0b0b0f] !static translate-y-0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-violet-400 uppercase tracking-widest opacity-0 group-hover/out:opacity-100 transition-opacity whitespace-nowrap bg-[#0b0b0f] px-1 rounded pointer-events-none">风格约束</span>
            </div>

            <div className="absolute -right-[3px] top-[62%] -translate-y-1/2 group/out">
                <Handle
                    type="source"
                    position={Position.Right}
                    id="prompt"
                    className="!w-3 !h-3 !bg-fuchsia-500 !border-2 !border-[#0b0b0f] !static translate-y-0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-fuchsia-400 uppercase tracking-widest opacity-0 group-hover/out:opacity-100 transition-opacity whitespace-nowrap bg-[#0b0b0f] px-1 rounded pointer-events-none">提示词片段</span>
            </div>
        </BaseNode>
    );
};
