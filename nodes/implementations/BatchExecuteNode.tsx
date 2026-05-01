import React from 'react';
import { Handle, NodeProps, Position } from 'reactflow';
import { Clock3, Layers, List, Rows3 } from 'lucide-react';
import { BaseNode } from '../BaseNode';
import { BatchExecutionOutput, NodeData, SpreadsheetParseOutput } from '../../types';
import { useStore } from '../../store';

const PREVIEW_LIMIT = 10;

const getBatchStagePresentation = (data: NodeData) => {
  const stage = data.meta?.stage;

  if (stage === 'expanded' || data.meta?.readyToRun) {
    return {
      label: '已展开，待批量生成',
      className: 'text-amber-300 border-amber-500/20 bg-amber-500/10'
    };
  }

  if (stage === 'running' || data.status === 'running') {
    return {
      label: '批量生成中',
      className: 'text-cyan-300 border-cyan-500/20 bg-cyan-500/10'
    };
  }

  if (stage === 'completed') {
    return {
      label: '批量生成完成',
      className: 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10'
    };
  }

  return {
    label: '等待展开',
    className: 'text-gray-300 border-white/10 bg-white/[0.03]'
  };
};

export const BatchExecuteNode: React.FC<NodeProps<NodeData>> = ({ id, data, selected }) => {
  const updateNodeData = useStore((state) => state.updateNodeData);
  const output = data.output as BatchExecutionOutput | undefined;
  const upstream = (data.inputs?.tasks ?? data.inputs?.default) as SpreadsheetParseOutput | undefined;
  const totalTasks = output?.totalTasks ?? (Array.isArray(upstream?.tasks) ? upstream.tasks.length : 0);
  const selectedCount = output?.selectedCount ?? 0;
  const createdCount = Math.max(0, Number(data.meta?.createdCount || 0));
  const successCount = Math.max(0, Number(data.meta?.successCount || 0));
  const failedCount = Math.max(0, Number(data.meta?.failedCount || 0));
  const startIndex = Math.max(1, Number(data.config.startIndex || 1));
  const endIndex = Math.max(0, Number(data.config.endIndex || 0));
  const stagePresentation = getBatchStagePresentation(data);
  const [showAllItems, setShowAllItems] = React.useState(false);

  React.useEffect(() => {
    setShowAllItems(false);
  }, [output?.runId, output?.items?.length]);

  const items = Array.isArray(output?.items) ? output.items : [];
  const previewItems = showAllItems ? items : items.slice(0, PREVIEW_LIMIT);
  const hasMoreItems = items.length > PREVIEW_LIMIT;

  return (
    <BaseNode id={id} data={data} icon={Layers} color="bg-cyan-500" selected={selected}>
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
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-2">
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-500">当前阶段</div>
            <div className="mt-1 text-[11px] text-white font-semibold">{stagePresentation.label}</div>
          </div>
          <div className={`rounded-full border px-3 py-1 text-[9px] font-black ${stagePresentation.className}`}>
            {stagePresentation.label}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">开始序号</span>
            <input
              type="number"
              min={1}
              inputMode="numeric"
              className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-cyan-500/50"
              value={startIndex}
              onChange={(e) => updateNodeData(id, {
                config: {
                  ...data.config,
                  startIndex: Math.max(1, Number(e.target.value || 1))
                }
              })}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[8px] font-black text-gray-500 uppercase tracking-widest">结束序号</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className="w-full bg-[#0b0b0f] border border-[#2a2a3a] rounded-xl px-3 py-2 text-[11px] text-gray-300 focus:outline-none focus:border-cyan-500/50"
              value={endIndex}
              onChange={(e) => updateNodeData(id, {
                config: {
                  ...data.config,
                  endIndex: Math.max(0, Number(e.target.value || 0))
                }
              })}
              placeholder="0 = 全部"
            />
          </label>
        </div>

        <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.03] px-3 py-3">
          <div className="text-[9px] font-black uppercase tracking-widest text-cyan-300">运行方式</div>
          <div className="mt-2 text-[10px] leading-5 text-gray-400">
            第一次运行会按当前范围把任务展开成多个图像生成节点；第二次运行才会批量触发这些已展开的节点。
            如果还没连接生图模板，系统会先自动补一个默认图像生成节点。
          </div>
        </div>

        <div className="rounded-2xl border border-[#2a2a3a] bg-[#0b0b0f] p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">批量概览</span>
            <span className="text-[10px] text-gray-500">总任务 {totalTasks}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-2 py-2">
              <div className="text-gray-500">开始</div>
              <div className="text-white font-black">{startIndex}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-2 py-2">
              <div className="text-gray-500">结束</div>
              <div className="text-white font-black">{endIndex > 0 ? endIndex : '全部'}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-2 py-2">
              <div className="text-gray-500">选中</div>
              <div className="text-cyan-300 font-black">{selectedCount}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-2 py-2">
              <div className="text-gray-500">已展开</div>
              <div className="text-purple-300 font-black">{createdCount}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-2 py-2">
              <div className="text-gray-500">成功</div>
              <div className="text-emerald-300 font-black">{successCount}</div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] px-2 py-2">
              <div className="text-gray-500">失败</div>
              <div className="text-rose-300 font-black">{failedCount}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#2a2a3a] bg-[#0b0b0f] p-3 min-h-[120px] max-h-[260px] overflow-auto">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-gray-400">
              <Rows3 size={12} />
              <span>任务预览</span>
            </div>
            {hasMoreItems && (
              <button
                type="button"
                className="text-[9px] font-black text-cyan-300 hover:text-cyan-200 transition-colors"
                onClick={() => setShowAllItems((prev) => !prev)}
              >
                {showAllItems ? '收起' : `展开全部 (${items.length})`}
              </button>
            )}
          </div>
          {items.length > 0 ? (
            <div className="space-y-2">
              {previewItems.map((item) => (
                <div key={item.batchId} className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black text-white">
                      第 {item.selectedIndex} 条{item.variantLabel ? ` · ${item.variantLabel}` : ''}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-emerald-300">
                        {item.visualSpec?.targetAspectRatio || item.task.visualSpec?.targetAspectRatio || item.task.size || '未设尺寸'}
                      </span>
                      <span className="text-[9px] text-cyan-300">{item.images.length} 张参考图</span>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-gray-400 line-clamp-2">
                    {item.prompt || '当前任务没有可用于出图的提示词内容'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-[10px] text-gray-600">
              运行后这里会显示本次批量任务的预览内容
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/5 py-2">
        <div className="relative flex items-center h-8 px-4 group/out">
          <div className="flex items-center gap-2 opacity-70 group-hover/out:opacity-100 transition-opacity">
            <Clock3 size={10} className="text-cyan-400" />
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">生图模板</span>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="batch"
            className="!w-3 !h-3 !bg-cyan-500 !border-2 !border-[#0b0b0f] !right-[-7px]"
          />
        </div>
      </div>
    </BaseNode>
  );
};
