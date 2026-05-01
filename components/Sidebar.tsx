import React from 'react';
import { NodeType } from '../types';
import { useStore } from '../store';
import {
  Zap,
  Layers,
  Database,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { ModelHub } from './ModelHub';
import { NODE_CATALOG } from '../config/nodeCatalog';

export const Sidebar = () => {
  const { addNode } = useStore();

  const handleDragStart = (event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="z-10 flex h-full w-80 flex-col overflow-hidden border-r border-[#1e1e2d] bg-[#0f0f15] font-sans shadow-2xl">
      <div className="border-b border-[#1e1e2d] bg-gradient-to-b from-indigo-500/5 to-transparent p-8 pb-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 shadow-[0_0_30px_rgba(79,70,229,0.4)]">
            <Zap className="fill-white text-white" size={24} />
          </div>
          <div>
            <h1 className="leading-none text-xl font-black tracking-tight text-white">AI CANVAS</h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Neural Engine Ready
            </p>
          </div>
        </div>
      </div>

      <div className="scrollbar-hide flex flex-1 flex-col space-y-10 overflow-y-auto px-6 py-4">
        <div className="shrink-0">
          <h3 className="mb-6 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
            <Layers size={14} className="text-indigo-500" /> Components
          </h3>
          <div className="flex flex-col gap-4">
            {NODE_CATALOG.map((node) => (
              <div
                key={node.type}
                className="group scale-100 cursor-grab rounded-2xl border border-[#1e1e2d] bg-[#161621] p-5 shadow-xl transition-all hover:scale-[1.02] hover:border-indigo-500/30 hover:bg-[#1c1c2b] active:cursor-grabbing"
                onDragStart={(event) => handleDragStart(event, node.type)}
                draggable
                onClick={() => addNode(node.type, { x: 300, y: 300 })}
              >
                <div className="flex items-center gap-5">
                  <div className={`rounded-2xl bg-black/40 p-4 shadow-inner transition-all group-hover:bg-indigo-600 group-hover:text-white ${node.color}`}>
                    <node.icon size={24} />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <h3 className="text-sm font-black tracking-tight text-white transition-colors group-hover:text-indigo-400">
                      {node.label}
                    </h3>
                    <p className="mt-1.5 text-[8px] font-medium uppercase tracking-widest leading-tight text-gray-500 opacity-70 transition-colors group-hover:text-gray-400">
                      {node.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <h3 className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
            <Database size={14} className="text-indigo-500" /> Model Hub
          </h3>
          <div className="min-h-0 flex-1">
            <ModelHub />
          </div>
        </div>
      </div>

      <div className="border-t border-[#1e1e2d] bg-[#0b0b0f] p-6">
        <button
          onClick={() => (window as any).openApiSettings()}
          className="group flex w-full items-center justify-between rounded-2xl border border-[#1e1e2d] bg-[#161621] p-4 transition-all hover:bg-[#1c1c2b]"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-400 transition-all group-hover:bg-indigo-500 group-hover:text-white">
              <Settings size={16} />
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-gray-400 group-hover:text-white">
              API Settings
            </span>
          </div>
          <ChevronRight size={14} className="text-gray-700 transition-transform group-hover:translate-x-1" />
        </button>
      </div>
    </aside>
  );
};
