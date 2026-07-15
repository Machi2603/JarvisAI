import type { AgentTemplate } from '../../lib/api';

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'error'
  | 'archived'
  | 'needs_attention'
  | 'budget_exceeded'
  | 'stalled';

export const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: 'var(--color-success)',
  running: 'var(--color-accent)',
  paused: 'var(--color-text-tertiary)',
  error: 'var(--color-error)',
  archived: 'var(--color-text-tertiary)',
  needs_attention: 'var(--color-warning)',
  budget_exceeded: 'var(--color-warning)',
  stalled: 'var(--color-warning)',
};

export function statusColor(s: string): string {
  return STATUS_COLOR[s as AgentStatus] || 'var(--color-text-tertiary)';
}

export function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: color + '20', color }}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <span
      className="w-2 h-2 rounded-full inline-block flex-shrink-0"
      style={{ background: color }}
      title={status}
    />
  );
}

export function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) return '—';
  return `$${cost.toFixed(4)}`;
}

export function formatRelativeTime(ts?: number | null): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts * 1000;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatSchedule(type?: string, value?: string): string {
  if (!type || type === 'manual') return 'Manual';
  if (type === 'cron' && value) {
    // Try to display human-readable for common cron patterns
    const parts = value.trim().split(/\s+/);
    if (parts.length === 5) {
      const [min, hour, , , dow] = parts;
      const hourNum = parseInt(hour, 10);
      const formatHour = (h: number) => {
        if (h === 0) return '12:00 AM';
        if (h < 12) return `${h}:00 AM`;
        if (h === 12) return '12:00 PM';
        return `${h - 12}:00 PM`;
      };
      // Daily pattern: 0 H * * *
      if (min === '0' && !isNaN(hourNum) && parts[2] === '*' && parts[3] === '*' && dow === '*') {
        return `Daily at ${formatHour(hourNum)}`;
      }
      // Weekly pattern: 0 H * * days
      if (min === '0' && !isNaN(hourNum) && parts[2] === '*' && parts[3] === '*' && dow !== '*') {
        const DAY_NAMES: Record<string, string> = { '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat', '7': 'Sun' };
        const dayList = dow.split(',').map(d => DAY_NAMES[d] || d).join(', ');
        return `Weekly on ${dayList} at ${formatHour(hourNum)}`;
      }
    }
    return `Cron: ${value}`;
  }
  if (type === 'cron') return 'Cron';
  if (type === 'interval' && value) {
    const total = parseInt(value);
    if (!isNaN(total) && total > 0) {
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const parts: string[] = [];
      if (h > 0) parts.push(`${h}h`);
      if (m > 0) parts.push(`${m}m`);
      if (s > 0) parts.push(`${s}s`);
      return `Every ${parts.join(' ') || '0s'}`;
    }
    return `Every ${value}`;
  }
  return type || 'Manual';
}

// Launch wizard data shared with its extracted controls.

export const CATEGORY_MAP: Record<string, string> = {
  communication: 'Communication',
  channel: 'Communication',
  search: 'Search & Browse',
  browser: 'Search & Browse',
  code: 'Code & Dev',
  system: 'Code & Dev',
  filesystem: 'Files & Data',
  memory: 'Memory & Knowledge',
  knowledge_graph: 'Memory & Knowledge',
  reasoning: 'Reasoning & AI',
  math: 'Reasoning & AI',
  inference: 'Reasoning & AI',
  agents: 'Reasoning & AI',
  media: 'Media',
};

export const TOOL_NAME_FALLBACK: Record<string, string> = {
  file_read: 'Files & Data',
  file_write: 'Files & Data',
  pdf_extract: 'Files & Data',
  db_query: 'Files & Data',
  http_request: 'Files & Data',
  apply_patch: 'Code & Dev',
  git_status: 'Code & Dev',
  git_diff: 'Code & Dev',
  git_log: 'Code & Dev',
  git_commit: 'Code & Dev',
  channel_send: 'Communication',
  channel_list: 'Communication',
  channel_status: 'Communication',
};

export const CATEGORY_ORDER = [
  'Communication', 'Search & Browse', 'Code & Dev', 'Files & Data',
  'Memory & Knowledge', 'Reasoning & AI', 'Media',
];

