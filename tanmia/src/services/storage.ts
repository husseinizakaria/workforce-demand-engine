// Organization-scoped storage. Every object path starts with the organization
// id; storage RLS policies authorize by that first path segment.
import { supabase } from '@/lib/supabase';
import { fail } from './errors';

export type Bucket = 'evidence' | 'documents' | 'imports';
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
  const base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'file';
  return base + ext;
}

export async function uploadFile(bucket: Bucket, organizationId: string, scope: string, file: File): Promise<{ path: string; name: string; size: number; type: string }> {
  if (file.size > MAX_UPLOAD_BYTES) fail({ code: '22023', message: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` });
  const cleanScope = scope.split('/').map((s) => s.replace(/[^\w-]/g, '')).filter(Boolean).join('/') || 'general';
  const path = `${organizationId}/${cleanScope}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) fail(error);
  return { path, name: file.name, size: file.size, type: file.type };
}

export async function signedUrl(bucket: Bucket, path: string, expiresIn = 600): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) fail(error);
  return data.signedUrl;
}

export async function removeFile(bucket: Bucket, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) fail(error);
}
