import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { cx } from '@/utils/cx';
import { MAX_UPLOAD_BYTES } from '@/services/storage';

export function FileDrop({ onFiles, accept, multiple, file }: { onFiles: (f: File[]) => void; accept?: string; multiple?: boolean; file?: File | null }) {
  const { tr, fmtNumber } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className={cx('dropzone', over && 'over')} role="button" tabIndex={0}
      onClick={() => ref.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') ref.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}>
      <UploadCloud size={22} />
      <div className="small">{file ? <b>{file.name} ({fmtNumber(file.size / 1024, 0)} KB)</b> : tr('اسحب الملف هنا أو انقر للاختيار', 'Drop a file here or click to choose')}</div>
      <div className="tiny">{tr('الحد الأقصى', 'Max')} {MAX_UPLOAD_BYTES / 1024 / 1024} MB</div>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    </div>
  );
}