export const POPULAR_TOOLS = new Set([
  'slack', 'email', 'telegram', 'whatsapp',
  'web_search', 'browser',
  'code_interpreter', 'shell_exec', 'git_status', 'git_diff',
  'file_read', 'file_write', 'pdf_extract',
  'retrieval', 'memory_store',
  'think', 'llm', 'calculator',
  'image_generate',
]);

export const BROWSER_SUB_TOOLS = [
  'browser_navigate', 'browser_click', 'browser_type',
  'browser_screenshot', 'browser_extract', 'browser_axtree',
];

export function parseIntervalParts(val: string): { hours: number; minutes: number; seconds: number } {
  const total = parseInt(val) || 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return { hours, minutes, seconds };
}

export function serializeInterval(hours: number, minutes: number, seconds: number): string {
  return String(hours * 3600 + minutes * 60 + seconds);
}

export interface WizardState {
  step: 1 | 2;
  templateId: string;
  templateData: AgentTemplate | null;
  name: string;
  instruction: string;
  model: string;
  scheduleType: string;
  scheduleValue: string;
  selectedTools: string[];
  budget: string;
  routerPolicy: string;
  memoryExtraction: string;
  observationCompression: string;
  retrievalStrategy: string;
  taskDecomposition: string;
  maxTurns: number;
  temperature: number;
}


export const TEMPLATE_INSTRUCTIONS: Record<string, string> = {
  'daily-briefing': 'Every morning, give me a fun quote of the day, summarize my top important emails, list any meetings today from my calendar, and tell me the weather for [my city].',
  'daily_briefing': 'Every morning, give me a fun quote of the day, summarize my top important emails, list any meetings today from my calendar, and tell me the weather for [my city].',
  'research-monitor': 'Search for the latest news and papers on [your topic]. Summarize the top 3 most relevant findings and explain why they matter.',
  'research_monitor': 'Search for the latest news and papers on [your topic]. Summarize the top 3 most relevant findings and explain why they matter.',
  'code-reviewer': 'Review the latest commits in [repo]. Check for bugs, security issues, and style violations. Summarize findings with file paths and line numbers.',
  'code_reviewer': 'Review the latest commits in [repo]. Check for bugs, security issues, and style violations. Summarize findings with file paths and line numbers.',
  'meeting-prep': 'Before my next meeting, pull context from my emails, messages, and past meetings with the attendees. Summarize key topics and suggest talking points.',
  'meeting_prep': 'Before my next meeting, pull context from my emails, messages, and past meetings with the attendees. Summarize key topics and suggest talking points.',
  'personal_deep_research': 'Search across all my personal data — messages, emails, meetings, documents, and notes — to answer [my question]. Cite your sources.',
  'inbox_triager': 'Check my recent emails and messages. Categorize them by priority (urgent, important, FYI, spam). Summarize the top items I should act on.',
};

export function Tooltip({ text }: { text: string }) {
  return <span className="inline-block ml-1 cursor-help" style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }} title={text}>(?)</span>;
}

// ---------------------------------------------------------------------------
// ToolsPicker — dev-inventory style tool selector used by the launch wizard
// ---------------------------------------------------------------------------

export const TOOL_CATEGORY_ORDER = [
  'filesystem',
  'system',
  'code',
  'vcs',
  'storage',
  'memory',
  'knowledge',
  'knowledge_graph',
  'search',
  'network',
  'browser',
  'database',
  'data',
  'math',
  'reasoning',
  'inference',
  'media',
  'audio',
  'skill',
  'channel',
  'communication',
  'other',
];

export const TOOL_CATEGORY_LABELS: Record<string, string> = {
  filesystem: 'filesystem',
  system: 'shell & exec',
  code: 'code & repl',
  vcs: 'git',
  storage: 'memory · storage',
  memory: 'memory',
  knowledge: 'knowledge',
  knowledge_graph: 'knowledge graph',
  search: 'search',
  network: 'network',
  browser: 'browser',
  database: 'database',
  data: 'data',
  math: 'math',
  reasoning: 'reasoning',
  inference: 'inference',
  media: 'media',
  audio: 'audio',
  skill: 'skills',
  channel: 'channel primitives',
  communication: 'channels',
  other: 'other',
};
