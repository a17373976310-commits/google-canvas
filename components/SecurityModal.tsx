
import React, { useState } from 'react';
import { Lock, Unlock, X, ShieldAlert, Key } from 'lucide-react';

interface SecurityModalProps {
    onClose: () => void;
    onVerify: (password: string) => boolean;
    title?: string;
    hint?: string;
}

export const SecurityModal: React.FC<SecurityModalProps> = ({ onClose, onVerify, title, hint }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState(false);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (onVerify(password)) {
            onClose();
        } else {
            setError(true);
            setPassword('');
            setTimeout(() => setError(false), 2000);
        }
    };

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className={`w-full max-w-sm theme-bg-secondary border ${error ? 'border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.3)]' : 'border-indigo-500/30'} rounded-3xl overflow-hidden shadow-2xl transition-all`}>
                {/* Header */}
                <div className="p-6 text-center border-b border-white/5">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-500/10 mb-4">
                        {error ? <ShieldAlert className="text-rose-500 animate-bounce" size={32} /> : <Lock className="text-indigo-400" size={32} />}
                    </div>
                    <h3 className="text-lg font-black text-white uppercase tracking-widest">{title || '核心权限验证'}</h3>
                    <p className="text-[10px] theme-text-muted mt-2 font-bold uppercase tracking-tighter">
                        {hint || '该区域已被开发者加锁，请输入授权密码访问'}
                    </p>
                </div>

                {/* Input */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="relative">
                        <Key className="absolute left-4 top-1/2 -translate-y-1/2 theme-text-muted" size={16} />
                        <input
                            type="password"
                            autoFocus
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full theme-bg-input border theme-border-subtle rounded-2xl py-4 pl-12 pr-4 text-center text-xl font-mono tracking-[0.5em] focus:border-indigo-500 outline-none transition-all placeholder:theme-text-disabled placeholder:tracking-normal"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 theme-text-secondary font-bold text-xs uppercase tracking-widest transition-all"
                        >
                            取消
                        </button>
                        <button
                            type="submit"
                            className="py-3 px-4 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20"
                        >
                            验证授权
                        </button>
                    </div>
                </form>

                {/* Footer */}
                <div className="p-4 bg-black/20 text-center">
                    <span className="text-[8px] theme-text-muted font-black uppercase tracking-[0.2em]">
                        Secure Pipeline Authorization Protocol v3.0
                    </span>
                </div>
            </div>
        </div>
    );
};
