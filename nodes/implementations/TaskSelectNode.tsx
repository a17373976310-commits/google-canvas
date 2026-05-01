import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Image as ImageIcon, List, Sparkles, Rows3 } from 'lucide-react';
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
            <div className="flex flex-col py-2">
                <div className="relative flex items-center h-8 px-4 group/row">
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="tasks"
                        className={`!w-3 !h-3 !border-2 !border-[#0b0b0f] !left-[-7px] transition-colors ${data.inputs?.tasks || data.inputs?.default ? '!bg-emerald-500' : '!bg-[#2a2a3a] group-hover/row:!bg-emerald-400'}`}
                    />
                    <div className="flex items-center gap-2 opacity-60 group-hover/row:opacity-100 transition-opacity">
                        <List size={10} className="text-emerald-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">任务列表</span>
                    </div>
                </div>
            </div>

            <div className="px-4 pb-4 space-y-3 flex-1 overflow-hidden">
                <label className="block space-y-1">
                    <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">任务序号</span>
                    <input
                        type="number"
                        min={1}
                        className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-teal-500/50"
                        value={taskIndex}
                        onChange={(e) => updateNodeData(id, { config: { ...data.config, taskIndex: Math.max(1, Number(e.target.value || 1)) } })}
                    />
                </label>

                <div className="rounded-2xl border border-[#2a2a3a] bg-[#0b0b0f] p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">选择状态</span>
                        <span className="text-[9px] text-teal-300">
                            {totalTasks > 0 ? `共 ${totalTasks} 条` : '等待任务列表'}
                        </span>
                    </div>

                    {output?.task ? (
                        <>
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black text-white">#{output.task.serialNo || output.task.rowNumber}</span>
                                <span className="text-[9px] text-gray-400">第 {output.selectedIndex} 条</span>
                            </div>
                            <div className="text-[10px] text-gray-400 line-clamp-2">
                                {output.task.requirementZh || '当前任务没有中文需求'}
                            </div>
                            {output.task.textLayers.length > 0 && (
                                <div className="text-[9px] text-blue-300 truncate" title={output.task.textLayers.join(' / ')}>
                                    {output.task.textLayers.join(' / ')}
                                </div>
                            )}
                            <div className="flex items-center gap-2 text-[9px] text-gray-500">
                                <span>{output.task.visualSpec?.targetAspectRatio || output.task.size || '未填尺寸'}</span>
                                <span>参考图 {output.task.referenceImageCount}</span>
                            </div>
                        </>
                    ) : (
                        <div className="text-[10px] text-gray-500">运行后会显示当前选中的任务</div>
                    )}
                </div>

                <div className="rounded-2xl border border-[#2a2a3a] bg-[#0b0b0f] p-3 min-h-[96px]">
                    <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">输出提示词</div>
                    <div className="text-[10px] text-gray-400 whitespace-pre-wrap break-all line-clamp-5">
                        {output?.prompt || '运行后这里会显示发送给出图节点的提示词'}
                    </div>
                </div>
            </div>

            <div className="border-t border-white/5 py-2">
                <div className="relative flex items-center h-8 px-4 group/out">
                    <div className="flex items-center gap-2 opacity-70 group-hover/out:opacity-100 transition-opacity">
                        <Sparkles size={10} className="text-blue-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">提示词</span>
                    </div>
                    <Handle
                        type="source"
                        position={Position.Right}
                        id="prompt"
                        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-[#0b0b0f] !right-[-7px]"
                    />
                </div>
                <div className="relative flex items-center h-8 px-4 group/out">
                    <div className="flex items-center gap-2 opacity-70 group-hover/out:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-orange-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">参考图</span>
                    </div>
                    <Handle
                        type="source"
                        position={Position.Right}
                        id="image"
                        className="!w-3 !h-3 !bg-orange-500 !border-2 !border-[#0b0b0f] !right-[-7px]"
                    />
                </div>
                <div className="relative flex items-center h-8 px-4 group/out">
                    <div className="flex items-center gap-2 opacity-70 group-hover/out:opacity-100 transition-opacity">
                        <Rows3 size={10} className="text-teal-400" />
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">任务对象</span>
                    </div>
                    <Handle
                        type="source"
                        position={Position.Right}
                        id="task"
                        className="!w-3 !h-3 !bg-teal-500 !border-2 !border-[#0b0b0f] !right-[-7px]"
                    />
                </div>
            </div>
        </BaseNode>
    );
};
