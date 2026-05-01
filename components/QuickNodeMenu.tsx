import React from 'react';
import { NodeType } from '../types';
import { Search } from 'lucide-react';
import { NODE_CATALOG } from '../config/nodeCatalog';

interface QuickNodeMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onPick: (type: NodeType) => void;
}

export const QuickNodeMenu: React.FC<QuickNodeMenuProps> = ({ isOpen, x, y, onClose, onPick }) => {
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setActiveIndex(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NODE_CATALOG;
    return NODE_CATALOG.filter((item) => item.label.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)));
  }, [query]);

  if (!isOpen) return null;

  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <div
        className="absolute z-50 w-[320px] md:w-[360px] rounded-2xl border border-[#2a2a3a] bg-[#0d0d13]/97 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b border-[#1e1e2d]">
          <div className="flex items-center gap-2 rounded-xl border border-[#2a2a3a] bg-black/40 px-3 py-2">
            <Search size={14} className="text-gray-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIndex((i) => (i + 1) % Math.max(1, list.length));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIndex((i) => (i - 1 + Math.max(1, list.length)) % Math.max(1, list.length));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const pick = list[activeIndex] || list[0];
                  if (pick) {
                    onPick(pick.type);
                    onClose();
                  }
                } else if (e.key === 'Escape') {
                  onClose();
                }
              }}
              placeholder="输入节点名，回车创建"
              className="w-full bg-transparent border-none outline-none text-xs text-gray-300 placeholder:text-gray-700"
            />
          </div>
          <p className="text-[9px] text-gray-600 mt-2">双击/右键画布可快速调出，回车即可创建节点</p>
        </div>

        <div className="max-h-[340px] overflow-y-auto custom-scrollbar p-2 space-y-1.5">
          {list.length === 0 && (
            <div className="py-8 text-center text-gray-700 text-xs">没有匹配节点</div>
          )}
          {list.map((item, index) => {
            const Icon = item.icon;
            const isActive = index === activeIndex;
            return (
              <button
                key={item.type}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onPick(item.type);
                  onClose();
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center gap-3 ${isActive ? 'bg-indigo-500/12 border-indigo-500/30' : 'bg-[#11111a] border-[#1e1e2d] hover:border-[#2f2f46]'}`}
              >
                <div className={`p-2 rounded-lg bg-black/40 ${item.color}`}>
                  <Icon size={13} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-gray-200 truncate">{item.label}</p>
                  <p className="text-[9px] text-gray-600 truncate">{item.keywords.join(' / ')}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
