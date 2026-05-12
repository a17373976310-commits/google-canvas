import React, { useEffect, useState } from 'react';
import { Save, Upload, Trash2, FileText, X, Lock, ChevronDown, Check } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { PROJECT_PROMPT_TEMPLATES } from '../config/promptTemplates';

export interface PromptTemplate {
    id: string;
    name: string;
    content: string;
    isLocked?: boolean;
}

const normalizeTemplateName = (name: string) => name.trim().toLowerCase();

const mergeTemplates = (localTemplates: PromptTemplate[]): PromptTemplate[] => {
    const seenNames = new Set(PROJECT_PROMPT_TEMPLATES.map((template) => normalizeTemplateName(template.name)));
    const dedupedLocal = localTemplates.filter((template) => {
        const normalized = normalizeTemplateName(template.name);
        if (seenNames.has(normalized)) return false;
        seenNames.add(normalized);
        return true;
    });
    return [...PROJECT_PROMPT_TEMPLATES, ...dedupedLocal];
};

interface PromptTemplateManagerProps {
    currentValue: string;
    onApply: (value: string) => void;
    disabled?: boolean;
    manageDisabled?: boolean;
}

export const PromptTemplateManager: React.FC<PromptTemplateManagerProps> = ({
    currentValue,
    onApply,
    disabled = false,
    manageDisabled = false
}) => {
    const [templates, setTemplates] = useState<PromptTemplate[]>([]);
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [showSaveInput, setShowSaveInput] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('prompt_templates');
        if (saved) {
            setTemplates(mergeTemplates(JSON.parse(saved)));
        } else {
            setTemplates(PROJECT_PROMPT_TEMPLATES);
        }
    }, []);

    useEffect(() => {
        const normalizedCurrent = currentValue.trim();
        if (!normalizedCurrent) return;
        const matched = templates.find((template) => template.content.trim() === normalizedCurrent);
        if (matched && matched.id !== selectedTemplateId) {
            setSelectedTemplateId(matched.id);
        }
    }, [currentValue, templates, selectedTemplateId]);

    useEffect(() => {
        if (disabled || manageDisabled) {
            setIsExpanded(false);
            setShowSaveInput(false);
        }
    }, [disabled, manageDisabled]);

    const persistTemplates = (newTemplates: PromptTemplate[]) => {
        const customTemplates = newTemplates.filter((template) => !template.isLocked);
        localStorage.setItem('prompt_templates', JSON.stringify(customTemplates));
        setTemplates(mergeTemplates(customTemplates));
    };

    const handleSave = () => {
        if (disabled || manageDisabled || !saveName.trim() || !currentValue.trim()) return;

        const newTemplate: PromptTemplate = {
            id: uuidv4(),
            name: saveName.trim(),
            content: currentValue,
            isLocked: false
        };

        persistTemplates([...templates, newTemplate]);
        setSaveName('');
        setShowSaveInput(false);
        setSelectedTemplateId(newTemplate.id);
    };

    const handleDelete = (id: string, event: React.MouseEvent) => {
        if (disabled || manageDisabled) return;
        event.stopPropagation();
        const newTemplates = templates.filter((template) => template.id !== id);
        persistTemplates(newTemplates);
        if (selectedTemplateId === id) setSelectedTemplateId(null);
    };

    const handleSelect = (template: PromptTemplate) => {
        if (disabled) return;
        setSelectedTemplateId(template.id);
        onApply(template.content);
        setIsExpanded(false);
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled || manageDisabled) return;
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            const content = loadEvent.target?.result as string;
            const newTemplate: PromptTemplate = {
                id: uuidv4(),
                name: file.name.replace(/\.txt$/i, ''),
                content,
                isLocked: false
            };
            persistTemplates([...templates, newTemplate]);
            setSelectedTemplateId(newTemplate.id);
            onApply(content);
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

    return (
        <div className="flex flex-col gap-3 rounded-2xl border theme-border-subtle theme-bg-secondary p-1">
            <div className="flex items-center justify-between border-b theme-border-medium px-3 py-2">
                <div className="flex items-center gap-2">
                    <FileText size={14} className="text-emerald-500" />
                    <span className="text-[10px] font-black uppercase tracking-wider theme-text-secondary">Prompt Templates</span>
                </div>

                <div className="flex items-center gap-1">
                    <label
                        className={`rounded-lg p-1.5 theme-text-muted transition-colors ${(disabled || manageDisabled) ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:theme-bg-tertiary hover:text-indigo-400'}`}
                        title="Upload template (.txt)"
                    >
                        <Upload size={12} />
                        <input type="file" accept=".txt" className="hidden" onChange={handleFileUpload} disabled={disabled || manageDisabled} />
                    </label>
                    <button
                        onClick={() => {
                            if (!disabled && !manageDisabled) setShowSaveInput(true);
                        }}
                        disabled={disabled || manageDisabled}
                        className={`rounded-lg p-1.5 theme-text-muted transition-colors ${(disabled || manageDisabled) ? 'cursor-not-allowed opacity-40' : 'hover:theme-bg-tertiary hover:text-emerald-400'}`}
                        title="Save current content as template"
                    >
                        <Save size={12} />
                    </button>
                </div>
            </div>

            {showSaveInput && (
                <div className="animate-in slide-in-from-top-2 px-3 pb-2 duration-200">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={saveName}
                            onChange={(event) => setSaveName(event.target.value)}
                            placeholder="Template name..."
                            className="flex-1 rounded-lg border theme-border-medium theme-bg-input px-2 py-1.5 text-xs theme-text-primary outline-none focus:border-emerald-500"
                            autoFocus
                            disabled={disabled || manageDisabled}
                        />
                        <button onClick={handleSave} className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-500 hover:bg-emerald-500/30">
                            <Check size={12} />
                        </button>
                        <button onClick={() => setShowSaveInput(false)} className="p-1.5 theme-text-muted hover:theme-text-primary">
                            <X size={12} />
                        </button>
                    </div>
                </div>
            )}

            <div className="relative px-3 pb-2">
                <button
                    onClick={() => {
                        if (!disabled) setIsExpanded(!isExpanded);
                    }}
                    disabled={disabled}
                    className={`group flex w-full items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors ${disabled ? 'cursor-not-allowed theme-border-medium theme-bg-node-content theme-text-muted' : 'theme-border-medium theme-bg-input theme-text-primary hover:border-emerald-500/50'}`}
                >
                    <div className="flex items-center gap-2 truncate">
                        {selectedTemplate ? (
                            <>
                                {selectedTemplate.isLocked ? <Lock size={10} className="theme-text-muted" /> : <FileText size={10} className="text-emerald-500" />}
                                <span className="truncate">{selectedTemplate.name}</span>
                            </>
                        ) : (
                            <span className="italic theme-text-muted">Choose a template...</span>
                        )}
                    </div>
                    <ChevronDown size={12} className={`theme-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isExpanded && (
                    <div className="absolute left-0 right-0 top-full z-50 mx-3 mt-1 max-h-48 overflow-y-auto overflow-x-hidden rounded-xl border theme-border-medium theme-bg-tertiary shadow-2xl">
                        {templates.map((template) => (
                            <div
                                key={template.id}
                                onClick={() => handleSelect(template)}
                                className="group flex cursor-pointer items-center justify-between px-3 py-2 hover:theme-bg-tertiary"
                            >
                                <div className="flex items-center gap-2 truncate">
                                    {template.isLocked && <Lock size={10} className="theme-text-muted" />}
                                    <span className={`truncate text-xs ${selectedTemplateId === template.id ? 'font-bold text-emerald-400' : 'theme-text-secondary'}`}>
                                        {template.name}
                                    </span>
                                </div>
                                {!template.isLocked && (
                                    <button
                                        onClick={(event) => handleDelete(template.id, event)}
                                        className="rounded p-1 theme-text-muted opacity-0 transition-colors group-hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-400"
                                    >
                                        <Trash2 size={10} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {selectedTemplate && (
                <div className="px-3 pb-2">
                    <div className="flex items-center gap-1 text-[10px] theme-text-muted">
                        <Check size={10} className="text-emerald-500" />
                        <span>Template applied to the editor below.</span>
                    </div>
                </div>
            )}

            {disabled ? (
                <div className="px-3 pb-2">
                    <div className="flex items-center gap-1 text-[10px] text-rose-500">
                        <Lock size={10} />
                        <span>Node is locked. Unlock it before switching templates.</span>
                    </div>
                </div>
            ) : manageDisabled ? (
                <div className="px-3 pb-2">
                    <div className="flex items-center gap-1 text-[10px] text-amber-400">
                        <Lock size={10} />
                        <span>Template switching is allowed, but template management is locked.</span>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
