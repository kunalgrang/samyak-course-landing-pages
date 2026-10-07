/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  handleHistoricalStudentAuthRepairOperatorRequest,
} from "./historical-student-auth-repair-operator";
import type { AppContext } from "../lib/http";
import type { HistoricalStudentAuthRepairResult } from "../lib/historical-student-auth-repair";

const ORG_ID = "org_samyak";
const STUDENT_ID = "student_subject";

describe("historical student auth repair operator", () => {
  it("invokes exactly one explicitly confirmed candidate", async () => {
    const calls: unknown[] = [];
    const response = await invoke({
      db: countDb(1),
      body: validBody(),
      repair: async (_c: AppContext, input: RepairInput) => {
        calls.push(input);
        return result("repaired", { elementsCreated: ["global_identity"] });
      },
    });

    await expectJson(response, 200, {
      ok: true,
      candidateCount: 1,
      result: "repaired",
      studentId: STUDENT_ID,
      elementsCreated: ["global_identity"],
    });
    expect(calls).toEqual([{ organisationId: ORG_ID, studentId: STUDENT_ID, now: "2026-10-07T00:00:00.000Z" }]);
  });

  it("rejects missing organisation id", async () => {
    const response = await invoke({ body: { studentId: STUDENT_ID, confirmStudentId: STUDENT_ID } });
    await expectJson(response, 400, { ok: false, error: "missing_or_invalid_organisation_id" });
  });

  it("rejects missing student id", async () => {
    const response = await invoke({ body: { organisationId: ORG_ID, confirmStudentId: STUDENT_ID } });
    await expectJson(response, 400, { ok: false, error: "missing_or_invalid_student_id" });
  });

  it("rejects missing confirmation", async () => {
    const response = await invoke({ body: { organisationId: ORG_ID, studentId: STUDENT_ID } });
    await expectJson(response, 400, { ok: false, error: "missing_or_invalid_confirm_student_id" });
  });

  it("rejects array and object student ids", async () => {
    await expectJson(await invoke({ body: validBody({ studentId: ["student_a", "student_b"], confirmStudentId: STUDENT_ID }) }), 400, {
      ok: false,
      error: "missing_or_invalid_student_id",
    });
    await expectJson(await invoke({ body: validBody({ studentId: { id: "student_a" }, confirmStudentId: STUDENT_ID }) }), 400, {
      ok: false,
      error: "missing_or_invalid_student_id",
    });
  });

  it("rejects multiple, wildcard, percent, and newline ids", async () => {
    await expectJson(await invoke({ body: validBody({ studentId: "student_a,student_b", confirmStudentId: "student_a,student_b" }) }), 400, {
      ok: false,
      error: "missing_or_invalid_student_id",
    });
    await expectJson(await invoke({ body: validBody({ studentId: "*", confirmStudentId: "*" }) }), 400, {
      ok: false,
      error: "missing_or_invalid_student_id",
    });
    await expectJson(await invoke({ body: validBody({ studentId: "%", confirmStudentId: "%" }) }), 400, {
      ok: false,
      error: "missing_or_invalid_student_id",
    });
    await expectJson(await invoke({ body: validBody({ studentId: "student_a\nstudent_b", confirmStudentId: "student_a\nstudent_b" }) }), 400, {
      ok: false,
      error: "missing_or_invalid_student_id",
    });
  });

  it("rejects mismatched confirmation", async () => {
    const response = await invoke({ body: validBody({ confirmStudentId: "student_other" }) });
    await expectJson(response, 400, { ok: false, error: "confirm_student_id_mismatch" });
  });

  it("rejects when the candidate count is not exactly one", async () => {
    await expectJson(await invoke({ db: countDb(0), body: validBody() }), 409, { ok: false, error: "candidate_count_not_one", candidateCount: 0 });
    const response = await invoke({ db: countDb(2), body: validBody() });
    await expectJson(response, 409, { ok: false, error: "candidate_count_not_one", candidateCount: 2 });
  });

  it("returns helper blocked result intact", async () => {
    const response = await invoke({
      body: validBody(),
      repair: async () => result("blocked", { reason: "different_linked_person" }),
    });
    await expectJson(response, 409, { ok: false, result: "blocked", reason: "different_linked_person" });
  });

  it("returns helper failed result intact", async () => {
    const response = await invoke({
      body: validBody(),
      repair: async () => result("failed", { reason: "repair_batch_failed" }),
    });
    await expectJson(response, 500, { ok: false, result: "failed", reason: "repair_batch_failed" });
  });

  it("returns helper no-op result intact", async () => {
    const response = await invoke({
      body: validBody(),
      repair: async () => result("no_op", { elementsUnchanged: ["global_identity"] }),
    });
    await expectJson(response, 200, { ok: true, result: "no_op", elementsUnchanged: ["global_identity"] });
  });

  it("rejects unsupported methods and unknown routes without invoking repair", async () => {
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      const response = await invoke({ method, body: validBody() });
      await expectJson(response, 404, { ok: false, error: "not_found" });
    }
    const unknown = await invoke({ path: "/unknown", body: validBody() });
    await expectJson(unknown, 404, { ok: false, error: "not_found" });
  });

  it("allows only non-mutating health checks outside the repair route", async () => {
    const response = await handleHistoricalStudentAuthRepairOperatorRequest(
      new Request("http://operator.test/health"),
      { DB: countDb(1), OPERATOR_ALLOW_HISTORICAL_REPAIR: "true" },
    );
    await expectJson(response, 200, { ok: true, operator: "historical-student-auth-repair" });
  });

  it("returns bounded failure when candidate count lookup throws", async () => {
    const response = await invoke({ db: throwingDb(), body: validBody() });
    const body = await response.clone().text();
    await expectJson(response, 500, { ok: false, error: "operator_execution_failed" });
    expect(body).not.toContain("select count");
    expect(body).not.toContain("boom");
  });

  it("returns bounded failure when the helper throws without retrying", async () => {
    let calls = 0;
    const response = await invoke({
      body: validBody(),
      repair: async () => {
        calls += 1;
        throw new Error("secret internal boom");
      },
    });

    const body = await response.clone().text();
    await expectJson(response, 500, { ok: false, error: "operator_execution_failed" });
    expect(calls).toBe(1);
    expect(body).not.toContain("secret internal boom");
  });

  it("requires the operator enable flag", async () => {
    const response = await invoke({ body: validBody(), enabled: false });
    await expectJson(response, 403, { ok: false, error: "operator_not_enabled" });
  });

  it("is not exposed through the production Worker router", () => {
    const workerIndex = readFileSync(join(process.cwd(), "worker", "index.ts"), "utf8");
    expect(workerIndex).not.toContain("historical-student-auth-repair-operator");
    expect(workerIndex).not.toContain("repair-historical-student-auth");
  });

  it("keeps ordinary scripts away from the production operator config", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts.dev).not.toContain("historical-repair.operator.production");
    expect(packageJson.scripts.build).not.toContain("historical-repair.operator.production");
    expect(packageJson.scripts.test).not.toContain("historical-repair.operator.production");
    expect(packageJson.scripts["test:run"]).not.toContain("historical-repair.operator.production");
    expect(packageJson.scripts["test:release"]).not.toContain("historical-repair.operator.production");
  });

  it("imports the committed helper instead of reimplementing repair SQL", () => {
    const source = readFileSync(join(process.cwd(), "worker", "operator", "historical-student-auth-repair-operator.ts"), "utf8");
    expect(source).toContain("repairHistoricalStudentAuthCandidate");
    expect(source).toContain("../lib/historical-student-auth-repair");
    expect(source).not.toContain("insert into global_identities");
    expect(source).not.toContain("insert into login_accounts");
    expect(source).not.toContain("insert into organisation_memberships");
    expect(source).not.toContain("insert into login_account_people");
    expect(source).not.toContain("insert into person_roles");
  });
});

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    organisationId: ORG_ID,
    studentId: STUDENT_ID,
    confirmStudentId: STUDENT_ID,
    ...overrides,
  };
}

