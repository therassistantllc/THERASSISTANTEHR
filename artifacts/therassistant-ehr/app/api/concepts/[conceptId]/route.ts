import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";

type DbRow = Record<string, unknown>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function rowToConcept(row: DbRow) {
  return {
    id: clean(row.id),
    name: clean(row.name),
    description: clean(row.description),
    datatype: clean(row.datatype),
    conceptClass: clean(row.concept_class),
    isSet: Boolean(row.is_set),
    retired: Boolean(row.retired),
    createdByOrganizationId: clean(row.created_by_organization_id) || null,
    createdAt: clean(row.created_at),
    updatedAt: clean(row.updated_at),
  };
}

export async function GET(_request: Request, context: { params: Promise<{ conceptId: string }> }) {
  try {
    const supabase = createServerSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ success: false, error: "Database connection not available" }, { status: 500 });
    }

    const { conceptId } = await context.params;
    if (!conceptId) return NextResponse.json({ success: false, error: "conceptId is required" }, { status: 400 });

    const { data: concept, error: cErr } = await supabase
      .from("concepts")
      .select(`
        id, name, description, datatype, concept_class, is_set, retired, created_by_organization_id, created_at, updated_at,
        concept_names(id, name, locale, name_type),
        concept_mappings(id, code_system, code, display),
        concept_answers!concept_answers_concept_id_fkey(
          answer_concept_id,
          sort_weight,
          answer:concepts!concept_answers_answer_concept_id_fkey(id, name, datatype, concept_class)
        )
      `)
      .eq("id", conceptId)
      .order("name_type", { foreignTable: "concept_names", ascending: true })
      .order("code_system", { foreignTable: "concept_mappings", ascending: true })
      .order("sort_weight", { foreignTable: "concept_answers", ascending: true })
      .maybeSingle();
    if (cErr) return NextResponse.json({ success: false, error: cErr.message }, { status: 422 });
    if (!concept) return NextResponse.json({ success: false, error: "Concept not found" }, { status: 404 });

    const c = concept as DbRow & {
      concept_names?: DbRow[];
      concept_mappings?: DbRow[];
      concept_answers?: (DbRow & { answer?: DbRow | DbRow[] })[];
    };

    const names = (c.concept_names ?? []).map((row) => ({
      id: clean(row.id),
      name: clean(row.name),
      locale: clean(row.locale),
      nameType: clean(row.name_type),
    }));
    const mappings = (c.concept_mappings ?? []).map((row) => ({
      id: clean(row.id),
      codeSystem: clean(row.code_system),
      code: clean(row.code),
      display: clean(row.display),
    }));
    const answers = (c.concept_answers ?? []).map((row) => {
      const ans = Array.isArray(row.answer) ? row.answer[0] : row.answer;
      return {
        answerConceptId: clean(row.answer_concept_id),
        sortWeight: Number(row.sort_weight ?? 0),
        name: ans ? clean(ans.name) : "",
        datatype: ans ? clean(ans.datatype) : "",
        conceptClass: ans ? clean(ans.concept_class) : "",
      };
    });

    // For LabSet-style "is_set" concepts, also return member questions that point at this set via concept_set membership.
    // We do not have a concept_set table yet; members are discoverable today via the seed pattern (PHQ-9 root + numbered children).
    // Keeping the response shape forward-compatible: include a `members: []` field as a placeholder.
    return NextResponse.json({
      success: true,
      concept: rowToConcept(concept as DbRow),
      names,
      mappings,
      answers,
      members: [],
    });
  } catch (error) {
    console.error("Concept detail API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load concept" },
      { status: 500 },
    );
  }
}
