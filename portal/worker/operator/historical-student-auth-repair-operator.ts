import type { AppContext } from "../lib/http";
import {
  repairHistoricalStudentAuthCandidate,
  type HistoricalStudentAuthRepairResult,
} from "../lib/historical-student-auth-repair";

type OperatorEnv = {
  DB: D1Database;
  OPERATOR_ALLOW_HISTORICAL_REPAIR?: string;
};

type RepairFunction = typeof repairHistoricalStudentAuthCandidate;

type OperatorOptions = {
  now?: () => string;
  repair?: RepairFunction;
};

type OperatorPayload = {
  organisationId?: unknown;
  studentId?: unknown;
  confirmStudentId?: unknown;
};

const OPERATOR_ROUTE = "/repair-historical-student-auth";
const SINGLE_ID_PATTERN = /^[A-Za-z0-9_:-]+$/;

export default {
  async fetch(request: Request, env: OperatorEnv) {
    return handleHistoricalStudentAuthRepairOperatorRequest(request, env);
  },
};

export async function handleHistoricalStudentAuthRepairOperatorRequest(
  request: Request,
  env: OperatorEnv,
  options: OperatorOptions = {},
) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, operator: "historical-student-auth-repair" });
  }

  if (request.method !== "POST" || url.pathname !== OPERATOR_ROUTE) {
    return json({ ok: false, error: "not_found" }, 404);
  }

  if (env.OPERATOR_ALLOW_HISTORICAL_REPAIR !== "true") {
    return json({ ok: false, error: "operator_not_enabled" }, 403);
  }

  try {
    const payload = await readPayload(request);
    const validation = validatePayload(payload);
    if (!validation.ok) return json({ ok: false, error: validation.error }, 400);

    const candidateCount = await countCandidate(env.DB, validation.organisationId, validation.studentId);
    if (candidateCount !== 1) {
      return json({ ok: false, error: "candidate_count_not_one", candidateCount }, 409);
    }

    const repair = options.repair ?? repairHistoricalStudentAuthCandidate;
    const result = await repair({ env } as unknown as AppContext, {
      organisationId: validation.organisationId,
      studentId: validation.studentId,
      now: options.now?.() ?? new Date().toISOString(),
    });

    return repairResponse(candidateCount, result);
  } catch {
    return json({ ok: false, error: "operator_execution_failed" }, 500);
  }
}

async function readPayload(request: Request): Promise<OperatorPayload> {
  try {
    const body = await request.json();
    return typeof body === "object" && body !== null ? body as OperatorPayload : {};
  } catch {
    return {};
  }
}

function validatePayload(payload: OperatorPayload):
  | { ok: true; organisationId: string; studentId: string }
  | { ok: false; error: string } {
  const organisationId = parseSingleId(payload.organisationId);
  if (!organisationId) return { ok: false, error: "missing_or_invalid_organisation_id" };

  const studentId = parseSingleId(payload.studentId);
  if (!studentId) return { ok: false, error: "missing_or_invalid_student_id" };

  const confirmStudentId = parseSingleId(payload.confirmStudentId);
  if (!confirmStudentId) return { ok: false, error: "missing_or_invalid_confirm_student_id" };
  if (confirmStudentId !== studentId) return { ok: false, error: "confirm_student_id_mismatch" };

  return { ok: true, organisationId, studentId };
}

function parseSingleId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value) return null;
  if (!SINGLE_ID_PATTERN.test(trimmed)) return null;
  if (trimmed === "*" || trimmed.includes(",") || trimmed.includes("%")) return null;
  return trimmed;
}

async function countCandidate(db: D1Database, organisationId: string, studentId: string) {
  const row = await db.prepare(
    `select count(*) as count
     from students
     where organisation_id = ?
       and id = ?`,
  )
    .bind(organisationId, studentId)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}

function auditResult(result: HistoricalStudentAuthRepairResult) {
  return {
    studentId: result.studentId,
    personId: result.personId,
    result: result.result,
    elementsCreated: result.elementsCreated,
    elementsReused: result.elementsReused,
    elementsUnchanged: result.elementsUnchanged,
    reason: result.reason,
  };
}

function repairResponse(candidateCount: number, result: HistoricalStudentAuthRepairResult) {
  const body = {
    ok: result.result === "repaired" || result.result === "no_op",
    candidateCount,
    ...auditResult(result),
  };
  if (result.result === "blocked") return json(body, 409);
  if (result.result === "failed") return json(body, 500);
  return json(body);
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
