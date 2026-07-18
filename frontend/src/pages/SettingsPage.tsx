import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft, Bot, BrainCircuit, Check, ChevronDown, Download,
  FileUp, KeyRound, MonitorCog, Search, Settings2, ShieldCheck, Trash2, Volume2,
} from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { check } from '@tauri-apps/plugin-updater';
import {
  applyInferenceConfig, fetchSpeechHealth, getInferenceSource, listProviderModels,
  getMemoryStats, isTauri, saveCloudKey, setInferenceSource, type InferenceSource, type ProviderModel,
} from '../lib/api';
import { isAutoUpdateDisabled, setAutoUpdateDisabled } from '../components/Desktop/UpdateChecker';
import { t } from '../lib/i18n';
import { useAppStore } from '../lib/store';

type Section = 'general' | 'voice' | 'ai' | 'memory' | 'data' | 'application';
const PROVIDER_KEYS: Record<string, string> = {
  groq: 'GROQ_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY',
};

const fieldClass = 'mt-2 w-full rounded-lg border border-white/10 bg-[#0b111b] px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-cyan-300/60';
const secondaryButtonClass = 'inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300 transition hover:bg-white/[0.08] disabled:opacity-60';

export function SettingsPage() {
  const navigate = useNavigate();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const conversations = useAppStore((s) => s.conversations);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const [section, setSection] = useState<Section>('general');
  const [source, setSource] = useState<InferenceSource>({ provider: 'groq', model: '' });
  const [apiKey, setApiKey] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [modelMessage, setModelMessage] = useState('');
  const [groqModels, setGroqModels] = useState<ProviderModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState('');
  const [speechAvailable, setSpeechAvailable] = useState<boolean | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<number | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState(() => localStorage.getItem('openjarvis-memory-enabled') !== '0');
  const [advanced, setAdvanced] = useState(false);
  const [appVersion, setAppVersion] = useState('1.1.1');
  const [autoUpdates, setAutoUpdates] = useState(() => !isAutoUpdateDisabled());
  const [startup, setStartup] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const locale = settings.locale;
  const tr = (key: Parameters<typeof t>[1]) => t(locale, key);
  const close = () => navigate('/');

  const loadGroqCatalog = async () => {
    setCatalogLoading(true); setCatalogMessage('');
    try {
      const models = await listProviderModels('groq', apiKey || undefined);
      setGroqModels(models);
      if (!source.model && models[0]) setSource((current) => ({ ...current, model: models[0].id }));
    } catch (error: any) {
      setGroqModels([]);
      setCatalogMessage(error?.message || 'Could not load Groq models.');
    } finally { setCatalogLoading(false); }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void getInferenceSource().then(setSource).catch(() => undefined);
    void fetchSpeechHealth().then((health) => setSpeechAvailable(health.available)).catch(() => setSpeechAvailable(false));
    void getMemoryStats().then((stats) => setMemoryEntries(stats.entries)).catch(() => setMemoryEntries(null));
    if (isTauri()) {
      void getVersion().then(setAppVersion).catch(() => undefined);
      void isEnabled().then(setStartup).catch(() => setStartup(false));
    }
  }, []);

  useEffect(() => {
    if (section === 'ai' && source.provider === 'groq' && groqModels.length === 0 && !catalogLoading) void loadGroqCatalog();
  }, [section, source.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveModel = async () => {
    setSavingModel(true);
    setModelMessage('');
    try {
      const provider = source.provider;
      if (provider === 'ollama' || provider === 'custom') {
        await setInferenceSource({ ...source, apiKey: apiKey || undefined });
      } else {
        await applyInferenceConfig(provider, source.model || '', apiKey || undefined);
      }
      if (apiKey && PROVIDER_KEYS[provider]) await saveCloudKey(PROVIDER_KEYS[provider], apiKey);
      setSelectedModel(source.model || '');
      updateSettings({ defaultModel: source.model || '' });
      setApiKey(''); setKeySaved(true); setTimeout(() => setKeySaved(false), 1800);
    } catch (error: any) {
      setModelMessage(error?.message || 'Could not save the model.');
    } finally { setSavingModel(false); }
  };

  const setMemory = (value: boolean) => {
    localStorage.setItem('openjarvis-memory-enabled', value ? '1' : '0');
    setMemoryEnabled(value);
  };
  const setAutostart = async (value: boolean) => {
    try { value ? await enable() : await disable(); setStartup(value); } catch { setStartup(false); }
  };
  const checkForUpdates = async () => {
    setCheckingUpdate(true); setUpdateResult('');
    try { setUpdateResult((await check()) ? tr('updateAvailable') : tr('upToDate')); }
    catch { setUpdateResult(tr('upToDate')); }
    finally { setCheckingUpdate(false); }
  };
  const exportData = () => {
    const data = localStorage.getItem('openjarvis-conversations') || JSON.stringify({ version: 1, conversations: {}, activeId: null });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'jarvis-data.json'; link.click(); URL.revokeObjectURL(url);
  };
  const importData = async (file?: File) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.settings && typeof data.settings === 'object') updateSettings(data.settings);
      if (data.version === 1 && data.conversations && typeof data.conversations === 'object' && !Array.isArray(data.conversations)) {
        localStorage.setItem('openjarvis-conversations', JSON.stringify(data));
        loadConversations();
      } else if (Array.isArray(data.conversations)) {
        localStorage.setItem('openjarvis-conversations', JSON.stringify({ version: 1, conversations: Object.fromEntries(data.conversations.map((item: { id: string }) => [item.id, item])), activeId: null }));
        loadConversations();
      }
    } catch { /* Ignore invalid local backups. */ }
  };
  const clearData = () => {
    if (!window.confirm(tr('clearDataConfirm'))) return;
    localStorage.removeItem('openjarvis-conversations');
    loadConversations();
  };

  const sections: Array<{ id: Section; icon: typeof Settings2; label: string }> = [
    { id: 'general', icon: Settings2, label: tr('general') }, { id: 'voice', icon: Volume2, label: tr('voice') },
    { id: 'ai', icon: BrainCircuit, label: tr('aiModels') }, { id: 'memory', icon: Bot, label: tr('memoryTools') },
    { id: 'data', icon: ShieldCheck, label: tr('dataPrivacy') }, { id: 'application', icon: MonitorCog, label: tr('application') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={close}>
      <section role="dialog" aria-modal="true" aria-label={tr('settings')} onMouseDown={(event) => event.stopPropagation()} className="flex h-[min(700px,calc(100vh-32px))] w-[min(1060px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-white/10 bg-[#070b12] shadow-2xl shadow-black/70">
        <aside className="flex w-56 shrink-0 flex-col border-r border-white/8 bg-[#0a1019] p-3">
          <button type="button" onClick={close} className="mb-5 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-white/6 hover:text-white"><ArrowLeft size={16} /> {tr('back')}</button>
          <div className="px-3 pb-2 font-mono text-[10px] tracking-[0.22em] text-cyan-300/65">J.A.R.V.I.S.</div>
          <nav className="space-y-1">
            {sections.map(({ id, icon: Icon, label }) => <button key={id} type="button" onClick={() => setSection(id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${section === id ? 'bg-cyan-300/12 text-cyan-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}><Icon size={17} />{label}</button>)}
          </nav>
          <p className="mt-auto px-3 pb-1 text-xs text-slate-600">Jarvis v{appVersion}</p>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-7 sm:px-10">
          {section === 'general' && <Panel title={tr('general')} description={tr('appearance')}>
            <SettingBlock title={tr('theme')} description={tr('themeHelp')}>
              <Segmented value={settings.theme} onChange={(theme) => updateSettings({ theme: theme as typeof settings.theme })} options={[['dark', tr('dark')], ['light', tr('light')], ['system', tr('system')]]} />
            </SettingBlock>
            <SettingBlock title={tr('textSize')}><Segmented value={settings.fontSize} onChange={(fontSize) => updateSettings({ fontSize: fontSize as typeof settings.fontSize })} options={[['small', tr('small')], ['default', tr('default')], ['large', tr('large')]]} /></SettingBlock>
            <SettingBlock title={tr('language')} description={tr('languageHelp')}><Segmented value={locale} onChange={(value) => updateSettings({ locale: value as 'es' | 'en' })} options={[['es', 'Español'], ['en', 'English']]} /></SettingBlock>
          </Panel>}
          {section === 'voice' && <Panel title={tr('voice')} description={tr('voiceHelp')}>
            <SettingBlock title={tr('speechEnabled')} description={tr('speechEnabledHelp')}><Toggle checked={settings.speechEnabled} onChange={(speechEnabled) => updateSettings({ speechEnabled })} /></SettingBlock>
            <SettingBlock title={tr('status')}><Status value={speechAvailable === null ? tr('checking') : speechAvailable ? tr('available') : tr('unavailable')} ok={speechAvailable === true} /></SettingBlock>
          </Panel>}
          {section === 'ai' && <Panel title={tr('aiModels')} description={tr('aiModelsHelp')}>
            <SettingBlock title={tr('provider')}><select className={fieldClass} value={source.provider} onChange={(event) => setSource({ ...source, provider: event.target.value as InferenceSource['provider'] })}>{['groq', 'openai', 'anthropic', 'gemini', 'ollama', 'custom'].map((provider) => <option key={provider} value={provider}>{provider === 'groq' ? 'Groq' : provider[0].toUpperCase() + provider.slice(1)}</option>)}</select></SettingBlock>
            {source.provider === 'groq' ? <SettingBlock title={tr('groqCatalog')} description={tr('groqCatalogHelp')}><div><select className={fieldClass} value={source.model || ''} onChange={(event) => setSource({ ...source, model: event.target.value })}><option value="">{catalogLoading ? tr('loadingCatalog') : tr('selectModel')}</option>{groqModels.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</select><div className="mt-2 flex items-center justify-between gap-3"><button type="button" onClick={() => void loadGroqCatalog()} disabled={catalogLoading} className="text-xs text-cyan-200 transition hover:text-cyan-100 disabled:opacity-50">{catalogLoading ? tr('loadingCatalog') : tr('loadCatalog')}</button>{catalogMessage && <span className="truncate text-xs text-rose-300" title={catalogMessage}>{catalogMessage}</span>}</div></div></SettingBlock> : <SettingBlock title={tr('model')}><input className={fieldClass} value={source.model || ''} placeholder={tr('modelPlaceholder')} onChange={(event) => setSource({ ...source, model: event.target.value })} /></SettingBlock>}
            {(source.provider !== 'ollama' && source.provider !== 'custom') && <SettingBlock title={tr('apiKey')} description={tr('apiKeyHelp')}><div className="flex gap-2"><input className={fieldClass} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="••••••••••••" /><KeyRound className="mt-3 shrink-0 text-slate-600" size={18} /></div></SettingBlock>}
            <button type="button" disabled={savingModel || !source.model} onClick={() => void saveModel()} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60">{keySaved && <Check size={16} />}{savingModel ? tr('saving') : keySaved ? tr('saved') : tr('save')}</button>{modelMessage && <p className="mt-3 text-sm text-rose-300">{modelMessage}</p>}
            <button type="button" onClick={() => setAdvanced(!advanced)} className="mt-7 flex w-full items-center justify-between border-t border-white/8 pt-5 text-sm text-slate-300"><span>{tr('advanced')}</span><ChevronDown className={advanced ? 'rotate-180 transition-transform' : 'transition-transform'} size={17} /></button>
            {advanced && <div className="mt-4 space-y-5 rounded-xl border border-white/8 bg-white/[0.025] p-5"><label className="block text-sm text-slate-300">{tr('serverUrl')}<input className={fieldClass} value={source.host || settings.apiUrl} placeholder="http://127.0.0.1:11434" onChange={(event) => { setSource({ ...source, host: event.target.value }); updateSettings({ apiUrl: event.target.value }); }} /></label><label className="block text-sm text-slate-300">{tr('temperature')}<input className={fieldClass} type="number" min="0" max="2" step="0.1" value={settings.temperature} onChange={(event) => updateSettings({ temperature: Number(event.target.value) })} /></label><label className="block text-sm text-slate-300">{tr('maxTokens')}<input className={fieldClass} type="number" min="1" value={settings.maxTokens} onChange={(event) => updateSettings({ maxTokens: Number(event.target.value) })} /></label></div>}
          </Panel>}
          {section === 'memory' && <Panel title={tr('memoryTools')} description={tr('memoryEnabledHelp')}>
            <SettingBlock title={tr('memoryEnabled')} description={memoryEntries === null ? tr('checking') : `${memoryEntries} ${tr('memoryEntries')}`}><Toggle checked={memoryEnabled} onChange={setMemory} /></SettingBlock>
            <SettingBlock title={tr('webSearch')} description={tr('webSearchHelp')}><KeyInput keyName="TAVILY_API_KEY" /></SettingBlock>
          </Panel>}
          {section === 'data' && <Panel title={tr('dataPrivacy')} description={tr('conversationsHelp')}>
            <SettingBlock title={tr('conversations')} description={`${conversations.length} ${tr('memoryEntries')}`}><div className="flex flex-wrap gap-2"><button onClick={exportData} className={secondaryButtonClass}><Download size={15} />{tr('export')}</button><button onClick={() => importRef.current?.click()} className={secondaryButtonClass}><FileUp size={15} />{tr('import')}</button><button onClick={clearData} className={`${secondaryButtonClass} text-rose-300`}><Trash2 size={15} />{tr('clearData')}</button></div><input ref={importRef} className="hidden" type="file" accept="application/json" onChange={(event) => void importData(event.target.files?.[0])} /></SettingBlock>
          </Panel>}
          {section === 'application' && <Panel title={tr('application')} description="Jarvis desktop">
            <SettingBlock title={tr('version')}><span className="font-mono text-sm text-cyan-200">v{appVersion}</span></SettingBlock>
            <SettingBlock title={tr('autoUpdates')} description={tr('autoUpdatesHelp')}><Toggle checked={autoUpdates} onChange={(value) => { setAutoUpdateDisabled(!value); setAutoUpdates(value); }} /></SettingBlock>
            <SettingBlock title={tr('updates')} description={updateResult || undefined}><button type="button" onClick={() => void checkForUpdates()} disabled={checkingUpdate} className={secondaryButtonClass}><Search size={15} />{checkingUpdate ? tr('checkingUpdates') : tr('checkNow')}</button></SettingBlock>
            <SettingBlock title={tr('startup')} description={tr('startupHelp')}><Toggle checked={startup} onChange={(value) => void setAutostart(value)} /></SettingBlock>
          </Panel>}
        </main>
      </section>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) { return <div><h1 className="text-2xl font-semibold tracking-tight text-slate-100">{title}</h1>{description && <p className="mt-2 text-sm text-slate-400">{description}</p>}<div className="mt-8 divide-y divide-white/8">{children}</div></div>; }
function SettingBlock({ title, description, children }: { title: string; description?: string; children: ReactNode }) { return <section className="flex flex-col gap-4 py-5 first:pt-0 sm:flex-row sm:items-start sm:justify-between"><div className="max-w-md"><h2 className="text-sm font-medium text-slate-200">{title}</h2>{description && <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>}</div><div className="w-full sm:max-w-xs">{children}</div></section>; }
function Segmented({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void }) { return <div className="flex rounded-lg border border-white/10 bg-[#0b111b] p-1">{options.map(([id, label]) => <button key={id} type="button" onClick={() => onChange(id)} className={`flex-1 rounded-md px-2 py-1.5 text-xs transition ${value === id ? 'bg-white/10 text-cyan-100' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>)}</div>; }
function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) { return <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-cyan-300' : 'bg-slate-700'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-6' : 'left-1'}`} /></button>; }
function Status({ value, ok }: { value: string; ok: boolean }) { return <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs ${ok ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-400'}`}>{value}</span>; }
function KeyInput({ keyName }: { keyName: string }) { const [value, setValue] = useState(''); const [saved, setSaved] = useState(false); return <div className="flex gap-2"><input className={fieldClass} type="password" value={value} placeholder="••••••••••••" onChange={(event) => setValue(event.target.value)} /><button type="button" onClick={() => void saveCloudKey(keyName, value).then(() => { setSaved(true); setValue(''); })} className="mt-2 h-10 rounded-lg border border-white/10 px-3 text-xs text-slate-300 hover:bg-white/5">{saved ? <Check size={16} /> : <KeyRound size={16} />}</button></div>; }
