export type ChatRole = 'user' | 'assistant';

export type ChatActionType =
  | 'none'
  | 'leave.open_fill'
  | 'form.open_fill'
  | 'open_workflow'
  | 'open_menu'
  | 'open_todo'
  | 'filter_list'
  | 'click_ui'
  | 'panel_minimize';

export interface ChatAction {
  type: ChatActionType;
  query: string;
  seq?: number;
}

export interface ChatPlan {
  reply: string;
  action: ChatAction;
  actions: ChatAction[];
}

export interface CandidateItem {
  type: 'workflow' | 'menu' | 'todo';
  id: string;
  title: string;
  subtitle?: string;
  code?: string;
  name?: string;
  theme?: string;
  rowIndex?: string | number | null;
  DisableStatus?: number;
}

export interface WorkflowRow {
  name: string;
  code: string;
  theme?: string;
  DisableStatus?: number;
  rowIndex?: string | number | null;
}

export interface AiSettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  workflowKeywords: string;
  menuKeywords: string;
  todoKeywords: string;
  habitEnabled?: boolean;
  habitBackendUrl?: string;
  habitExtensionToken?: string;
  waromUserId?: string;
  hasKey?: boolean;
}

export interface RunResult {
  status: string;
  message?: string;
  choices?: CandidateItem[];
  matches?: WorkflowRow[];
  names?: string[];
  reply?: string;
  action?: ChatAction;
  actions?: ChatAction[];
  stepMessages?: string[];
  runId?: number | null;
  plannedVia?: string;
  requiredReady?: boolean;
  missing?: string[];
  missingTitles?: string[];
  filled?: Record<string, string>;
}

export const MSG = {
  openOptions: 'warom-open-options',
  getSettings: 'warom-get-settings',
  aiDecide: 'warom-ai-decide',
  aiChat: 'warom-ai-chat',
  aiFillForm: 'warom-ai-fill-form',
  aiReflect: 'warom-ai-reflect',
  run: 'warom-run',
} as const;

export const SITE_PREFIX = 'https://test.warom-lighting.com/v2_debug_ouyang/';
export const LIST_HASH = '#/workflow/workflow-base/agent';
