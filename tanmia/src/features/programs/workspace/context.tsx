// Program workspace context: one loaded bundle shared by every tab, the live
// engine health report and helpers to resolve names.
import { createContext, useContext } from 'react';
import type { HealthReport, TrackDef } from '@engine';
import type { FullProgramBundle } from '@/services/programBundle';
import type { Beneficiary } from '@/types/db';

export interface WorkspaceValue {
  programId: string;
  base: string;
  bundle: FullProgramBundle;
  health: HealthReport;
  track: TrackDef | undefined;
  reload: () => Promise<void>;
  /** Beneficiaries with a non-withdrawn enrollment in this program. */
  enrolled: Beneficiary[];
  benName: (id: string | null | undefined) => string;
  expertName: (id: string | null | undefined) => string;
  stageName: (key: string | null | undefined) => string;
  cohortName: (id: string | null | undefined) => string;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error('useWorkspace outside ProgramWorkspace');
  return v;
}
