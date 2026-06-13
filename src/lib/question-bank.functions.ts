import { supabase } from "@/integrations/supabase/client";

export interface QuestionInput {
  id?: string;
  mock_exam_id: string;
  prompt: string;
  choices: string[];
  answer: string;
  explanation?: string | null;
  org_id?: string | null;
}

export async function listQuestions(opts: { mockExamId?: string; orgId?: string | null } = {}) {
  let q = supabase.from("question_bank").select("*").order("created_at", { ascending: false });
  if (opts.mockExamId) q = q.eq("mock_exam_id", opts.mockExamId);
  if (opts.orgId === null) q = q.is("org_id", null);
  else if (opts.orgId) q = q.eq("org_id", opts.orgId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function upsertQuestion(input: QuestionInput) {
  const { data: u } = await supabase.auth.getUser();
  const payload = {
    ...input,
    choices: input.choices as unknown as any,
    created_by: input.id ? undefined : u?.user?.id,
  };
  const { data, error } = await supabase
    .from("question_bank")
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteQuestion(id: string) {
  const { error } = await supabase.from("question_bank").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Import questions from a parsed CSV. Expected columns:
 * prompt,choice1,choice2,choice3,choice4,answer,explanation
 */
export interface CsvRow {
  prompt: string;
  choice1?: string;
  choice2?: string;
  choice3?: string;
  choice4?: string;
  answer: string;
  explanation?: string;
}

export async function importQuestionsCsv(
  rows: CsvRow[],
  ctx: { mock_exam_id: string; org_id?: string | null }
) {
  const { data: u } = await supabase.auth.getUser();
  const records = rows
    .filter((r) => r.prompt && r.answer)
    .map((r) => ({
      mock_exam_id: ctx.mock_exam_id,
      prompt: r.prompt,
      choices: [r.choice1, r.choice2, r.choice3, r.choice4].filter(Boolean) as string[],
      answer: r.answer,
      explanation: r.explanation ?? null,
      org_id: ctx.org_id ?? null,
      created_by: u?.user?.id,
    }));
  if (!records.length) return { inserted: 0 };
  const { data, error } = await supabase.from("question_bank").insert(records as any).select("id");
  if (error) throw error;
  return { inserted: data?.length ?? 0 };
}

export function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    // naive CSV split — for quoted commas, callers should pre-process
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row as unknown as CsvRow;
  });
}
