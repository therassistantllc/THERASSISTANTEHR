/**
 * Task #466 — payer_rules → ValidationFinding projection.
 *
 * Verifies that {@link payerRuleToFinding} produces the expected severity,
 * ruleId, and category for both warn and block actions, and that
 * {@link loadActivePayerRules} composes the supabase filter chain correctly
 * (org + payer + status='active' + archived_at IS NULL).
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  loadActivePayerRules,
  payerRuleToFinding,
  type ActivePayerRule,
} from "../payerRules";

const ORG = "11111111-1111-1111-1111-111111111111";
const PAYER = "22222222-2222-2222-2222-222222222222";

interface Call {
  op: string;
  args: unknown[];
}

function makeFakeSupabase(rows: unknown[]) {
  const calls: Call[] = [];
  const builder = {
    select(...args: unknown[]) {
      calls.push({ op: "select", args });
      return builder;
    },
    eq(col: string, val: unknown) {
      calls.push({ op: "eq", args: [col, val] });
      return builder;
    },
    is(col: string, val: unknown) {
      calls.push({ op: "is", args: [col, val] });
      return builder;
    },
    order(col: string, opts: unknown) {
      calls.push({ op: "order", args: [col, opts] });
      return Promise.resolve({ data: rows, error: null });
    },
  };
  const client = {
    from(table: string) {
      calls.push({ op: "from", args: [table] });
      return builder;
    },
  } as any;
  return { client, calls };
}

describe("payerRuleToFinding", () => {
  const baseRule: ActivePayerRule = {
    id: "rule-1",
    payer_profile_id: PAYER,
    carc_code: "16",
    rule: "Missing modifier 25 on E&M with procedure.",
    action: "warn",
  };

  it("emits a warning finding for action='warn'", () => {
    const f = payerRuleToFinding(baseRule, "Aetna");
    assert.equal(f.severity, "warning");
    assert.equal(f.category, "claimPayerRules");
    assert.equal(f.ruleId, "claim.payer_rule.rule-1");
    assert.ok(f.message.includes("Aetna"));
    assert.ok(f.message.includes("CARC 16"));
    assert.ok(f.message.includes("Missing modifier 25"));
    assert.deepEqual(f.evidence, {
      payer_rule_id: "rule-1",
      carc_code: "16",
      action: "warn",
      rule: baseRule.rule,
    });
  });

  it("emits a blocking finding for action='block'", () => {
    const f = payerRuleToFinding({ ...baseRule, action: "block" }, "Aetna");
    assert.equal(f.severity, "blocking");
    assert.ok(f.message.toLowerCase().includes("blocked"));
  });

  it("handles a missing payer name and null CARC", () => {
    const f = payerRuleToFinding(
      { ...baseRule, carc_code: null },
      null,
    );
    assert.ok(f.message.includes("this payer"));
    assert.ok(f.message.includes("a prior denial"));
    assert.equal(f.evidence?.carc_code, null);
  });
});

describe("loadActivePayerRules", () => {
  it("filters by org + payer + status='active' + archived_at IS NULL", async () => {
    const { client, calls } = makeFakeSupabase([
      {
        id: "rule-1",
        payer_profile_id: PAYER,
        carc_code: "16",
        rule: "x",
        action: "warn",
      },
      {
        id: "rule-2",
        payer_profile_id: PAYER,
        carc_code: null,
        rule: "y",
        action: "block",
      },
    ]);
    const rules = await loadActivePayerRules(client, ORG, PAYER);
    assert.equal(rules.length, 2);
    assert.equal(rules[1].action, "block");
    assert.equal(rules[1].carc_code, null);
    // Filter chain
    const eqCalls = calls.filter((c) => c.op === "eq").map((c) => c.args[0]);
    const isCalls = calls.filter((c) => c.op === "is").map((c) => c.args);
    assert.ok(eqCalls.includes("organization_id"));
    assert.ok(eqCalls.includes("payer_profile_id"));
    assert.ok(eqCalls.includes("status"));
    assert.ok(isCalls.some(([col, val]) => col === "archived_at" && val === null));
  });

  it("returns an empty array on supabase error", async () => {
    const client = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          is() { return this; },
          order() { return Promise.resolve({ data: null, error: { message: "boom" } }); },
        };
      },
    } as any;
    const rules = await loadActivePayerRules(client, ORG, PAYER);
    assert.deepEqual(rules, []);
  });

  it("defaults unknown action values to 'warn'", async () => {
    const { client } = makeFakeSupabase([
      { id: "r", payer_profile_id: PAYER, carc_code: "1", rule: "z", action: "lol" },
    ]);
    const rules = await loadActivePayerRules(client, ORG, PAYER);
    assert.equal(rules[0].action, "warn");
  });
});
