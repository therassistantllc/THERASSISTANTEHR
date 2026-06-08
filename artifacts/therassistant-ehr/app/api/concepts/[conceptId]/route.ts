import { NextResponse } from "next/server";
import { createServerSupabaseAdminClient } from "@/lib/supabase/server";
import { ORGANIZATION_ID } from "@/lib/config";

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
    // Org scope is server-side only — not taken from query params — so callers
    // cannot spoof another org's local concepts. Swap for the authenticated
    // user's org once user auth lands.
    const organizationId = ORGANIZATION_ID;

    // Single round-trip: concept + names + mappings + answers (+ each answer's
    // concept) + set members (+ each member concept). Org visibility is enforced
    // on the top-level concept; child rows inherit access via the parent.
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
        ),
        concept_set_members!concept_set_members_concept_set_id_fkey(
          member_concept_id,
          sort_weight,
          member:concepts!concept_set_members_member_concept_id_fkey(
            id, name, description, datatype, concept_class,
            concept_answers!concept_answers_concept_id_fkey(
              answer_concept_id,
              sort_weight,
              answer:concepts!concept_answers_answer_concept_id_fkey(id, name, datatype, concept_class)
            )
          )
        )
      `)
      .eq("id", conceptId)
      .or(`created_by_organization_id.is.null,created_by_organization_id.eq.${organizationId}`)
      .order("name_type", { foreignTable: "concept_names", ascending: true })
      .order("code_system", { foreignTable: "concept_mappings", ascending: true })
      .order("sort_weight", { foreignTable: "concept_answers", ascending: true })
      .order("sort_weight", { foreignTable: "concept_set_members", ascending: true })
      .maybeSingle();
    if (cErr) return NextResponse.json({ success: false, error: cErr.message }, { status: 422 });
    if (!concept) return NextResponse.json({ success: false, error: "Concept not found" }, { status: 404 });

    const c = concept as DbRow & {
      concept_names?: DbRow[];
      concept_mappings?: DbRow[];
      concept_answers?: (DbRow & { answer?: DbRow | DbRow[] })[];
      concept_set_members?: (DbRow & { member?: DbRow | DbRow[] })[];
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
    const members = (c.concept_set_members ?? []).map((row) => {
      const m = Array.isArray(row.member) ? row.member[0] : row.member;
      const memberAnswersRaw = (m && (m as DbRow & { concept_answers?: (DbRow & { answer?: DbRow | DbRow[] })[] }).concept_answers) || [];
      const memberAnswers = memberAnswersRaw
        .map((ar) => {
          const ans = Array.isArray(ar.answer) ? ar.answer[0] : ar.answer;
          return {
            answerConceptId: clean(ar.answer_concept_id),
            sortWeight: Number(ar.sort_weight ?? 0),
            name: ans ? clean(ans.name) : "",
            datatype: ans ? clean(ans.datatype) : "",
            conceptClass: ans ? clean(ans.concept_class) : "",
          };
        })
        .sort((a, b) => a.sortWeight - b.sortWeight);
      return {
        memberConceptId: clean(row.member_concept_id),
        sortWeight: Number(row.sort_weight ?? 0),
        name: m ? clean(m.name) : "",
        description: m ? clean(m.description) : "",
        datatype: m ? clean(m.datatype) : "",
        conceptClass: m ? clean(m.concept_class) : "",
        answers: memberAnswers,
      };
    });

    return NextResponse.json({
      success: true,
      organizationId,
      concept: rowToConcept(concept as DbRow),
      names,
      mappings,
      answers,
      members,
    });
  } catch (error) {
    console.error("Concept detail API error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to load concept" },
      { status: 500 },
    );
  }
}
