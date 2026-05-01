import React from 'react';
import { useStore } from '../store';
import { X, CheckCircle2, AlertTriangle, Info, OctagonX } from 'lucide-react';

const styleMap = {
  info: {
    box: 'bg-blue-500/10 border-blue-500/30 text-blue-200',
    icon: Info,
    iconClass: 'text-blue-400'
  },
  success: {
    box: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
    icon: CheckCircle2,
    iconClass: 'text-emerald-400'
  },
  warn: {
    box: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    icon: AlertTriangle,
    iconClass: 'text-amber-400'
  },
  error: {
    box: 'bg-rose-500/10 border-rose-500/30 text-rose-200',
    icon: OctagonX,
    iconClass: 'text-rose-400'
  }
} as const;

export const NoticeStack: React.FC = () => {
  const { notices, removeNotice } = useStore();

  if (notices.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] w-[calc(100vw-24px)] max-w-xl space-y-2 pointer-events-none">
      {notices.map((notice) => {
        const config = styleMap[notice.level];
        const Icon = config.icon;
        return (
          <div
            key={notice.id}
            className={`pointer-events-auto border rounded-2xl px-4 py-3 backdrop-blur-xl shadow-2xl flex items-start gap-3 ${config.box}`}
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${config.iconClass}`} />
            <p className="text-xs font-bold tracking-tight leading-relaxed flex-1">{notice.message}</p>
            <button
              onClick={() => removeNotice(notice.id)}
              className="p-1 rounded-lg hover:bg-black/20 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};
