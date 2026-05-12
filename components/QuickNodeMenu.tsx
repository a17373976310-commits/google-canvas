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
        className="canvas-quick-node-menu absolute z-50 w-[320px] md:w-[360px] rounded-2xl border theme-border-medium theme-bg-overlay shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b theme-border-subtle">
          <div className="canvas-quick-search flex items-center gap-2 rounded-xl border theme-border-medium bg-black/40 px-3 py-2">
            <Search size={14} className="theme-text-muted" />
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
              className="w-full bg-transparent border-none outline-none text-xs theme-text-primary theme-placeholder-muted"
            />
          </div>
          <p className="text-[9px] theme-text-muted mt-2">双击/右键画布可快速调出，回车即可创建节点</p>
        </div>

        <div className="max-h-[340px] overflow-y-auto custom-scrollbar p-2 space-y-1.5">
          {list.length === 0 && (
            <div className="py-8 text-center theme-text-disabled text-xs">没有匹配节点</div>
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
                className={`canvas-quick-node-item w-full text-left px-3 py-2.5 rounded-xl border transition-all flex items-center gap-3 ${isActive ? 'bg-indigo-500/12 border-indigo-500/30' : 'theme-bg-secondary theme-border-subtle hover:theme-border-medium'}`}
              >
                <div className={`p-2 rounded-lg bg-black/40 ${item.color}`}>
                  <Icon size={13} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold theme-text-primary truncate">{item.label}</p>
                  <p className="text-[9px] theme-text-muted truncate">{item.keywords.join(' / ')}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
