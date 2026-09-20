import { supabase } from "@/integrations/supabase/client";

/**
 * Lab workbench data: admin-defined API keys + working folders for a lab,
 * plus the folder notes each learner keeps for themselves.
 *
 * These tables are newer than the generated database types, so queries go
 * through this thin untyped handle and are re-typed with the shapes below.
 */
const db = supabase as unknown as {
  from: (table: string) => any;
};

export interface LabSecret {
  id: string;
  lab_template_id: string;
  label: string;
  secret_value: string;
  hint: string | null;
  sort_order: number;
}

export interface LabFolder {
  id: string;
  lab_template_id: string;
  path: string;
  description: string | null;
  sort_order: number;
}

export interface LabFolderNote {
  id: string;
  lab_template_id: string;
  path: string;
  note: string | null;
  updated_at: string;
}

/** Show only the last few characters of a key, e.g. "••••••••••3f9a". */
export function maskSecret(value: string, visible = 4): string {
  const clean = (value ?? "").trim();
  if (!clean) return "";
  if (clean.length <= visible) return "•".repeat(8);
  return "•".repeat(Math.min(12, Math.max(8, clean.length - visible))) + clean.slice(-visible);
}

export async function listLabSecrets(labTemplateId: string): Promise<LabSecret[]> {
  const { data, error } = await db
    .from("lab_template_secrets")
    .select("id, lab_template_id, label, secret_value, hint, sort_order")
    .eq("lab_template_id", labTemplateId)
    .order("sort_order")
    .order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as LabSecret[];
}

export async function upsertLabSecret(input: {
  id?: string;
  lab_template_id: string;
  label: string;
  secret_value: string;
  hint?: string | null;
  sort_order?: number;
}): Promise<void> {
  const row = {
    lab_template_id: input.lab_template_id,
    label: input.label.trim(),
    secret_value: input.secret_value.trim(),
    hint: input.hint?.trim() || null,
    sort_order: input.sort_order ?? 0,
    updated_at: new Date().toISOString(),
  };
  const query = input.id
    ? db.from("lab_template_secrets").update(row).eq("id", input.id)
    : db.from("lab_template_secrets").insert(row);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function deleteLabSecret(id: string): Promise<void> {
  const { error } = await db.from("lab_template_secrets").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listLabFolders(labTemplateId: string): Promise<LabFolder[]> {
  const { data, error } = await db
    .from("lab_template_folders")
    .select("id, lab_template_id, path, description, sort_order")
    .eq("lab_template_id", labTemplateId)
    .order("sort_order")
    .order("path");
  if (error) throw new Error(error.message);
  return (data ?? []) as LabFolder[];
}

export async function upsertLabFolder(input: {
  id?: string;
  lab_template_id: string;
  path: string;
  description?: string | null;
  sort_order?: number;
}): Promise<void> {
  const row = {
    lab_template_id: input.lab_template_id,
    path: input.path.trim(),
    description: input.description?.trim() || null,
    sort_order: input.sort_order ?? 0,
  };
  const query = input.id
    ? db.from("lab_template_folders").update(row).eq("id", input.id)
    : db.from("lab_template_folders").insert(row);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

export async function deleteLabFolder(id: string): Promise<void> {
  const { error } = await db.from("lab_template_folders").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listMyFolderNotes(labTemplateId: string, userId: string): Promise<LabFolderNote[]> {
  const { data, error } = await db
    .from("lab_folder_notes")
    .select("id, lab_template_id, path, note, updated_at")
    .eq("lab_template_id", labTemplateId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LabFolderNote[];
}

export async function saveMyFolderNote(input: {
  lab_template_id: string;
  user_id: string;
  path: string;
  note?: string | null;
}): Promise<void> {
  const { error } = await db.from("lab_folder_notes").insert({
    lab_template_id: input.lab_template_id,
    user_id: input.user_id,
    path: input.path.trim(),
    note: input.note?.trim() || null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteMyFolderNote(id: string): Promise<void> {
  const { error } = await db.from("lab_folder_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
