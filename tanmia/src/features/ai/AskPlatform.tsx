// "Ask Platform": natural-language questions answered from the organization's
// own data. Server-side (Edge Function) when deployed — optionally with an LLM —
// otherwise the same deterministic engine runs in the browser. Answers are
// recommendations with their data sources, never automated decisions.
import { useState } from 'react';
import { useLocation } from 'react-router';
import { MessageSquareText, Send, Sparkles } from 'lucide-react';
import { answerQuestion, programHealth, type L10n } from '@engine';
import { useI18n } from '@/i18n/I18nProvider';
import { useOrg } from '@/app/OrgProvider';
import { Badge, Button, Drawer, Notice, Textarea } from '@/components/ui';
import { callFunction } from '@/services/functions';
import { loadProgramBundle } from '@/services/programBundle';
import { all } from '@/services/db';
import { errorOf } from '@/services/errors';
import type { Program } from '@/types/db';

interface AskResponse { answer: { intent: string; answer: L10n[]; sources: string[] }; narrative?: string | null; generated_by: 'rules' | 'rules+llm'; model?: string | null }
interface Turn { q: string; lines: L10n[]; narrative?: string | null; sources: string[]; generated_by: string; local: boolean }

const SUGGESTIONS: [string, string][] = [
  ['ما وضع البرنامج وما الخطوات التالية؟', 'What is the program status and what should we do next?'],
  ['ما العوائق الحالية؟', 'What are the current blockers?'],
  ['أين فجوات الأدلة؟', 'Where are the evidence gaps?'],
  ['كيف تطور النضج بين T0 وT1؟', 'How did maturity change between T0 and T1?'],
  ['هل المؤشرات على المسار؟', 'Are the indicators on track?'],
];

export function AskPlatformButton() {
  const [open, setOpen] = useState(false);
  const { tr } = useI18n();
  return (
    <>
      <Button icon={<Sparkles />} onClick={() => setOpen(true)} aria-haspopup="dialog">{tr('اسأل المنصة', 'Ask Platform')}</Button>
      {open && <AskPlatformDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function AskPlatformDrawer({ onClose }: { onClose: () => void }) {
  const { tr, L, locale } = useI18n();
  const { org } = useOrg();
  const loc = useLocation();
  const programId = /\/app\/programs\/([0-9a-f-]{36})/.exec(loc.pathname)?.[1] ?? null;
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true); setErr(null);
    try {
      try {
        const r = await callFunction<AskResponse>('ai-program-analysis', { mode: 'ask', organization_id: org.id, program_id: programId, question, locale });
        setTurns((t) => [...t, { q: question, lines: r.answer.answer, narrative: r.narrative, sources: r.answer.sources, generated_by: r.generated_by, local: false }]);
      } catch (e) {
        const ae = errorOf(e);
        if (ae.code !== 'function_unavailable' && ae.code !== 'not_configured' && ae.code !== '404') throw e;
        // Same engine, executed locally under the user's own RLS scope.
        if (programId) {
          const b = await loadProgramBundle(programId);
          const a = answerQuestion(question, b);
          setTurns((t) => [...t, { q: question, lines: a.answer, sources: a.sources, generated_by: 'rules', local: true }]);
        } else {
          const programs = await all<Program>('programs', { filters: [['organization_id', 'eq', org.id], ['status', 'in', ['active', 'planning']]], order: { column: 'updated_at' } }, 12);
          const lines: L10n[] = [];
          for (const p of programs.slice(0, 8)) {
            const h = programHealth(await loadProgramBundle(p.id));
            lines.push({ ar: `• ${p.name}: صحة ${h.score}/100 — ${h.next_actions[0]?.title.ar ?? 'لا ملاحظات عاجلة'}`, en: `• ${p.name}: health ${h.score}/100 — ${h.next_actions[0]?.title.en ?? 'no urgent findings'}` });
          }
          if (!lines.length) lines.push({ ar: 'لا توجد برامج نشطة.', en: 'No active programs.' });
          setTurns((t) => [...t, { q: question, lines, sources: ['programs', 'program_health'], generated_by: 'rules', local: true }]);
        }
      }
      setQ('');
    } catch (e) {
      const ae = errorOf(e);
      setErr(locale === 'ar' ? ae.message_ar : ae.message_en);
    } finally { setBusy(false); }
  };

  return (
    <Drawer open title={<span className="row"><MessageSquareText size={18} />{tr('اسأل المنصة', 'Ask Platform')}</span>} onClose={onClose} wide
      footer={
        <form className="row grow" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <Textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} style={{ minHeight: 44 }} placeholder={tr('اكتب سؤالك عن البرنامج أو المؤسسة…', 'Ask about the program or organization…')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(q); } }} />
          <Button type="submit" variant="primary" icon={<Send />} loading={busy}>{tr('إرسال', 'Send')}</Button>
        </form>
      }>
      <div className="ask-panel stack">
        <Notice tone="info">{programId ? tr('السياق: البرنامج المفتوح حاليًا.', 'Context: the program currently open.') : tr('السياق: برامج المؤسسة النشطة.', 'Context: the organization’s active programs.')} {tr('الإجابات توصيات مبنية على بياناتك مع مصادرها؛ القرار النهائي للمستخدم.', 'Answers are recommendations grounded in your data with sources; decisions remain yours.')}</Notice>
        {!turns.length && (
          <div className="row wrap">{SUGGESTIONS.map(([ar, en]) => <Button key={en} size="sm" onClick={() => void ask(locale === 'ar' ? ar : en)}>{locale === 'ar' ? ar : en}</Button>)}</div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="stack-sm">
            <div className="msg q">{t.q}</div>
            <div className="msg a stack-sm">
              {t.lines.map((x, j) => <p key={j}>{L(x)}</p>)}
              {t.narrative && <><div className="divider" /><p style={{ whiteSpace: 'pre-wrap' }}>{t.narrative}</p></>}
              <div className="row wrap tiny muted">
                <Badge tone={t.generated_by === 'rules' ? 'outline' : 'info'}>{t.generated_by === 'rules' ? tr('محرك القواعد', 'Rules engine') : tr('قواعد + نموذج لغوي (مسودة)', 'Rules + LLM (draft)')}</Badge>
                {t.local && <Badge tone="outline">{tr('تحليل محلي', 'Local analysis')}</Badge>}
                <span>{tr('المصادر', 'Sources')}: <span className="mono">{t.sources.join(', ')}</span></span>
              </div>
            </div>
          </div>
        ))}
        {err && <Notice tone="danger">{err}</Notice>}
      </div>
    </Drawer>
  );
}
