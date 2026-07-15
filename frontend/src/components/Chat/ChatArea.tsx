import { MessageBubble } from './MessageBubble';
import { InputArea } from './InputArea';
import { StreamingDots } from './StreamingDots';
import { useAppStore } from '../../lib/store';

export function ChatArea() {
  const messages = useAppStore((s) => s.messages);
  const streamState = useAppStore((s) => s.streamState);

  const last = messages[messages.length - 1];
  const secondLast = messages[messages.length - 2];
  const showUserEcho = last?.role === 'assistant' && secondLast?.role === 'user';
  const showAssistant = last?.role === 'assistant' && (last.content || streamState.isStreaming);
  const showDots = streamState.isStreaming && streamState.content === '' && !last?.isResearch;

  return (
    <div className="flex flex-col">
      {(showUserEcho || showAssistant || showDots) && (
        <div className="max-w-2xl mx-auto w-full px-6 pb-4 text-center">
          {showUserEcho && (
            <p className="mb-2 font-mono text-[11px] tracking-[0.15em] text-cyan-300/50 [text-shadow:0_2px_12px_rgba(0,0,0,0.9)]">
              {secondLast.content}
            </p>
          )}
          {showAssistant && (
            <div
              className="prose-invert text-[15px] leading-relaxed text-cyan-50/95 [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]"
              style={{ ['--color-text' as string]: '#ecfeff', ['--color-text-secondary' as string]: 'rgba(207,250,254,0.7)' }}
            >
              <MessageBubble message={last} isLive={streamState.isStreaming} />
            </div>
          )}
          {showDots && (
            <div className="flex justify-center">
              <StreamingDots phase={streamState.phase} />
            </div>
          )}
        </div>
      )}
      <InputArea />
    </div>
  );
}
