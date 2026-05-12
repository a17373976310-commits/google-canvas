import React from 'react';
import { NodeProps } from 'reactflow';
import { List, Rows3 } from 'lucide-react';
import { BaseNode } from '../BaseNode';
import { NodeData, SpreadsheetParseOutput, TaskSelectionOutput } from '../../types';
import { useStore } from '../../store';

export const TaskSelectNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    const output = data.output as TaskSelectionOutput | undefined;
    const upstream = (data.inputs?.tasks ?? data.inputs?.default) as SpreadsheetParseOutput | undefined;
    const totalTasks = output?.totalTasks ?? (Array.isArray(upstream?.tasks) ? upstream.tasks.length : 0);
    const taskIndex = Math.max(1, Number(data.config.taskIndex || 1));

    return (
        <BaseNode id={id} data={data} icon={Rows3} color="bg-teal-500" selected={selected}>
            <div className="p-4 space-y-3 flex-1 overflow-hidden">
                <div className={`inline-flex w-fit items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold ${data.inputs?.tasks || data.inputs?.default ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'theme-border-subtle theme-text-muted'}`}>
                    <List size={10} />
                    任务列表
                </div>
                <label className="block space-y-1">
                    <span className="text-[8px] font-black theme-text-muted uppercase tracking-widest">任务序号</span>
                    <input
                        type="number"
                        min={1}
                        className="w-full theme-bg-input border theme-border-medium rounded-xl px-3 py-2 text-[11px] theme-text-primary focus:outline-none focus:border-teal-500/50"
                        value={taskIndex}
                        onChange={(e) => updateNodeData(id, { config: { ...data.config, taskIndex: Math.max(1, Number(e.target.value || 1)) } })}
                    />
                </label>

                <div className="rounded-2xl border theme-border-medium theme-bg-input p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest theme-text-secondary">选择状态</span>
                        <span className="text-[9px] text-teal-300">
                            {totalTasks > 0 ? `共 ${totalTasks} 条` : '等待任务列表'}
                        </span>
                    </div>

                    {output?.task ? (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black text-white">#{output.task.serialNo || output.task.rowNumber}</span>
                                <span className="text-[9px] theme-text-secondary">第 {output.selectedIndex} 条</span>
                            </div>
                            <div className="text-[10px] theme-text-secondary line-clamp-2">
                                {output.task.requirementZh || '当前任务没有中文需求'}
                            </div>
                            {output.task.textLayers.length > 0 && (
                                <div className="text-[9px] text-blue-300 truncate" title={output.task.textLayers.join(' / ')}>
                                    {output.task.textLayers.join(' / ')}
                                </div>
                            )}
                            <div className="flex items-center gap-2 text-[9px] theme-text-muted">
                                <span>{output.task.visualSpec?.targetAspectRatio || output.task.size || '未填尺寸'}</span>
                                <span>参考图 {output.task.referenceImageCount}</span>
                            </div>
                        </>
                    ) : (
                        <div className="text-[10px] theme-text-muted">运行后会显示当前选中的任务</div>
                    )}
                </div>

                <div className="rounded-2xl border theme-border-medium theme-bg-input p-3 min-h-[96px]">
                    <div className="text-[9px] font-black uppercase tracking-widest theme-text-secondary mb-2">输出提示词</div>
                    <div className="text-[10px] theme-text-secondary whitespace-pre-wrap break-all line-clamp-5">
                        {output?.prompt || '运行后这里会显示发送给出图节点的提示词'}
                    </div>
                </div>
            </div>

        </BaseNode>
    );
};