async function invoke(input: {
  body: Record<string, unknown>;
  db?: D1Database;
  enabled?: boolean;
  repair?: RepairFunction;
  method?: string;
  path?: string;
}) {
  const method = input.method ?? "POST";
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify(input.body);
  }

  return handleHistoricalStudentAuthRepairOperatorRequest(
    new Request(`http://operator.test${input.path ?? "/repair-historical-student-auth"}`, init),
    {
      DB: input.db ?? countDb(1),
      OPERATOR_ALLOW_HISTORICAL_REPAIR: input.enabled === false ? "false" : "true",
    },
    {
      now: () => "2026-10-07T00:00:00.000Z",
      repair: input.repair,
    },
  );
}

type RepairInput = {
  organisationId: string;
  studentId: string;
  now: string;
};

type RepairFunction = (
  c: AppContext,
  input: RepairInput,
) => Promise<HistoricalStudentAuthRepairResult>;

function countDb(candidateCount: number) {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first() {
          return { count: candidateCount };
        },
      };
    },
  } as unknown as D1Database;
}

function throwingDb() {
  return {
    prepare() {
      throw new Error("boom: select count from students");
    },
  } as unknown as D1Database;
}

function result(
  status: HistoricalStudentAuthRepairResult["result"],
  overrides: Partial<HistoricalStudentAuthRepairResult> = {},
): HistoricalStudentAuthRepairResult {
  return {
    studentId: STUDENT_ID,
    personId: "person_subject",
    result: status,
    elementsCreated: [],
    elementsReused: [],
    elementsUnchanged: [],
    ...overrides,
  };
}

async function expectJson(response: Response, status: number, expected: unknown) {
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toMatchObject(expected as Record<string, unknown>);
}
