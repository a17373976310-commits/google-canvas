import React from 'react';
import { NodeResizer } from 'reactflow';
import { useStore } from '../store';
import { NodeData } from '../types';
import { Layers } from 'lucide-react';

interface GroupNodeProps {
    id: string;
    data: NodeData;
    selected?: boolean;
}

export const GroupNode: React.FC<GroupNodeProps> = ({ id, data, selected }) => {
    const updateNodeData = useStore((state) => state.updateNodeData);
    const color = data.config.color || '#4f46e5';

    return (
        <div className="group/frame relative w-full h-full">
            <NodeResizer
                isVisible={selected}
                minWidth={200}
                minHeight={150}
                lineStyle={{ borderStyle: 'solid', borderWidth: 2, borderColor: color }}
                handleStyle={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#0b0b0f', border: `2px solid ${color}` }}
            />

            {/* Frame Container */}
            <div
                className="absolute inset-0 rounded-3xl border-2 shadow-2xl transition-all duration-300 pointer-events-none"
                style={{
                    backgroundColor: `${color}05`,
                    borderColor: `${color}40`,
                    boxShadow: selected ? `0 0 40px ${color}15` : 'none'
                }}
            >
                {/* Header/Label Area */}
                <div
                    className="absolute -top-3 left-6 flex items-center gap-2 px-4 py-1.5 rounded-full border-2 border-inherit pointer-events-auto bg-[#0b0b0f] shadow-lg transition-transform group-hover/frame:scale-105"
                    style={{ borderColor: `${color}80` }}
                >
                    <Layers size={10} style={{ color: color }} />
                    <input
                        type="text"
                        value={data.label}
                        onChange={(e) => updateNodeData(id, { label: e.target.value })}
                        className="bg-transparent border-none outline-none text-[10px] font-black uppercase tracking-widest text-white/80 w-32 placeholder:text-gray-700"
                        placeholder="分组标题..."
                    />
                </div>

                {/* Decorative Corners */}
                <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 rounded-tl-3xl opacity-30" style={{ borderColor: color }} />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 rounded-br-3xl opacity-30" style={{ borderColor: color }} />
            </div>

            {/* Background Grid Pattern (Subtle) */}
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] rounded-3xl overflow-hidden">
                <div className="w-full h-full bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:20px_20px]" />
            </div>
        </div>
    );
};
