import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
    AlertTriangle,
    Brain,
    FileSpreadsheet,
    Files,
    List,
    Sparkles
} from 'lucide-react';
import { BaseNode } from '../BaseNode';
import { NodeData, SpreadsheetParseOutput } from '../../types';
import { useStore } from '../../store';

const DEFAULT_TEXT_COLUMNS = 'E,F,G';
const PREVIEW_LIMIT = 10;

const PARSE_MODE_LABELS: Record<string, string> = {
    auto: '自动兜底',
    smart: '智能拆解',
    standard: '标准解析'
};

const PARSE_MODE_HELP: Record<string, string> = {
    auto: '优先用视觉智能拆解；失败或无结果时自动回退到列解析。',
    smart: '把表格截图交给当前对话模型理解，适合复杂合并单元格/电商任务表。',
    standard: '完全按下面的列号抽取，最快、最稳定，适合规整表格。'
};

export const TableParseNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    const currentChatModelId = useStore((state) => state.globalActiveModels.chat || '');
    const activeProviderId = useStore((state) => state.activeProviderId);
    const activeProviderIds = useStore((state) => state.activeProviderIds);
    const apiProviders = useStore((state) => state.apiProviders);

    const output = data.output as SpreadsheetParseOutput | undefined;
    const warnings = Array.isArray(output?.warnings) ? output.warnings : [];
    const tasks = Array.isArray(output?.tasks) ? output.tasks : [];
    const [showAllTasks, setShowAllTasks] = React.useState(false);

    const parseMode = String(data.config.parseMode || 'auto');
    const activeParseMode = output?.parseMode || parseMode;
    const fallbackSmartModelId = String(data.config.smartModelId || data.config.modelId || '');
    const effectiveSmartModelId = currentChatModelId || fallbackSmartModelId;
    const activeProviderName = React.useMemo(
        () => apiProviders.find((provider) => provider.id === (activeProviderIds?.chat || activeProviderId))?.name || '当前推理供货商',
        [activeProviderId, activeProviderIds?.chat, apiProviders]
    );
    const sheetCount = Math.max(1, Number(output?.sheetCount || output?.sheetNames?.length || 1));
    const multiSheet = sheetCount > 1;
    const summarySheetName = output?.sheetName || String(data.config.sheetName || 'auto');

    React.useEffect(() => {
        setShowAllTasks(false);
    }, [tasks.length, output?.runId]);

    const setConfig = React.useCallback((patch: Record<string, any>) => {
        updateNodeData(id, {
            config: {
                ...data.config,
                ...patch
            }
        });
    }, [data.config, id, updateNodeData]);

    const previewTasks = showAllTasks ? tasks : tasks.slice(0, PREVIEW_LIMIT);
    const hasMoreTasks = tasks.length > PREVIEW_LIMIT;
    const modelStateLabel = currentChatModelId
        ? '跟随全局对话模型'
        : effectiveSmartModelId
            ? '使用节点保存模型'
            : '未配置模型';

    return (
        <BaseNode id={id} data={data} icon={FileSpreadsheet} color="bg-emerald-500" selected={selected}>
            <div className="flex flex-col py-2">
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="file"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${data.inputs?.file || data.inputs?.default ? '!bg-fuchsia-500' : '!bg-[#2a2a3a] group-hover/row:!bg-fuchsia-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-70 group-hover/row:opacity-100 transition-opacity">
                        <FileSpreadsheet size={10} className="text-fuchsia-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">表格文件</span>
                    </div>
                </div>
            </div>

            <div className="px-4 pb-4 space-y-3 flex-1 overflow-hidden">
                <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.04] p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-emerald-300">
                            <FileSpreadsheet size={12} />
                            <span>解析设置</span>
                        </div>
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[8px] font-black text-emerald-200">
                            {PARSE_MODE_LABELS[activeParseMode] || activeParseMode}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                            <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">工作表</span>
                            <input
                                className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-emerald-500/50"
                                value={data.config.sheetName ?? 'auto'}
                                onChange={(e) => setConfig({ sheetName: e.target.value || 'auto' })}
                                placeholder="auto / all / 工作表名"
                            />
                        </label>
                        <label className="space-y-1">
                            <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">解析模式</span>
                            <select
                                className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-emerald-500/50"
                                value={parseMode}
                                onChange={(e) => setConfig({ parseMode: e.target.value })}
                            >
                                <option value="auto">自动兜底</option>
                                <option value="smart">智能拆解</option>
                                <option value="standard">标准解析</option>
                            </select>
                        </label>
                    </div>
                    <div className="text-[9px] text-gray-500 leading-relaxed">
                        {PARSE_MODE_HELP[parseMode] || PARSE_MODE_HELP.auto}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">数据起始行</span>
                        <input
                            type="number"
                            min={1}
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-emerald-500/50"
                            value={data.config.dataStartRow ?? 3}
                            onChange={(e) => setConfig({ dataStartRow: Number(e.target.value || 3) })}
                        />
                    </label>
                    <label className="space-y-1">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">需求列</span>
                        <input
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-emerald-500/50 uppercase"
                            value={data.config.requirementColumn ?? 'D'}
                            onChange={(e) => setConfig({ requirementColumn: e.target.value.toUpperCase() || 'D' })}
                            placeholder="D"
                        />
                    </label>
                    <label className="space-y-1 col-span-2">
                        <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">文案列</span>
                        <input
                            className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-emerald-500/50 uppercase"
                            value={data.config.textColumns ?? DEFAULT_TEXT_COLUMNS}
                            onChange={(e) => setConfig({ textColumns: e.target.value.toUpperCase() || DEFAULT_TEXT_COLUMNS })}
                            placeholder={DEFAULT_TEXT_COLUMNS}
                        />
                    </label>
                </div>

                {(parseMode === 'smart' || parseMode === 'auto') && (
                    <div className="rounded-2xl border border-indigo-500/15 bg-indigo-500/[0.05] p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-indigo-300">
                                <Sparkles size={12} />
                                <span>智能拆解</span>
                            </div>
                            <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[8px] font-black text-indigo-200">
                                {modelStateLabel}
                            </span>
                        </div>

                        <div className="rounded-xl border border-white/5 bg-[#0b0b0f] px-3 py-2">
                            <div className="text-[11px] font-bold text-white break-all">
                                {effectiveSmartModelId || '请先在左侧模型库选择一个对话模型'}
                            </div>
                            <div className="mt-1 text-[9px] text-gray-500">
                                当前提供商：{activeProviderName}。智能拆解需要对话模型支持图片输入；不确定时建议使用“自动兜底”。
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <label className="space-y-1">
                                <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">每张截图行数</span>
                                <input
                                    type="number"
                                    min={6}
                                    className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-indigo-500/50"
                                    value={data.config.smartRowsPerSnapshot ?? 18}
                                    onChange={(e) => setConfig({ smartRowsPerSnapshot: Number(e.target.value || 18) })}
                                />
                            </label>
                            <label className="space-y-1">
                                <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">截图最大列数</span>
                                <input
                                    type="number"
                                    min={4}
                                    className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-indigo-500/50"
                                    value={data.config.smartMaxColumns ?? 12}
                                    onChange={(e) => setConfig({ smartMaxColumns: Number(e.target.value || 12) })}
                                />
                            </label>
                        </div>

                        <label className="space-y-1 block">
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">补充说明</span>
                            <textarea
                                className="w-full h-20 resize-none bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-indigo-500/50"
                                value={data.config.smartParseNotes ?? ''}
                                onChange={(e) => setConfig({ smartParseNotes: e.target.value })}
                                placeholder="例如：按任务编号拆分；保留完整中文文案；不要把说明页当任务。"
                            />
                        </label>
                    </div>
                )}

                <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.04] p-3 space-y-2">
                    <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-emerald-300">
                        <Files size={12} />
                        <span>解析摘要</span>
                    </div>
                    {output ? (
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div className="rounded-xl border border-white/5 bg-[#0b0b0f] px-3 py-2">
                                <div className="text-gray-500">工作表</div>
                                <div
                                    className="text-white font-bold truncate"
                                    title={Array.isArray(output.sheetNames) && output.sheetNames.length > 0 ? output.sheetNames.join(' / ') : output.sheetName}
                                >
                                    {summarySheetName}
                                </div>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-[#0b0b0f] px-3 py-2">
                                <div className="text-gray-500">任务数</div>
                                <div className="text-white font-bold">{output.taskCount}</div>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-[#0b0b0f] px-3 py-2">
                                <div className="text-gray-500">跳过行</div>
                                <div className="text-white font-bold">{output.skippedRows}</div>
                            </div>
                            <div className="rounded-xl border border-white/5 bg-[#0b0b0f] px-3 py-2">
                                <div className="text-gray-500">模式</div>
                                <div className="text-white font-bold">{PARSE_MODE_LABELS[activeParseMode] || activeParseMode}</div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-[10px] text-gray-500">运行后会显示任务数、工作表和解析模式。</div>
                    )}

                    {output?.parseModelId && (
                        <div className="inline-flex items-center gap-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-1 text-[9px] text-indigo-200">
                            <Brain size={10} />
                            <span>{output.parseModelId}</span>
                        </div>
                    )}
                </div>

                <div className="rounded-2xl border border-[#2a2a3a] bg-[#0b0b0f] p-3 min-h-[140px] max-h-[320px] overflow-auto">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-gray-400">
                            <List size={12} />
                            <span>任务预览</span>
                        </div>
                        {hasMoreTasks && (
                            <button
                                type="button"
                                className="text-[9px] font-black text-emerald-300 hover:text-emerald-200 transition-colors"
                                onClick={() => setShowAllTasks((prev) => !prev)}
                            >
                                {showAllTasks ? '收起' : `展开全部 (${tasks.length})`}
                            </button>
                        )}
                    </div>
                    {tasks.length > 0 ? (
                        <div className="space-y-2">
                            {previewTasks.map((task, previewIndex) => (
                                <div key={task.taskId} className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-black text-white">
                                            第 {previewIndex + 1} 条
                                            <span className="ml-1 text-gray-500 font-semibold">#{task.serialNo || task.rowNumber}</span>
                                        </span>
                                        <div className="flex items-center gap-2 flex-wrap justify-end">
                                            {multiSheet && (
                                                <span className="text-[8px] px-1.5 py-0.5 rounded border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
                                                    {task.source.sheetName}
                                                </span>
                                            )}
                                            {task.parseMode && task.parseMode !== 'standard' && (
                                                <span className="text-[8px] px-1.5 py-0.5 rounded border border-indigo-500/20 bg-indigo-500/10 text-indigo-300">
                                                    {PARSE_MODE_LABELS[task.parseMode] || task.parseMode}
                                                </span>
                                            )}
                                            {typeof task.confidence === 'number' && (
                                                <span className="text-[8px] px-1.5 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                                                    置信 {Math.round(task.confidence * 100)}%
                                                </span>
                                            )}
                                            {task.embeddedImages.length > 0 && (
                                                <span className="text-[8px] px-1.5 py-0.5 rounded border border-orange-500/20 bg-orange-500/10 text-orange-300">
                                                    图片 {task.embeddedImages.length}
                                                </span>
                                            )}
                                            <span className="text-[9px] text-emerald-300">
                                                {task.visualSpec?.targetAspectRatio || task.size || '未填尺寸'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="mt-1 text-[10px] text-gray-400 line-clamp-3">
                                        {task.requirementZh || '当前任务没有解析到可用需求'}
                                    </div>
                                    {task.textLayers.length > 0 && (
                                        <div className="mt-1 text-[9px] text-blue-300" title={task.textLayers.join(' / ')}>
                                            文案：{task.textLayers.join(' / ')}
                                        </div>
                                    )}
                                    {task.sourceRange && (
                                        <div className="mt-1 text-[9px] text-gray-500">
                                            来源：{task.sourceRange}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-[10px] text-gray-600">
                            暂无解析结果
                        </div>
                    )}
                </div>

                {warnings.length > 0 && (
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                        <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-amber-300">
                            <AlertTriangle size={12} />
                            <span>提示</span>
                        </div>
                        <div className="space-y-1">
                            {warnings.slice(0, 4).map((warning, index) => (
                                <div key={`${id}-warning-${index}`} className="text-[10px] text-amber-200/80">
                                    {warning}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="absolute -right-[3px] top-1/2 -translate-y-1/2 group/out">
                <Handle
                    type="source"
                    position={Position.Right}
                    id="output"
                    className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-[#0b0b0f] !static translate-y-0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[8px] font-black text-emerald-400 uppercase tracking-widest opacity-0 group-hover/out:opacity-100 transition-opacity whitespace-nowrap bg-[#0b0b0f] px-1 rounded pointer-events-none">
                    任务数据
                </span>
            </div>
        </BaseNode>
    );
};
