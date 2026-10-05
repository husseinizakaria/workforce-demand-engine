// Explainable expert matching. Every score is a sum of named factors with
// their maximum, so users can see exactly why an expert was ranked.
import { type AssignmentLike, type AvailabilityLike, type ExpertLike, type L10n, l, roundTo } from './types.ts';

export interface MatchRequirements {
  role?: string | null;                 // trainer | mentor | consultant | coach | assessor | judge
  expertise?: string[];
  sector?: string | null;
  language?: string | null;             // 'ar' | 'en' | ...
  city?: string | null;
  delivery_mode?: string | null;        // onsite | online | hybrid
  needed_hours?: number | null;
  conflict_terms?: string[];            // names/codes of beneficiaries, teams, sponsors to check against declared conflicts
  exclude_expert_ids?: string[];
}
export interface MatchFactor { key: string; label: L10n; points: number; max: number; detail: L10n }
export interface MatchResult {
  expert_id: string; code: string; name: string; score: number; eligible: boolean;
  factors: MatchFactor[]; warnings: L10n[]; load_hours: number;
}

/** Arabic-aware normalization for fuzzy keyword matching. */
export function normalizeText(s: string): string {
  return s.toLowerCase()
    .replace(/[ً-ْٰ]/g, '')       // diacritics
    .replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/^ال/, '').replace(/\s+ال/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function termsMatch(a: string, b: string): boolean {
  const x = normalizeText(a); const y = normalizeText(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

const W = { role: 20, expertise: 30, sector: 10, language: 10, location: 10, availability: 5, rating: 10, workload: 5 };

export function matchExperts(
  experts: ExpertLike[], req: MatchRequirements,
  ctx: { assignments: AssignmentLike[]; availability: AvailabilityLike[] },
): MatchResult[] {
  const results = experts
    .filter((e) => !(req.exclude_expert_ids ?? []).includes(e.id))
    .map((e): MatchResult => {
      const factors: MatchFactor[] = []; const warnings: L10n[] = []; let eligible = e.status === 'active';
      if (e.status !== 'active') warnings.push(l('الخبير غير نشط', 'Expert is not active'));

      // Role
      if (req.role) {
        const ok = e.roles.includes(req.role);
        factors.push({ key: 'role', label: l('ملاءمة الدور', 'Role fit'), points: ok ? W.role : 0, max: W.role,
          detail: ok ? l(`يؤدي دور ${req.role}`, `Performs the ${req.role} role`) : l(`لا يؤدي دور ${req.role}`, `Does not perform the ${req.role} role`) });
        if (!ok) warnings.push(l('الدور المطلوب غير مسجل للخبير', 'Required role not registered for this expert'));
      }
      // Expertise
      const reqEx = (req.expertise ?? []).filter((x) => x.trim());
      if (reqEx.length) {
        const matched = reqEx.filter((r) => e.expertise.some((x) => termsMatch(x, r)));
        const pts = roundTo((matched.length / reqEx.length) * W.expertise, 1);
        factors.push({ key: 'expertise', label: l('الخبرة التخصصية', 'Expertise'), points: pts, max: W.expertise,
          detail: l(`يغطي ${matched.length} من ${reqEx.length}: ${matched.join('، ') || '—'}`, `Covers ${matched.length} of ${reqEx.length}: ${matched.join(', ') || '—'}`) });
      }
      if (req.sector) {
        const ok = e.sectors.some((s) => termsMatch(s, req.sector!));
        factors.push({ key: 'sector', label: l('القطاع', 'Sector'), points: ok ? W.sector : 0, max: W.sector,
          detail: ok ? l(`خبرة في قطاع ${req.sector}`, `Experience in ${req.sector}`) : l('لا خبرة مسجلة في القطاع', 'No recorded sector experience') });
      }
      if (req.language) {
        const ok = e.languages.includes(req.language);
        factors.push({ key: 'language', label: l('اللغة', 'Language'), points: ok ? W.language : 0, max: W.language,
          detail: ok ? l('يتحدث اللغة المطلوبة', 'Speaks the required language') : l('اللغة المطلوبة غير مسجلة', 'Required language not recorded') });
      }
      if (req.delivery_mode || req.city) {
        let pts = 0; const parts: string[] = []; const partsEn: string[] = [];
        if (req.delivery_mode === 'online') {
          if (e.delivery_modes.includes('online')) { pts = W.location; parts.push('يقدم عن بعد'); partsEn.push('Delivers online'); }
        } else {
          const cityOk = !req.city || (e.city ? termsMatch(e.city, req.city) : false);
          const modeOk = !req.delivery_mode || e.delivery_modes.includes(req.delivery_mode) || e.delivery_modes.includes('hybrid');
          pts = (cityOk ? W.location * 0.6 : 0) + (modeOk ? W.location * 0.4 : 0);
          parts.push(cityOk ? `في ${req.city ?? e.city ?? ''}` : 'خارج المدينة'); partsEn.push(cityOk ? `In ${req.city ?? e.city ?? ''}` : 'Outside the city');
        }
        factors.push({ key: 'location', label: l('الموقع وطريقة التقديم', 'Location & delivery'), points: roundTo(pts, 1), max: W.location, detail: l(parts.join('، '), partsEn.join(', ')) });
      }
      const weekly = ctx.availability.filter((a) => a.expert_id === e.id && a.kind === 'weekly');
      const weeklyHours = weekly.reduce((a, w) => a + (w.start_time && w.end_time ? (toMin(w.end_time) - toMin(w.start_time)) / 60 : 0), 0);
      factors.push({ key: 'availability', label: l('التوفر', 'Availability'), points: weekly.length ? W.availability : 0, max: W.availability,
        detail: weekly.length ? l(`${roundTo(weeklyHours, 1)} ساعة أسبوعيًا متاحة`, `${roundTo(weeklyHours, 1)} weekly hours available`) : l('لم يحدد أوقات توفر', 'No availability defined') });

      const perf = ctx.assignments.filter((a) => a.expert_id === e.id && a.performance_rating !== null).map((a) => Number(a.performance_rating));
      const rating = perf.length ? perf.reduce((a, b) => a + b, 0) / perf.length : (e.rating ?? null);
      factors.push({ key: 'rating', label: l('التقييم والأداء السابق', 'Rating & past performance'), points: rating === null ? W.rating * 0.5 : roundTo((rating / 5) * W.rating, 1), max: W.rating,
        detail: rating === null ? l('لا يوجد تقييم سابق (درجة محايدة)', 'No prior rating (neutral score)') : l(`متوسط ${roundTo(rating, 2)} من 5 (${perf.length} تكليف)`, `Average ${roundTo(rating, 2)} / 5 (${perf.length} assignments)`) });

      const active = ctx.assignments.filter((a) => a.expert_id === e.id && ['proposed', 'confirmed', 'active'].includes(a.status));
      const load = active.reduce((a, x) => a + Math.max(0, Number(x.planned_hours ?? 0) - Number(x.delivered_hours ?? 0)), 0);
      const capacity = (e.max_weekly_hours ?? 0) * 12; // ~ one quarter
      let wl = W.workload;
      if (capacity > 0) {
        const util = (load + (req.needed_hours ?? 0)) / capacity;
        wl = util <= 0.6 ? W.workload : util <= 1 ? W.workload * 0.5 : 0;
        if (util > 1) warnings.push(l('عبء العمل يتجاوز السعة التقديرية', 'Workload exceeds estimated capacity'));
      }
      factors.push({ key: 'workload', label: l('عبء العمل', 'Workload'), points: roundTo(wl, 1), max: W.workload,
        detail: l(`${roundTo(load, 1)} ساعة متبقية في ${active.length} تكليف نشط`, `${roundTo(load, 1)} remaining hours across ${active.length} active assignments`) });

      const conflictsHit = (req.conflict_terms ?? []).filter((term) => e.conflicts.some((c) => termsMatch(c, term)));
      if (conflictsHit.length) {
        eligible = false;
        warnings.push(l(`تعارض مصالح مُعلن مع: ${conflictsHit.join('، ')}`, `Declared conflict of interest with: ${conflictsHit.join(', ')}`));
      }

      const max = factors.reduce((a, f) => a + f.max, 0);
      const pts = factors.reduce((a, f) => a + f.points, 0);
      const score = max ? roundTo((pts / max) * 100, 1) : 0;
      return { expert_id: e.id, code: e.code, name: e.full_name, score: eligible ? score : 0, eligible, factors, warnings, load_hours: roundTo(load, 1) };
    });
  return results.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
