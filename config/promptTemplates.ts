export interface ProjectPromptTemplate {
  id: string;
  name: string;
  content: string;
  isLocked: boolean;
}

const PROJECT_TEMPLATE_MODULES = import.meta.glob('../提示词工程/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>;

const normalizeTemplateName = (name: string) => name.trim().toLowerCase();

export const PROJECT_PROMPT_TEMPLATES: ProjectPromptTemplate[] = Object.entries(PROJECT_TEMPLATE_MODULES)
  .map(([path, content]) => {
    const match = path.match(/([^/\\]+)\.txt$/i);
    const name = match?.[1] || path;
    return {
      id: `project-${name}`,
      name,
      content,
      isLocked: true,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

export const DEFAULT_CHAT_TEMPLATE_NAME = '万能电商';

export const getProjectPromptTemplateByName = (name: string) => {
  const normalized = normalizeTemplateName(name);
  return PROJECT_PROMPT_TEMPLATES.find((template) => normalizeTemplateName(template.name) === normalized);
};

export const DEFAULT_CHAT_PROMPT_TEMPLATE =
  getProjectPromptTemplateByName(DEFAULT_CHAT_TEMPLATE_NAME) || PROJECT_PROMPT_TEMPLATES[0] || null;
