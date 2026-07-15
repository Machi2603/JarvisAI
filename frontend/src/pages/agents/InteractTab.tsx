import { useEffect, useState, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { useAppStore } from '../../lib/store';
import {
  fetchManagedAgents,
  fetchAgentTasks,
  fetchAgentChannels,
  bindAgentChannel,
  unbindAgentChannel,
  fetchTemplates,
  createManagedAgent,
  pauseManagedAgent,
  resumeManagedAgent,
  deleteManagedAgent,
  runManagedAgent,
  recoverManagedAgent,
  askAgent,
  fetchLearningLog,
  triggerLearning,
  fetchAgentTraces,
  fetchAgentTrace,
  fetchManagedAgent,
  fetchAvailableTools,
  saveToolCredentials,
  fetchModels,
  updateManagedAgent,
  fetchRecommendedModel,
  sendblueVerify,
  sendblueRegisterWebhook,
  sendblueTest,
  sendblueHealth,
} from '../../lib/api';
import type { AgentTask, ChannelBinding, AgentTemplate, ManagedAgent, LearningLogEntry, AgentTrace, AgentTraceDetail, ToolInfo } from '../../lib/api';
import { useAgentEvents } from '../../lib/useAgentEvents';
import type { AgentEvent } from '../../lib/useAgentEvents';
import {
  Plus,
  Bot,
  Pause,
  Play,
  Trash2,
  ChevronLeft,
  ListTodo,
  Brain,
  Zap,
  MoreHorizontal,
  AlertTriangle,
  DollarSign,
  Activity,
  MessageSquare,
  Settings,
  FileText,
  X,
  ChevronRight,
  Send,
  RefreshCw,
  Wifi,
  Database,
  Copy,
  Check,
  Pencil,
  Loader2,
} from 'lucide-react';
import { SOURCE_CATALOG } from '../../types/connectors';
import type { ConnectRequest } from '../../types/connectors';
import { listConnectors, connectSource } from '../../lib/connectors-api';
import type { ToolCallInfo } from '../../types';
import { ToolCallCard } from '../../components/Chat/ToolCallCard';

// ---------------------------------------------------------------------------
import { formatCost, formatRelativeTime, formatSchedule, StatusBadge, StatusDot, statusColor } from './shared';
/** One entry in the live activity feed assembled from agent events. */
type LiveItem =
  | { kind: 'note'; id: string; label: string }
  | { kind: 'tool'; id: string; tool: ToolCallInfo };

/** Convert a persisted trace step into a ToolCallInfo for ToolCallCard. */
function stepToToolCall(
  step: AgentTraceDetail['steps'][number],
  idx: number,
): ToolCallInfo {
  const input = (step.input ?? {}) as { tool?: string; args?: unknown };
  const out = step.output as unknown;
  const result =
    typeof out === 'string'
      ? out
      : out && typeof out === 'object' && 'result' in out
        ? String((out as { result: unknown }).result ?? '')
        : out != null
          ? JSON.stringify(out)
          : '';
  const args = input.args;
  return {
    id: `step-${idx}`,
    tool: input.tool || step.step_type || 'step',
    arguments:
      typeof args === 'string' ? args : args != null ? JSON.stringify(args) : '',
    status: 'success',
    result,
    latency: step.duration ? step.duration * 1000 : undefined,
  };
}

// ---------------------------------------------------------------------------
// Interact tab — trace viewer (top) + follow-up chat (bottom).
//
// The chat input doesn't open a side-channel chat; it triggers a real ad-hoc
// agent run (execute_tick) with the user's question as input. The trace area
// shows that run live (tick + tool calls over the events WebSocket) and, when
// idle, the last run's trace steps plus the agent's resulting findings — so
// users can interrogate the agent about its work ("tell me more about X").
// ---------------------------------------------------------------------------
export function InteractTab({ agentId, agentStatus, onRunStateChange }: { agentId: string; agentStatus: string; onRunStateChange?: () => void }) {
  const [agent, setAgent] = useState<ManagedAgent | null>(null);
  const [activity, setActivity] = useState('');
  const [running, setRunning] = useState(agentStatus === 'running');
  const [liveItems, setLiveItems] = useState<LiveItem[]>([]);
  const [lastTrace, setLastTrace] = useState<AgentTraceDetail | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [question, setQuestion] = useState(''); // question driving the current/last run
  const [elapsedMs, setElapsedMs] = useState(0);

  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(running);
  runningRef.current = running;
  const bottomRef = useRef<HTMLDivElement>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Load idle snapshot: agent record (status + findings) and the latest trace.
  const loadIdle = useCallback(async () => {
    try {
      const a = await fetchManagedAgent(agentId);
      setAgent(a);
      setActivity(a.current_activity || '');
      try {
        const traces = await fetchAgentTraces(agentId, 1);
        if (traces.length > 0) {
          const detail = await fetchAgentTrace(agentId, traces[0].id);
          setLastTrace(detail);
        }
      } catch {
        /* trace store may be empty */
      }
    } catch {
      /* ignore */
    }
  }, [agentId]);

  useEffect(() => {
    loadIdle();
  }, [loadIdle]);

  // Tick the elapsed timer while running.
  useEffect(() => {
    if (!running) {
      clearTimer();
      return;
    }
    if (!startRef.current) startRef.current = Date.now();
    timerRef.current = setInterval(
      () => setElapsedMs(Date.now() - startRef.current),
      100,
    );
    return clearTimer;
  }, [running, clearTimer]);

  const finishRun = useCallback(() => {
    setRunning(false);
    startRef.current = 0;
    clearTimer();
    // Give the backend a beat to persist summary_memory + trace, then refresh
    // both this tab and the parent (so the detail/list status badge flips back
    // from "running" to "idle" without waiting for the slow background poll).
    setTimeout(() => {
      loadIdle();
      onRunStateChange?.();
    }, 500);
  }, [clearTimer, loadIdle, onRunStateChange]);

  // Live trace: assemble events from the agent events WebSocket.
  const onEvent = useCallback(
    (ev: AgentEvent) => {
      const data = ev.data || {};
      switch (ev.type) {
        case 'agent_tick_start': {
          startRef.current = Date.now();
          setElapsedMs(0);
          setRunning(true);
          setErrorMsg('');
          setLiveItems([{ kind: 'note', id: `start-${ev.timestamp}`, label: 'Run started' }]);
          break;
        }
        case 'tool_call_start': {
          const id = `tc-${ev.timestamp}-${Math.random().toString(36).slice(2, 6)}`;
          const args = data.arguments;
          const tc: ToolCallInfo = {
            id,
            tool: String(data.tool || 'tool'),
            arguments:
              typeof args === 'string' ? args : args != null ? JSON.stringify(args) : '',
            status: 'running',
          };
          setLiveItems((prev) => [...prev, { kind: 'tool', id, tool: tc }]);
          break;
        }
        case 'tool_call_end': {
          setLiveItems((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const it = next[i];
              if (
                it.kind === 'tool' &&
                it.tool.tool === String(data.tool) &&
                it.tool.status === 'running'
              ) {
                next[i] = {
                  ...it,
                  tool: {
                    ...it.tool,
                    status: data.success === false ? 'error' : 'success',
                    result:
                      typeof data.result === 'string' ? data.result : it.tool.result,
                    latency:
                      typeof data.latency === 'number'
                        ? data.latency * 1000
                        : it.tool.latency,
                  },
                };
                break;
              }
            }
            return next;
          });
          break;
        }
        case 'agent_tick_end':
        case 'agent_tick_error': {
          if (ev.type === 'agent_tick_error') {
            setErrorMsg(String(data.error || 'The run failed.'));
          }
          finishRun();
          break;
        }
      }
    },
    [finishRun],
  );

  useAgentEvents(agentId, onEvent, [
    'agent_tick_start',
    'tool_call_start',
    'tool_call_end',
    'agent_tick_end',
    'agent_tick_error',
  ]);

  // Fallback poll — WS is primary, but this catches missed tick_end events and
  // runs started elsewhere (e.g. the scheduler or the Overview "Run" button).
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const a = await fetchManagedAgent(agentId);
        setActivity(a.current_activity || '');
        if (a.status === 'running' && !runningRef.current) {
          setRunning(true);
        } else if (a.status !== 'running' && runningRef.current) {
          finishRun();
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [agentId, finishRun]);

  // Keep pinned to the newest live item.
  useEffect(() => {
    if (running) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveItems, running]);

  async function handleAsk() {
    const q = input.trim();
    if (!q || running || sending) return;
    setInput('');
    setQuestion(q);
    setErrorMsg('');
    setSending(true);
    setLiveItems([{ kind: 'note', id: 'queued', label: 'Starting run…' }]);
    startRef.current = Date.now();
    setElapsedMs(0);
    try {
      // immediate, non-streamed → triggers a real agent run that consumes the
      // question as input. tick_start over the WS confirms; poll is the backstop.
      await askAgent(agentId, q);
      setRunning(true);
      onRunStateChange?.(); // flip the parent status badge to "running" now
    } catch {
      setErrorMsg('Could not start the agent run.');
      setLiveItems([]);
    } finally {
      setSending(false);
    }
  }

  const isBusy = running || sending;
  const findings = agent?.summary_memory?.trim() || '';
  const traceSteps = lastTrace?.steps ?? [];

  return (
    <div className="flex flex-col" style={{ minHeight: 360 }}>
      {/* ── Trace area header ──────────────────────────────── */}
      <div className="flex items-center justify-between mb-2">
        <div
          className="flex items-center gap-2 text-sm font-medium"
          style={{ color: 'var(--color-text)' }}
        >
          <Activity size={14} style={{ color: 'var(--color-accent)' }} />
          Activity trace
        </div>
        <div
          className="flex items-center gap-2 text-xs"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {isBusy ? (
            <>
              <span
                className="inline-block w-2 h-2 rounded-full animate-pulse"
                style={{ background: 'var(--color-accent)' }}
              />
              Running{elapsedMs > 0 ? ` · ${(elapsedMs / 1000).toFixed(1)}s` : ''}
            </>
          ) : (
            <>
              {agent?.last_run_at
                ? `Last run ${new Date(agent.last_run_at * 1000).toLocaleString()}`
                : 'Idle'}
              {lastTrace && ` · ${lastTrace.outcome}`}
            </>
          )}
        </div>
      </div>

      {/* ── Trace area body ────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto rounded-lg p-3 space-y-3"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          maxHeight: 'calc(100vh - 360px)',
          minHeight: 200,
        }}
      >
        {question && (
          <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Question:</span> {question}
          </div>
        )}

        {errorMsg && (
          <div
            className="text-sm px-3 py-2 rounded-lg"
            style={{
              background: 'rgba(255,80,80,0.08)',
              border: '1px solid var(--color-error)',
              color: 'var(--color-error)',
            }}
          >
            {errorMsg}
          </div>
        )}

        {isBusy ? (
          /* LIVE view — current tick */
          <>
            {liveItems.map((it) =>
              it.kind === 'tool' ? (
                <ToolCallCard key={it.id} toolCall={it.tool} />
              ) : (
                <div
                  key={it.id}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full animate-pulse"
                    style={{ background: 'var(--color-accent)' }}
                  />
                  {it.label}
                </div>
              ),
            )}
            <div
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
              {activity || 'Agent is working…'}
            </div>
          </>
        ) : (
          /* IDLE view — last run's trace + findings */
          <>
            {traceSteps.length > 0 && (
              <div className="space-y-2">
                {traceSteps.map((s, i) => (
                  <ToolCallCard key={i} toolCall={stepToToolCall(s, i)} />
                ))}
              </div>
            )}
            {findings ? (
              <div
                className="px-3 py-2 rounded-lg text-sm"
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                }}
              >
                <div className="text-xs mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  Result
                </div>
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{findings}</ReactMarkdown>
                </div>
              </div>
            ) : (
              traceSteps.length === 0 && (
                <div
                  className="text-sm text-center py-8"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  No runs yet. Ask a question below to run the agent.
                </div>
              )
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Follow-up chat input ───────────────────────────── */}
      <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleAsk();
            }
          }}
          placeholder={isBusy ? 'Agent is running…' : "Ask a follow-up about this agent's work…"}
          disabled={isBusy}
          className="w-full px-3 py-2 rounded-lg text-sm bg-transparent outline-none resize-none"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            minHeight: 64,
            opacity: isBusy ? 0.6 : 1,
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Sends your question as an ad-hoc run — results appear in the trace above.
          </span>
          <button
            onClick={handleAsk}
            disabled={isBusy || !input.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm cursor-pointer font-medium"
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
              opacity: isBusy || !input.trim() ? 0.5 : 1,
            }}
          >
            {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {isBusy ? 'Running' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}
