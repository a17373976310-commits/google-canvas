
import React from 'react';
import { useStore } from '../store';
import { ModelModality, NodeType, NODE_MODALITIES } from '../types';
import { PromptTemplateManager } from './PromptTemplateManager';
import { SecurityModal } from './SecurityModal';
import { X, Settings2, Sliders, Type, Info, Copy, Check, Eye, EyeOff, Maximize2, Lock, Play } from 'lucide-react';
import { verifyVaultPassword } from '../config/security';
import { getModelCapabilities } from '../config/modelCapabilities';

export const PropertiesPanel = () => {
  const { nodes, selectedNodeId, updateNodeData, onSelectionChange, applyPromptTemplateToNode, isPromptVaultUnlocked, setPromptVaultUnlocked, pushNotice, apiProviders, activeProviderId, activeProviderIds } = useStore();
  const [copied, setCopied] = React.useState(false);
  const [showUnlockModal, setShowUnlockModal] = React.useState(false);

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const objectOutputPreview = React.useMemo(() => {
    const output = selectedNode?.data.output;
    if (!output || typeof output === 'string') return '';
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }, [selectedNode?.data.output]);

  if (!selectedNode) return null;

  const componentTypeLabel: Record<NodeType, string> = {
    [NodeType.INPUT]: '文本输入',
    [NodeType.IMAGE_UPLOAD]: '图片上传',
    [NodeType.MULTI_IMAGE_UPLOAD]: '多图上传',
    [NodeType.FILE_UPLOAD]: '文件上传',
    [NodeType.TABLE_PARSE]: '表格解析',
    [NodeType.TASK_SELECT]: '任务选择',
    [NodeType.BATCH_EXECUTE]: '批量执行',
    [NodeType.STYLE_GUIDE]: '风格参考',
    [NodeType.PRODUCT_IMAGE_MATCH]: '产品图匹配',
    [NodeType.AI_CHAT]: 'AI 对话',
    [NodeType.AI_IMAGE]: '图像生成',
    [NodeType.AI_AUDIO]: '音频生成',
    [NodeType.AI_VIDEO]: '视频生成',
    [NodeType.OUTPUT]: '结果输出',
    [NodeType.GROUP]: '分组',
  };

  const canRunSelectedNode = NODE_MODALITIES[selectedNode.data.type] === 'ai'
    || selectedNode.data.type === NodeType.TABLE_PARSE
    || selectedNode.data.type === NodeType.TASK_SELECT
    || selectedNode.data.type === NodeType.BATCH_EXECUTE;
  const currentModality: ModelModality = selectedNode.data.type === NodeType.AI_CHAT || selectedNode.data.type === NodeType.PRODUCT_IMAGE_MATCH
    ? 'chat'
    : selectedNode.data.type === NodeType.AI_AUDIO
      ? 'audio'
      : selectedNode.data.type === NodeType.AI_VIDEO
        ? 'video'
        : 'image';
  const activeProvider = apiProviders.find((provider) => provider.id === (activeProviderIds?.[currentModality] || activeProviderId));
  const capabilities = getModelCapabilities(selectedNode.data.config?.modelId, currentModality as any, activeProvider);
  const supportsImageSize = currentModality === 'image' && capabilities.supportsImageSize !== false;
  const imageSizeLabel = capabilities.imageSizeMeaning === 'resolution-and-clarity'
    ? '分辨率 / 清晰度'
    : '分辨率'
  const imageSizeHint = capabilities.imageSizeMeaning === 'resolution-and-clarity'
    ? "此模型会把这里的档位映射为供应商的清晰度参数。"
    : '';
  const isGptImage2Model = String(selectedNode.data.config?.modelId || '').toLowerCase().startsWith('gpt-image-2');

  const isPromptProtected = selectedNode.data.type === NodeType.AI_CHAT && !isPromptVaultUnlocked;
  const hasImageReferenceInput = selectedNode.data.type === NodeType.AI_IMAGE && !!selectedNode.data.inputs?.image;
  const isPromptConnected = !!selectedNode.data.inputs?.prompt;
  const resolvedImagePrompt = selectedNode.data.type === NodeType.AI_IMAGE
    ? String(selectedNode.data.inputs?.prompt ?? selectedNode.data.config.prompt ?? '')
    : '';
  const outputImages = Array.isArray(selectedNode.data.output)
    ? selectedNode.data.output.filter((img): img is string => typeof img === 'string' && img.trim().length > 0)
    : [];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    pushNotice('success', '已复制到剪贴板');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfigChange = (key: string, value: any) => {
    updateNodeData(selectedNode.id, {
      config: { ...selectedNode.data.config, [key]: value }
    });
  };

  return (
    <div className="w-80 bg-[#0f0f15] border-l border-[#1e1e2d] flex flex-col h-full z-10 shadow-[-20px_0_50px_rgba(0,0,0,0.5)] animate-in slide-in-from-right duration-300">
      <div className="flex items-center justify-between p-6 shrink-0 border-b border-white/5 bg-black/20">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/10 text-indigo-400 transition-all">
            <Settings2 size={18} />
          </div>
          <div>
            <h2 className="text-sm font-black text-white uppercase tracking-widest leading-none flex items-center gap-2">
              {selectedNode.data.label}
            </h2>
            <p className="text-[10px] text-gray-500 font-bold uppercase mt-1 tracking-tighter italic">
              {componentTypeLabel[selectedNode.data.type] || selectedNode.data.type} 节点属性
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canRunSelectedNode && (
            <button
              onClick={() => useStore.getState().executeSingleNode(selectedNode.id)}
              disabled={selectedNode.data.status === 'running' || !!selectedNode.data.isSkipped}
              className={`p-2 rounded-lg transition-all ${selectedNode.data.status === 'running' ? 'bg-indigo-500/10 text-indigo-400 animate-pulse' : 'bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white shadow-lg shadow-indigo-500/10'} disabled:opacity-20`}
              title="立即运行此节点"
            >
              <Play size={14} fill="currentColor" />
            </button>
          )}
          <button
            onClick={() => onSelectionChange(null)}
            className="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-all"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        <div className="p-6 space-y-8 relative">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-gray-500">
              <Info size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tighter">节点信息</span>
            </div>
            <div className="p-4 bg-[#161621] rounded-2xl border border-[#1e1e2d]">
              <span className="block text-[10px] text-gray-500 uppercase font-black">唯一 ID</span>
              <span className="block text-xs text-gray-300 font-mono mt-1 opacity-50">{selectedNode.id}</span>
              <span className="block text-[10px] text-gray-500 uppercase font-black mt-4">组件类型</span>
              <span className="block text-xs text-indigo-400 font-bold mt-1">{componentTypeLabel[selectedNode.data.type] || selectedNode.data.type}</span>
            </div>
          </div>

          <div className="space-y-6 relative">
            <div className="flex items-center gap-2 text-gray-500">
              <Sliders size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tighter">参数</span>
            </div>

            {selectedNode.data.type === NodeType.AI_CHAT && (
              <div className="space-y-4">
                <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 flex items-center gap-2 mb-4">
                  <Info size={12} className="text-indigo-400" />
                  <span className="text-[10px] text-gray-500">模型选择已移动到节点顶部菜单</span>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-[#1e1e2d] bg-[#11111a] px-3 py-2">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">提示词访问</div>
                    <div className="text-[10px] text-gray-600">
                      {isPromptVaultUnlocked ? '本次会话中提示词内容可见。' : '验证密码前，提示词内容将保持隐藏。'}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (isPromptVaultUnlocked) {
                        setPromptVaultUnlocked(false);
                        pushNotice('info', '提示词内容已重新隐藏');
                      } else {
                        setShowUnlockModal(true);
                      }
                    }}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all ${isPromptVaultUnlocked ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'}`}
                  >
                    {isPromptVaultUnlocked ? <EyeOff size={12} /> : <Eye size={12} />}
                    {isPromptVaultUnlocked ? '隐藏' : '解锁'}
                  </button>
                </div>

                <PromptTemplateManager
                  currentValue={isPromptProtected ? '' : (selectedNode.data.config.systemInstruction || '')}
                  onApply={(val) => applyPromptTemplateToNode(selectedNode.id, val)}
                  disabled={false}
                  manageDisabled={false}
                />

                <label className="block relative">
                  <span className="text-xs text-gray-400 font-medium mb-2 block">系统提示词（角色）</span>
                  {isPromptProtected && (
                    <div className="absolute inset-0 top-6 z-10 bg-black/60 backdrop-blur-sm rounded-xl flex items-center justify-center border border-rose-500/20">
                      <div className="text-center">
                        <Lock size={16} className="text-rose-500/60 mx-auto mb-1" />
                        <span className="text-[10px] text-rose-500 font-bold tracking-widest uppercase">提示词已加密</span>
                      </div>
                    </div>
                  )}
                  <textarea
                    className="w-full bg-[#0b0b0f] border border-[#1e1e2d] rounded-xl p-3 text-xs text-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-all h-32 resize-none"
                    placeholder="示例：你是一位专业文案助手..."
                    value={isPromptProtected ? '********（已加密）' : (selectedNode.data.config.systemInstruction || '')}
                    onChange={(e) => handleConfigChange('systemInstruction', e.target.value)}
                    disabled={isPromptProtected}
                  />
                </label>
              </div>
            )}

            {selectedNode.data.type === NodeType.INPUT && (
              <div className="space-y-4">
                <label className="block">
                  <span className="text-xs text-gray-400 font-medium mb-2 block">输入文本</span>
                  <textarea
                    className="w-full bg-[#0b0b0f] border border-[#1e1e2d] rounded-xl p-3 text-xs text-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-all h-32 resize-none"
                    value={selectedNode.data.config.prompt || ''}
                    onChange={(e) => handleConfigChange('prompt', e.target.value)}
                    disabled={false}
                  />
                </label>
              </div>
            )}

            {selectedNode.data.type === NodeType.AI_IMAGE && (
              <div className="space-y-6">
                <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 flex items-center gap-2 mb-2">
                  <Info size={12} className="text-indigo-400" />
                  <span className="text-[10px] text-gray-500">已启用 Nano-banana 提示词优化，用于结构与风格渲染</span>
                </div>



                <div className="space-y-3">
                  <span className="text-xs text-gray-400 font-medium block">画面比例</span>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { label: '1:1', value: '1:1' },
                      { label: '4:3', value: '4:3' },
                      { label: '3:4', value: '3:4' },
                      { label: '16:9', value: '16:9' },
                      { label: '9:16', value: '9:16' },
                      { label: '2:3', value: '2:3' },
                      { label: '3:2', value: '3:2' },
                      { label: '4:5', value: '4:5' },
                      { label: '5:4', value: '5:4' },
                      { label: '21:9', value: '21:9' },
                      { label: '1:4', value: '1:4' },
                      { label: '4:1', value: '4:1' },
                      { label: '1:8', value: '1:8' },
                      { label: '8:1', value: '8:1' },
                    ]
                      .filter(ratio => !capabilities.allowedAspectRatios || capabilities.allowedAspectRatios.includes(ratio.value))
                      .map((ratio) => {
                        const isExtreme = ['21:9', '1:4', '4:1', '1:8', '8:1'].includes(ratio.value);
                        const extremeLabel: Record<string, string> = {
                          '21:9': '宽幅', '1:4': '超高', '4:1': '超宽',
                          '1:8': '极高', '8:1': '极宽'
                        };
                        return (
                          <button
                            key={ratio.value}
                            onClick={() => handleConfigChange('aspectRatio', ratio.value)}
                            className={`h-10 rounded-lg border transition-all flex flex-col items-center justify-center ${(selectedNode.data.config.aspectRatio || '1:1') === ratio.value
                              ? 'bg-indigo-500 border-indigo-400 text-white shadow-[0_4px_12px_rgba(99,102,241,0.3)]'
                              : 'bg-[#0b0b0f] border-[#1e1e2d] text-gray-500 hover:border-gray-500'
                              }`}
                            title={ratio.value}
                            disabled={false}
                          >
                            <span className="text-[10px] font-black">{ratio.label}</span>
                            {isExtreme && extremeLabel[ratio.value] && <span className="text-[6px] opacity-70 mt-0.5 scale-90">{extremeLabel[ratio.value]}</span>}
                          </button>
                        );
                      })}
                  </div>
                </div>

                {supportsImageSize && (
                  <div className="space-y-3 pt-2 border-t border-[#1e1e2d]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-400 font-medium block">{imageSizeLabel}</span>
                      {imageSizeHint && <span className="text-[9px] text-cyan-400">{imageSizeHint}</span>}
                    </div>
                    <div className="flex gap-2">
                      {[
                        { label: '512', value: '512px', desc: '预览' },
                        { label: '1K', value: '1K', desc: '标准' },
                        { label: '2K', value: '2K', desc: '高清' },
                        { label: '4K', value: '4K', desc: '超高清' },
                      ]
                        .filter(size => !capabilities.allowedImageSizes || capabilities.allowedImageSizes.includes(size.value))
                        .map((q) => (
                          <button
                            key={q.value}
                            onClick={() => handleConfigChange('imageSize', q.value)}
                            className={`flex-1 px-3 py-3 rounded-xl border transition-all text-left ${(selectedNode.data.config.imageSize || '1K') === q.value
                              ? 'bg-indigo-500 border-indigo-400 text-white shadow-[0_4px_12px_rgba(99,102,241,0.2)]'
                              : 'bg-[#0b0b0f] border-[#1e1e2d] text-gray-500 hover:border-gray-500'
                              }`}
                            disabled={false}
                          >
                            <span className="block text-[10px] font-black">{q.label}</span>
                            <span className="block text-[7px] opacity-50 uppercase font-mono">{q.desc}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {isGptImage2Model && (
                  <div className="space-y-3 pt-2 border-t border-[#1e1e2d]">
                    <span className="text-xs text-gray-400 font-medium block">质量</span>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: '自动', value: 'auto' },
                        { label: '低', value: 'low' },
                        { label: '中', value: 'medium' },
                        { label: '高', value: 'high' },
                      ].map((quality) => (
                        <button
                          key={quality.value}
                          onClick={() => handleConfigChange('imageQuality', quality.value)}
                          className={`px-2 py-3 rounded-xl border transition-all text-center ${(selectedNode.data.config.imageQuality || 'auto') === quality.value
                            ? 'bg-orange-500 border-orange-400 text-white shadow-[0_4px_12px_rgba(249,115,22,0.2)]'
                            : 'bg-[#0b0b0f] border-[#1e1e2d] text-gray-500 hover:border-gray-500'
                            }`}
                          disabled={false}
                        >
                          <span className="block text-[10px] font-black">{quality.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3 pt-2 border-t border-[#1e1e2d]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400 font-medium block">图像提示词</span>
                    <span className={`text-[9px] font-bold ${isPromptConnected ? 'text-amber-400' : 'text-gray-600'}`}>
                      {isPromptConnected ? '已连接上游提示词，下方显示实际使用内容' : '默认使用本地提示词'}
                    </span>
                  </div>
                  <textarea
                    className="w-full bg-[#0b0b0f] border border-[#1e1e2d] rounded-xl p-3 text-xs text-gray-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 outline-none transition-all h-24 resize-none"
                    placeholder={isPromptConnected
                      ? '当前提示词会自动从上游注入...'
                      : '在这里输入图像提示词；未连接提示词节点时将使用它...'}
                    value={isPromptConnected ? resolvedImagePrompt : (selectedNode.data.config.prompt || '')}
                    onChange={(e) => handleConfigChange('prompt', e.target.value)}
                    disabled={isPromptConnected}
                  />
                </div>
              </div>
            )}

            {selectedNode.data.type === NodeType.AI_VIDEO && (
              <div className="space-y-6">
                <div className="p-3 bg-rose-500/5 rounded-xl border border-rose-500/10 flex items-center gap-2 mb-2">
                  <Info size={12} className="text-rose-400" />
                  <span className="text-[10px] text-gray-500">视频生成通常需要 1-3 分钟，请耐心等待</span>
                </div>

                <div className="space-y-3">
                  <span className="text-xs text-gray-400 font-medium block">视频比例</span>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: '16:9', value: '16:9', desc: '横屏' },
                      { label: '9:16', value: '9:16', desc: '竖屏' },
                      { label: '1:1', value: '1:1', desc: '方形' },
                    ]
                      .filter(ratio => !capabilities.allowedAspectRatios || capabilities.allowedAspectRatios.includes(ratio.value))
                      .map((ratio) => (
                        <button
                          key={ratio.value}
                          onClick={() => handleConfigChange('aspectRatio', ratio.value)}
                          className={`px-3 py-3 rounded-xl border transition-all text-center ${(selectedNode.data.config.aspectRatio || '16:9') === ratio.value
                            ? 'bg-rose-500 border-rose-400 text-white shadow-[0_4px_12px_rgba(244,63,94,0.3)]'
                            : 'bg-[#0b0b0f] border-[#1e1e2d] text-gray-500 hover:border-gray-500'
                            }`}
                          disabled={false}
                        >
                          <span className="block text-[10px] font-black">{ratio.label}</span>
                          <span className="block text-[7px] opacity-50 uppercase">{ratio.desc}</span>
                        </button>
                      ))}
                  </div>
                </div>

                {capabilities.allowedDurations && capabilities.allowedDurations.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-[#1e1e2d]">
                    <span className="text-xs text-gray-400 font-medium block">视频时长</span>
                    <div className="flex gap-2">
                      {[
                        { label: '5s', value: '5', desc: '短' },
                        { label: '10s', value: '10', desc: '标准' },
                        { label: '15s', value: '15', desc: '长' },
                        { label: '25s', value: '25', desc: '加长' },
                      ]
                        .filter(d => capabilities.allowedDurations!.includes(d.value))
                        .map((d) => (
                          <button
                            key={d.value}
                            onClick={() => handleConfigChange('duration', d.value)}
                            className={`flex-1 px-3 py-3 rounded-xl border transition-all text-center ${(selectedNode.data.config.duration || '5') === d.value
                              ? 'bg-rose-500 border-rose-400 text-white shadow-[0_4px_12px_rgba(244,63,94,0.2)]'
                              : 'bg-[#0b0b0f] border-[#1e1e2d] text-gray-500 hover:border-gray-500'
                              }`}
                            disabled={false}
                          >
                            <span className="block text-[10px] font-black">{d.label}</span>
                            <span className="block text-[7px] opacity-50 uppercase">{d.desc}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {selectedNode.data.config?.modelId === 'sora-2-pro' && (
                  <div className="space-y-3 pt-2 border-t border-[#1e1e2d]">
                    <span className="text-xs text-gray-400 font-medium block">高清模式</span>
                    <button
                      onClick={() => handleConfigChange('hd', !selectedNode.data.config.hd)}
                      className={`w-full px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${selectedNode.data.config.hd
                        ? 'bg-rose-500 border-rose-400 text-white shadow-[0_4px_12px_rgba(244,63,94,0.2)]'
                        : 'bg-[#0b0b0f] border-[#1e1e2d] text-gray-500 hover:border-gray-500'
                        }`}
                      disabled={false}
                    >
                      <span className="text-[10px] font-black">HD</span>
                      <span className={`text-[10px] font-bold ${selectedNode.data.config.hd ? 'text-white' : 'text-gray-600'}`}>
                        {selectedNode.data.config.hd ? '开启' : '关闭'}
                      </span>
                    </button>
                  </div>
                )}

                <div className="space-y-3 pt-2 border-t border-[#1e1e2d]">
                  <span className="text-xs text-gray-400 font-medium block">视频提示词</span>
                  <textarea
                    className="w-full bg-[#0b0b0f] border border-[#1e1e2d] rounded-xl p-3 text-xs text-gray-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20 outline-none transition-all h-24 resize-none"
                    placeholder="描述你想生成的视频...（也可以由上游提示词节点传入）"
                    value={selectedNode.data.config.prompt || ''}
                    onChange={(e) => handleConfigChange('prompt', e.target.value)}
                    disabled={false}
                  />
                </div>
              </div>
            )}
          </div>

          {(selectedNode.data.output || selectedNode.data.config.prompt) && (
            <div className="space-y-4 pt-8 border-t border-[#1e1e2d] animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-500">
                  <Eye size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-tighter">输出预览</span>
                </div>
                {((typeof selectedNode.data.output === 'string' && !selectedNode.data.output.startsWith('http'))
                  || (typeof selectedNode.data.output === 'object' && selectedNode.data.output)) && (
                    <button
                      onClick={() => handleCopy(typeof selectedNode.data.output === 'string' ? (selectedNode.data.output as string) : objectOutputPreview)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/5 text-[9px] font-bold text-indigo-400 transition-colors"
                    >
                      {copied ? <Check size={10} /> : <Copy size={10} />}
                      {copied ? '已复制' : '复制'}
                    </button>
                  )}
              </div>

              {(selectedNode.data.type === NodeType.AI_CHAT || selectedNode.data.type === NodeType.INPUT) && (
                <div className="group relative">
                  <div className="w-full bg-[#0b0b0f] border border-[#1e1e2d] rounded-2xl p-4 text-[11px] text-gray-400 leading-relaxed max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-indigo-500/20 hover:scrollbar-thumb-indigo-500/40 transition-all font-medium whitespace-pre-wrap selection:bg-indigo-500/30">
                    {selectedNode.data.output || selectedNode.data.config.prompt || '暂无内容...'}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#0b0b0f] to-transparent rounded-b-2xl pointer-events-none opacity-50" />
                </div>
              )}

              {selectedNode.data.type !== NodeType.AI_CHAT
                && selectedNode.data.type !== NodeType.INPUT
                && typeof selectedNode.data.output === 'object'
                && selectedNode.data.output
                && !Array.isArray(selectedNode.data.output) && (
                  <div className="group relative">
                    <pre className="w-full bg-[#0b0b0f] border border-[#1e1e2d] rounded-2xl p-4 text-[10px] text-gray-400 leading-relaxed max-h-64 overflow-auto whitespace-pre-wrap break-all scrollbar-thin scrollbar-thumb-indigo-500/20 hover:scrollbar-thumb-indigo-500/40 transition-all font-mono selection:bg-indigo-500/30">
                      {objectOutputPreview}
                    </pre>
                    <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#0b0b0f] to-transparent rounded-b-2xl pointer-events-none opacity-50" />
                  </div>
                )}

              {selectedNode.data.type === NodeType.MULTI_IMAGE_UPLOAD && outputImages.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[9px] text-gray-500 font-black uppercase tracking-wider">{outputImages.length} 项</div>
                  <div className="grid grid-cols-3 gap-2">
                    {outputImages.map((img, idx) => (
                      <button
                        key={`${selectedNode.id}-preview-${idx}`}
                        type="button"
                        className="relative overflow-hidden rounded-xl border border-[#1e1e2d] bg-[#0b0b0f] hover:border-indigo-500/40 transition-colors"
                        onClick={() => {
                          (window as any).openLightbox?.(img);
                        }}
                        title={`查看第 ${idx + 1} 项`}
                      >
                        <img
                          src={img}
                          alt={`输出 ${idx + 1}`}
                          className="w-full aspect-square object-cover"
                        />
                        <span className="absolute bottom-1 right-1 text-[8px] font-black text-white/80 bg-black/60 px-1 rounded">{idx + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(selectedNode.data.type === NodeType.AI_IMAGE ||
                selectedNode.data.type === NodeType.IMAGE_UPLOAD) && typeof selectedNode.data.output === 'string' && selectedNode.data.output && (
                  <div
                    className="relative group cursor-zoom-in overflow-hidden rounded-2xl border border-[#1e1e2d] bg-[#0b0b0f]"
                    onClick={() => {
                      if (selectedNode.data.output) {
                        (window as any).openLightbox?.(selectedNode.data.output as string);
                      }
                    }}
                  >
                    <>
                      <img
                        src={selectedNode.data.output as string}
                        alt="输出预览"
                        className="w-full aspect-auto min-h-[100px] object-contain transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                          <Maximize2 size={24} className="text-white" />
                          <span className="text-[10px] text-white font-bold tracking-widest uppercase">打开大图预览</span>
                        </div>
                      </div>
                    </>
                  </div>
                )}

              {selectedNode.data.type === NodeType.AI_VIDEO && typeof selectedNode.data.output === 'string' && selectedNode.data.output && (
                <div className="relative group overflow-hidden rounded-2xl border border-[#1e1e2d] bg-[#0b0b0f]">
                  <video
                    src={selectedNode.data.output}
                    controls
                    className="w-full aspect-video object-contain"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showUnlockModal && selectedNode.data.type === NodeType.AI_CHAT && (
        <SecurityModal
          onClose={() => setShowUnlockModal(false)}
          onVerify={(pass) => {
            const ok = verifyVaultPassword(pass);
            if (ok) {
              setPromptVaultUnlocked(true);
              pushNotice('success', '提示词内容已解锁');
            } else {
              pushNotice('error', '密码错误');
            }
            return ok;
          }}
          title="提示词访问"
          hint="输入密码以查看提示词内容"
        />
      )}

      <div className="p-6 bg-[#0b0b0f] border-t border-[#1e1e2d] shrink-0">
        <div className="flex items-center gap-3 text-[10px] text-gray-600">
          <Type size={14} />
          <span>状态：{{
            'idle': '空闲',
            'running': '运行中',
            'success': '成功',
            'error': '错误'
          }[selectedNode.data.status]}</span>
        </div>
      </div>
    </div>
  );
};
