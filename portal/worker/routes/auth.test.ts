import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import type { WorkerBindings } from "../bindings";
import { hmacHex } from "../lib/crypto";

type Row = Record<string, any>;
type LookupOptions = Parameters<typeof installFetch>[0];

let currentLookupOptions: LookupOptions = {};

class FakeD1Statement {
  constructor(
    private readonly db: FakeD1,
    private readonly sql: string,
    private values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    const sql = compactSql(this.sql);
    if (sql.includes("count(*) as count from otp_challenges")) return { count: this.db.countChallenges(sql, this.values) } as T;
    if (sql.includes("select * from otp_challenges where id = ?")) {
      return (this.db.otpChallenges.find((row) => row.id === this.values[0]) ?? null) as T;
    }
    if (sql.includes("select id from login_accounts where organisation_id = ? and mobile_normalized = ?")) {
      return (this.db.loginAccounts.find((row) => row.organisation_id === this.values[0] && row.mobile_normalized === this.values[1]) ?? null) as T;
    }
    if (sql.includes("select mobile_last_four from login_accounts where id = ?")) {
      return (this.db.loginAccounts.find((row) => row.id === this.values[0]) ?? null) as T;
    }
    if (sql.includes("select * from user_sessions where token_hash = ?")) {
      return (this.db.userSessions.find((row) => row.token_hash === this.values[0]) ?? null) as T;
    }
    if (sql.includes("select 1 as ok from login_account_people")) {
      return (this.db.isLinkedProfileAvailable(String(this.values[0]), String(this.values[1])) ? { ok: 1 } : null) as T;
    }
    if (sql.includes("select * from referrer_profiles where person_id = ? and active = 1")) {
      return (this.db.referrerProfiles.find((row) => row.person_id === this.values[0] && row.active === 1) ?? null) as T;
    }
    if (sql.includes("select external_referrer_id from referrer_profiles where person_id = ? and active = 1")) {
      return (this.db.referrerProfiles.find((row) => row.person_id === this.values[0] && row.active === 1) ?? null) as T;
    }
    if (sql.includes("from referral_links") && sql.includes("referrer_profile_id = ?") && sql.includes("status = 'active'")) {
      const [_organisationId, referrerProfileId] = this.values;
      return (this.db.referralLinks.find((row) => row.referrer_profile_id === referrerProfileId && row.status === "active" && !row.revoked_at) ?? null) as T;
    }
    if (sql.includes("from people join referrer_profiles") && sql.includes("where people.id = ?")) {
      const person = this.db.people.find((row) => row.id === this.values[0] && row.organisation_id === this.values[1] && row.status === "active");
      if (!person) return null as T;
      const referrer = this.db.referrerProfiles.find((row) => row.person_id === person.id && row.active === 1);
      if (!referrer) return null as T;
      const personRole = this.db.personRoles.find((row) => row.person_id === person.id);
      const role = personRole ? this.db.roles.find((row) => row.id === personRole.role_id) : null;
      return {
        person_id: person.id,
        full_name: person.full_name,
        public_name: person.public_name,
        external_referrer_id: referrer.external_referrer_id,
        referral_token: referrer.referral_token,
        personal_link: referrer.personal_link,
        active: referrer.active,
        created_at: referrer.created_at,
        role_code: role?.code ?? null,
        course_studied: "Full Stack Development",
      } as T;
    }
    if (sql.includes("from students join people") && sql.includes("where students.organisation_id = ?") && sql.includes("students.person_id = ?")) {
      const [organisationId, personId] = this.values;
      const student = this.db.students.find((row) => row.organisation_id === organisationId && row.person_id === personId && row.portal_status !== "disabled");
      if (!student) return null as T;
      const person = this.db.people.find((row) => row.id === student.person_id && row.organisation_id === organisationId && row.status === "active");
      if (!person) return null as T;
      const branch = this.db.branches.find((row) => row.id === student.home_branch_id);
      const referrer = this.db.referrerProfiles.find((row) => row.person_id === person.id && row.organisation_id === organisationId && row.active === 1);
      return {
        full_name: person.full_name,
        public_name: person.public_name,
        student_id: student.id,
        student_number: student.student_number,
        student_since: student.student_since,
        current_status: student.current_status,
        branch_name: branch?.name ?? null,
        referrer_profile_id: referrer?.id ?? null,
      } as T;
    }
    if (sql.includes("from user_sessions")) return null as T;
    return null as T;
  }

  async all<T>() {
    const sql = compactSql(this.sql);
    if (sql.includes("select person_id, is_available from login_account_people")) {
      return {
        results: this.db.loginAccountPeople
          .filter((row) => row.login_account_id === this.values[0])
          .map((row) => ({ person_id: row.person_id, is_available: row.is_available })),
      } as T;
    }
    if (sql.includes("from person_contacts join people") && sql.includes("join referral_programme_referrer_types")) {
      const [mobileHash, organisationId] = this.values;
      const results: Row[] = [];
      for (const contact of this.db.personContacts.filter((row) => row.contact_type === "mobile" && row.normalized_value === mobileHash)) {
        const person = this.db.people.find((row) => row.id === contact.person_id && row.organisation_id === organisationId && row.status === "active");
        if (!person) continue;
        const details = this.db.personContactDetails.find((row) => row.contact_id === contact.id);
        if (details && details.status !== "active") continue;
        const student = this.db.students.find((row) => row.person_id === person.id && row.organisation_id === organisationId && row.portal_status !== "disabled");
        if (!student) continue;
        const referrer = this.db.referrerProfiles.find((row) => row.person_id === person.id && row.organisation_id === organisationId && row.active === 1);
        if (!referrer) continue;
        for (const personRole of this.db.personRoles.filter((row) => row.person_id === person.id)) {
          const role = this.db.roles.find((row) => row.id === personRole.role_id && ["student", "alumni"].includes(String(row.code)));
          if (!role) continue;
          results.push({
            person_id: person.id,
            full_name: person.full_name,
            public_name: person.public_name,
            student_number: student.student_number,
            current_status: student.current_status,
            external_referrer_id: referrer.external_referrer_id,
            referral_token: referrer.referral_token,
            personal_link: referrer.personal_link,
            active: referrer.active,
            created_at: referrer.created_at,
            role_code: role.code,
            course_studied: "Full Stack Development",
          });
        }
      }
      return { results } as T;
    }
    if (sql.includes("from enrolments join students") && sql.includes("join courses on courses.id = enrolments.course_id")) {
      const [organisationId, personId] = this.values;
      const student = this.db.students.find((row) => row.organisation_id === organisationId && row.person_id === personId);
      const results = this.db.enrolments
        .filter((row) => row.student_id === student?.id)
        .map((enrolment) => {
          const course = this.db.courses.find((row) => row.id === enrolment.course_id);
          return {
            enrolment_id: enrolment.id,
            enrolment_number: enrolment.enrolment_number,
            admission_date: enrolment.admission_date,
            joining_date: enrolment.joining_date,
            actual_completion_date: enrolment.actual_completion_date ?? null,
            status: enrolment.status,
            course_id: course?.id ?? "",
            course_code: course?.code ?? "",
            course_name: course?.name ?? "",
            duration_label: course?.duration_label ?? null,
          };
        });
      return { results } as T;
    }
    if (sql.includes("from login_account_people join people") && sql.includes("left join person_roles")) {
      const accountId = this.values[0];
      const results: Row[] = [];
      for (const link of this.db.loginAccountPeople.filter((row) => row.login_account_id === accountId && row.is_available === 1)) {
        const person = this.db.people.find((row) => row.id === link.person_id && row.status === "active");
        const referrer = this.db.referrerProfiles.find((row) => row.person_id === link.person_id && row.active === 1);
        if (!person || !referrer) continue;
        const personRoles = this.db.personRoles.filter((row) => row.person_id === person.id);
        if (personRoles.length === 0) {
          results.push({ person_id: person.id, public_name: person.public_name, access_type: link.access_type, role_code: null });
          continue;
        }
        for (const personRole of personRoles) {
          const role = this.db.roles.find((row) => row.id === personRole.role_id);
          results.push({ person_id: person.id, public_name: person.public_name, access_type: link.access_type, role_code: role?.code ?? null });
        }
      }
      return { results } as T;
    }
    if (sql.includes("from login_account_roles join roles")) {
      return {
        results: this.db.loginAccountRoles
          .filter((row) => row.login_account_id === this.values[0])
          .map((accountRole) => this.db.roles.find((role) => role.id === accountRole.role_id))
          .filter((role): role is Row => Boolean(role))
          .filter((role) => !["student", "alumni"].includes(String(role.code)))
          .map((role) => ({ code: role.code }))
          .sort((left, right) => left.code.localeCompare(right.code)),
      } as T;
    }
    if (sql.includes("from person_roles join roles")) {
      return {
        results: this.db.personRoles
          .filter((row) => row.person_id === this.values[0])
          .map((personRole) => this.db.roles.find((role) => role.id === personRole.role_id))
          .filter((role): role is Row => Boolean(role))
          .map((role) => ({ code: role.code }))
          .sort((left, right) => left.code.localeCompare(right.code)),
      } as T;
    }
    return { results: [] as T[] };
  }

  async run() {
    this.db.writes.push({ sql: this.sql, values: this.values });
    const sql = compactSql(this.sql);
    return { success: true, meta: { changes: this.db.run(sql, this.values) } };
  }
}

class FakeD1 {
  writes: Array<{ sql: string; values: unknown[] }> = [];
  otpChallenges: Row[] = [];
  loginAccounts: Row[] = [];
  branches: Row[] = [{ id: "branch_sion", name: "Sion", code: "SION" }];
  people: Row[] = [];
  personContacts: Row[] = [];
  personContactDetails: Row[] = [];
  students: Row[] = [];
  enrolments: Row[] = [];
  courses: Row[] = [{ id: "course_full_stack", code: "FULL_STACK", name: "Full Stack Development", duration_label: "12 months" }];
  referrerProfiles: Row[] = [];
  referralLinks: Row[] = [];
  loginAccountPeople: Row[] = [];
  loginAccountRoles: Row[] = [];
  personRoles: Row[] = [];
  userSessions: Row[] = [];
  authEvents: Row[] = [];
  auditLogs: Row[] = [];
  roles: Row[] = [
    { id: "role_owner", code: "owner" },
    { id: "role_student", code: "student" },
    { id: "role_alumni", code: "alumni" },
    { id: "role_counsellor", code: "counsellor" },
    { id: "role_trainer", code: "trainer" },
    { id: "role_system_admin", code: "system_admin" },
  ];

  prepare(sql: string) {
    return new FakeD1Statement(this, sql);
  }

  countChallenges(sql: string, values: unknown[]) {
    const [hash, since] = values as [unknown, string];
    if (sql.includes("mobile_hash = ?")) {
      return this.otpChallenges.filter((row) => row.mobile_hash === hash && row.requested_at >= since).length;
    }
    return this.otpChallenges.filter((row) => row.ip_hash === hash && row.requested_at >= since).length;
  }

  isLinkedProfileAvailable(loginAccountId: string, personId: string) {
    const link = this.loginAccountPeople.find((row) => row.login_account_id === loginAccountId && row.person_id === personId && row.is_available === 1);
    const person = this.people.find((row) => row.id === personId && row.status === "active");
    const referrer = this.referrerProfiles.find((row) => row.person_id === personId && row.active === 1);
    return Boolean(link && person && referrer);
  }

  run(sql: string, values: unknown[]) {
    if (sql.startsWith("insert into otp_challenges")) {
      const [id, organisationId, mobileHash, mobileLastFour, requestedAt, expiresAt, ipHash] = values;
      this.otpChallenges.push({
        id,
        organisation_id: organisationId,
        mobile_hash: mobileHash,
        mobile_last_four: mobileLastFour,
        mobile_ciphertext: null,
        provider: "none",
        status: "requested",
        verification_attempts: 0,
        resend_count: 0,
        last_sent_at: null,
        requested_at: requestedAt,
        expires_at: expiresAt,
        verified_at: null,
        ip_hash: ipHash,
      });
      return 1;
    }
    if (sql.startsWith("update otp_challenges set status = 'sent'")) {
      const [provider, providerRequestId, mobileCiphertext, lastSentAt, id] = values;
      const row = this.otpChallenges.find((challenge) => challenge.id === id && challenge.status === "requested");
      if (!row) return 0;
      Object.assign(row, { status: "sent", provider, provider_request_id: providerRequestId, mobile_ciphertext: mobileCiphertext, last_sent_at: lastSentAt });
      return 1;
    }
    if (sql.startsWith("update otp_challenges set status = 'blocked'")) {
      const row = this.otpChallenges.find((challenge) => challenge.id === values[0] && challenge.status === "requested");
      if (!row) return 0;
      row.status = "blocked";
      row.provider = "none";
      return 1;
    }
    if (sql.startsWith("update otp_challenges set status = 'failed'")) {
      const row = this.otpChallenges.find((challenge) => challenge.id === values[0] && ["requested", "sent"].includes(challenge.status));
      if (!row) return 0;
      row.status = "failed";
      return 1;
    }
    if (sql.startsWith("update otp_challenges set verification_attempts")) {
      const [id, maxAttempts, now] = values as [unknown, number, string];
      const row = this.otpChallenges.find(
        (challenge) => challenge.id === id && ["sent", "blocked"].includes(challenge.status) && challenge.verification_attempts < maxAttempts && challenge.expires_at > now,
      );
      if (!row) return 0;
      row.verification_attempts += 1;
      return 1;
    }
    if (sql.startsWith("update otp_challenges set resend_count")) {
      const [lastSentAt, providerRequestId, id, now, cooldownBefore] = values as [string, unknown, unknown, string, string];
      const row = this.otpChallenges.find(
        (challenge) =>
          challenge.id === id &&
          challenge.status === "sent" &&
          challenge.resend_count < 2 &&
          challenge.expires_at > now &&
          (!challenge.last_sent_at || challenge.last_sent_at <= cooldownBefore),
      );
      if (!row) return 0;
      row.resend_count += 1;
      row.last_sent_at = lastSentAt;
      if (providerRequestId) row.provider_request_id = providerRequestId;
      return 1;
    }
    if (sql.startsWith("update otp_challenges set status = 'verified'")) {
      const [verifiedAt, id, now] = values as [string, unknown, string];
      const row = this.otpChallenges.find((challenge) => challenge.id === id && challenge.status === "sent" && !challenge.verified_at && challenge.expires_at > now);
      if (!row) return 0;
      row.status = "verified";
      row.verified_at = verifiedAt;
      return 1;
    }
    if (sql.startsWith("insert into login_accounts")) {
      const [id, organisationId, mobileNormalized, mobileHash, mobileLastFour, lastLoginAt, createdAt, updatedAt] = values;
      let row = this.loginAccounts.find((account) => account.organisation_id === organisationId && account.mobile_normalized === mobileNormalized);
      if (!row) {
        row = { id, organisation_id: organisationId, mobile_normalized: mobileNormalized, mobile_hash: mobileHash, mobile_last_four: mobileLastFour, status: "active", created_at: createdAt };
        this.loginAccounts.push(row);
      }
      Object.assign(row, { mobile_hash: mobileHash, mobile_last_four: mobileLastFour, last_login_at: lastLoginAt, updated_at: updatedAt });
      return 1;
    }
    if (sql.startsWith("delete from login_account_roles")) {
      const [accountId] = values;
      const before = this.loginAccountRoles.length;
      this.loginAccountRoles = this.loginAccountRoles.filter((row) => row.login_account_id !== accountId || !["role_student", "role_alumni"].includes(row.role_id));
      return before - this.loginAccountRoles.length;
    }
    if (sql.startsWith("insert into people")) {
      const [id, organisationId, fullName, publicName, createdAt, updatedAt] = values;
      let row = this.people.find((person) => person.id === id);
      if (!row) {
        row = { id, organisation_id: organisationId, created_at: createdAt };
        this.people.push(row);
      }
      Object.assign(row, { full_name: fullName, public_name: publicName, status: "active", updated_at: updatedAt });
      return 1;
    }
    if (sql.startsWith("insert into person_contacts")) {
      const [id, personId, normalizedValue, displayValue, lastFour, verifiedAt, createdAt, updatedAt] = values;
      let row = this.personContacts.find((contact) => contact.person_id === personId && contact.contact_type === "mobile" && contact.normalized_value === normalizedValue);
      if (!row) {
        row = { id, person_id: personId, contact_type: "mobile", normalized_value: normalizedValue, display_value: displayValue, last_four: lastFour, created_at: createdAt };
        this.personContacts.push(row);
      }
      Object.assign(row, { is_primary: 1, is_verified: 1, verified_at: verifiedAt, updated_at: updatedAt });
      return 1;
    }
    if (sql.startsWith("insert into referrer_profiles")) {
      const [id, organisationId, personId, externalReferrerId, referralToken, personalLink, lastSyncedAt, createdAt, updatedAt] = values;
      let row = this.referrerProfiles.find((profile) => profile.organisation_id === organisationId && profile.external_referrer_id === externalReferrerId);
      if (!row) {
        row = { id, organisation_id: organisationId, external_referrer_id: externalReferrerId, created_at: createdAt };
        this.referrerProfiles.push(row);
      }
      Object.assign(row, { person_id: personId, referral_token: referralToken, personal_link: personalLink, active: 1, last_synced_at: lastSyncedAt, updated_at: updatedAt });
      return 1;
    }
    if (sql.startsWith("insert into login_account_people")) {
      const [loginAccountId, personId, isDefault, createdAt] = values;
      let row = this.loginAccountPeople.find((link) => link.login_account_id === loginAccountId && link.person_id === personId);
      if (!row) {
        row = { login_account_id: loginAccountId, person_id: personId, created_at: createdAt };
        this.loginAccountPeople.push(row);
      }
      Object.assign(row, { access_type: "self", is_default: isDefault, is_available: 1 });
      return 1;
    }
    if (sql.startsWith("insert into person_roles")) {
      const [personId, createdAt, _organisationId, roleCode] = values;
      const role = this.roles.find((row) => row.code === roleCode);
      if (!role || this.personRoles.some((row) => row.person_id === personId && row.role_id === role.id && row.branch_key === "")) return 0;
      this.personRoles.push({ person_id: personId, role_id: role.id, branch_id: null, branch_key: "", created_at: createdAt });
      return 1;
    }
    if (sql.startsWith("update login_account_people set is_available = 0")) {
      const [loginAccountId, personId] = values;
      const row = this.loginAccountPeople.find((link) => link.login_account_id === loginAccountId && link.person_id === personId);
      if (!row) return 0;
      row.is_available = 0;
      return 1;
    }
    if (sql.startsWith("update referrer_profiles set active = 0")) {
      const [_now, _updatedAt, personId] = values;
      const row = this.referrerProfiles.find((profile) => profile.person_id === personId && profile.active === 1);
      if (!row) return 0;
      row.active = 0;
      return 1;
    }
    if (sql.startsWith("update user_sessions set active_person_id = null where login_account_id")) {
      const [loginAccountId, personId] = values;
      let changes = 0;
      for (const session of this.userSessions.filter((row) => row.login_account_id === loginAccountId && row.active_person_id === personId)) {
        session.active_person_id = null;
        changes += 1;
      }
      return changes;
    }
    if (sql.startsWith("update user_sessions set active_person_id = null where id")) {
      const row = this.userSessions.find((session) => session.id === values[0]);
      if (!row) return 0;
      row.active_person_id = null;
      return 1;
    }
    if (sql.startsWith("insert into user_sessions")) {
      const [id, loginAccountId, activePersonId, tokenHash, createdAt, expiresAt, lastSeenAt, ipHash, userAgentHash] = values;
      this.userSessions.push({ id, login_account_id: loginAccountId, active_person_id: activePersonId, token_hash: tokenHash, created_at: createdAt, expires_at: expiresAt, last_seen_at: lastSeenAt, revoked_at: null, ip_hash: ipHash, user_agent_hash: userAgentHash });
      return 1;
    }
    if (sql.startsWith("update user_sessions set active_person_id = ?")) {
      const [personId, lastSeenAt, sessionId] = values;
      const row = this.userSessions.find((session) => session.id === sessionId);
      if (!row) return 0;
      row.active_person_id = personId;
      row.last_seen_at = lastSeenAt;
      return 1;
    }
    if (sql.startsWith("update user_sessions set last_seen_at")) {
      const [lastSeenAt, id] = values;
      const row = this.userSessions.find((session) => session.id === id);
      if (!row) return 0;
      row.last_seen_at = lastSeenAt;
      return 1;
    }
    if (sql.startsWith("update user_sessions set revoked_at")) {
      const [revokedAt, tokenHash] = values;
      const row = this.userSessions.find((session) => session.token_hash === tokenHash && !session.revoked_at);
      if (!row) return 0;
      row.revoked_at = revokedAt;
      return 1;
    }
    if (sql.startsWith("insert into auth_events")) {
      const [id, organisationId, loginAccountId, eventType, resultCode, mobileHash, mobileLastFour, ipHash, userAgentHash, createdAt] = values;
      this.authEvents.push({
        id,
        organisation_id: organisationId,
        login_account_id: loginAccountId,
        event_type: eventType,
        result_code: resultCode,
        mobile_hash: mobileHash,
        mobile_last_four: mobileLastFour,
        ip_hash: ipHash,
        user_agent_hash: userAgentHash,
        created_at: createdAt,
      });
      return 1;
    }
    if (sql.startsWith("insert into audit_logs")) {
      this.auditLogs.push({ values });
      return 1;
    }
    return 1;
  }
}

function env(db = new FakeD1(), overrides: Partial<WorkerBindings> = {}): WorkerBindings {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: "development",
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    SESSION_PEPPER: "test-pepper",
    DEV_OTP: "123456",
    ...overrides,
  };
}

function installFetch(options: {
  eligible?: boolean;
  profiles?: Array<{
    externalReferrerId: string;
    fullName: string;
    publicName: string;
    referrerType: string;
    courseStudied: string;
    memberSince: string;
    referralToken: string;
    personalLink: string;
    active: boolean;
  }>;
  turnstileOk?: boolean;
  msg91Ok?: boolean;
} = {}) {
  currentLookupOptions = options;
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("siteverify")) {
      return response({ success: options.turnstileOk ?? true, action: "request-otp", hostname: "localhost" }, 200);
    }
    if (href.includes("control.msg91.com")) {
      return response(options.msg91Ok === false ? { type: "error", message: "rejected" } : { type: "success", message: "success", request_id: "msg91-request" }, options.msg91Ok === false ? 500 : 200);
    }
    throw new Error(`Unexpected external fetch in D1 auth test: ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function profile(externalReferrerId: string, fullName: string, publicName: string, referrerType: string) {
  return {
    externalReferrerId,
    fullName,
    publicName,
    referrerType,
    courseStudied: "Full Stack Development",
    memberSince: "2026-07-01",
    referralToken: `${externalReferrerId}_TOKEN`,
    personalLink: `https://example.test/r/${externalReferrerId}_TOKEN`,
    active: true,
  };
}

async function requestOtp(db: FakeD1, mobile = "9876543210", bindings = env(db)) {
  await seedLookupProfiles(db, mobile, currentLookupOptions, bindings.SESSION_PEPPER);
  return app.request(
    "http://localhost/api/auth/request-otp",
    {
      method: "POST",
      headers: { Origin: "http://localhost", "Content-Type": "application/json" },
      body: JSON.stringify({ mobile, turnstileToken: "token" }),
    },
    bindings,
  );
}

async function seedLookupProfiles(db: FakeD1, mobile: string, options: LookupOptions, sessionPepper: string) {
  if (options?.eligible === false) return;
  const profiles = options?.profiles ?? [profile("STU1", "Asha Student", "Asha", "Student")];
  const returnedExternalIds = new Set(profiles.map((item) => item.externalReferrerId));
  for (const existing of db.referrerProfiles) {
    if (returnedExternalIds.has(String(existing.external_referrer_id))) continue;
    const contact = db.personContacts.find((row) => row.person_id === existing.person_id && row.contact_type === "mobile");
    const details = contact ? db.personContactDetails.find((row) => row.contact_id === contact.id) : null;
    if (details) details.status = "inactive";
  }
  const mobileHash = await hmacHex(sessionPepper, "mobile", mobile);
  for (const item of profiles) {
    const personId = stableTestId("person", item.externalReferrerId);
    const referrerId = stableTestId("ref", item.externalReferrerId);
    const contactId = stableTestId("contact", `${item.externalReferrerId}-mobile`);
    const roleId = item.referrerType.toLowerCase().includes("alumni") ? "role_alumni" : "role_student";
    if (!db.people.some((row) => row.id === personId)) {
      db.people.push({ id: personId, organisation_id: "org_samyak", full_name: item.fullName, public_name: item.publicName, status: "active", created_at: item.memberSince, updated_at: item.memberSince });
    }
    if (!db.personContacts.some((row) => row.person_id === personId && row.contact_type === "mobile" && row.normalized_value === mobileHash)) {
      db.personContacts.push({ id: contactId, person_id: personId, contact_type: "mobile", normalized_value: mobileHash, last_four: mobile.slice(-4), is_primary: 1, is_verified: 1, created_at: item.memberSince, updated_at: item.memberSince });
    }
    if (!db.personContactDetails.some((row) => row.contact_id === contactId)) {
      db.personContactDetails.push({ contact_id: contactId, status: "active" });
    } else {
      db.personContactDetails.find((row) => row.contact_id === contactId)!.status = "active";
    }
    if (!db.students.some((row) => row.person_id === personId && row.organisation_id === "org_samyak")) {
      const sequence = db.students.length + 1;
      db.students.push({
        id: stableTestId("student", item.externalReferrerId),
        organisation_id: "org_samyak",
        person_id: personId,
        home_branch_id: "branch_sion",
        student_number: `SYK-SION-${String(sequence).padStart(6, "0")}`,
        sequence_number: sequence,
        student_since: item.memberSince,
        current_status: item.referrerType.toLowerCase().includes("alumni") ? "completed" : "on_hold",
        portal_status: "active",
        created_at: item.memberSince,
        updated_at: item.memberSince,
      });
    }
    const student = db.students.find((row) => row.person_id === personId && row.organisation_id === "org_samyak");
    if (student && !db.enrolments.some((row) => row.student_id === student.id)) {
      db.enrolments.push({
        id: stableTestId("enrol", item.externalReferrerId),
        student_id: student.id,
        branch_id: "branch_sion",
        course_id: "course_full_stack",
        enrolment_number: `ENR-SION-${String(db.enrolments.length + 1).padStart(6, "0")}`,
        admission_date: item.memberSince,
        joining_date: item.memberSince,
        actual_completion_date: item.referrerType.toLowerCase().includes("alumni") ? item.memberSince : null,
        status: item.referrerType.toLowerCase().includes("alumni") ? "completed" : "on_hold",
      });
    }
    const existingReferrer = db.referrerProfiles.find((row) => row.organisation_id === "org_samyak" && row.external_referrer_id === item.externalReferrerId);
    if (existingReferrer) {
      Object.assign(existingReferrer, { person_id: personId, referral_token: item.referralToken, personal_link: item.personalLink, active: item.active ? 1 : 0, updated_at: item.memberSince });
    } else {
      db.referrerProfiles.push({ id: referrerId, organisation_id: "org_samyak", person_id: personId, external_referrer_id: item.externalReferrerId, referral_token: item.referralToken, personal_link: item.personalLink, active: item.active ? 1 : 0, created_at: item.memberSince, updated_at: item.memberSince });
    }
    if (!db.personRoles.some((row) => row.person_id === personId && row.role_id === roleId)) {
      db.personRoles.push({ person_id: personId, role_id: roleId, branch_id: null, branch_key: "", created_at: item.memberSince });
    }
  }
}

function stableTestId(prefix: string, value: string) {
  return `${prefix}_${value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)}`;
}

async function verifyOtp(db: FakeD1, challengeId: string, otp = "000000", cookie?: string, bindings = env(db)) {
  return app.request(
    "http://localhost/api/auth/verify-otp",
    {
      method: "POST",
      headers: { Origin: "http://localhost", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ challengeId, otp }),
    },
    bindings,
  );
}

function sessionCookie(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

function rawSessionToken(cookie: string) {
  return cookie.slice(cookie.indexOf("=") + 1);
}

function authResultCodes(db: FakeD1) {
  return db.authEvents.map((event) => event.result_code);
}

async function jsonBody(response: Response): Promise<Row> {
  return (await response.json()) as Row;
}

function compactSql(sql: string) {
  return sql.toLowerCase().replace(/\s+/g, " ").trim();
}

function response(body: unknown, status: number) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth routes", () => {
  it("requires same-origin for state-changing auth requests", async () => {
    const response = await app.request(
      "http://localhost/api/auth/request-otp",
      {
        method: "POST",
        headers: { Origin: "https://evil.test", "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: "9876543210", turnstileToken: "token" }),
      },
      env(),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not enable permissive CORS for preflight requests", async () => {
    const response = await app.request(
      "http://localhost/api/auth/request-otp",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://evil.test",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type",
        },
      },
      env(),
    );
    expect(response.status).toBeLessThan(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("returns generic unknown-mobile challenge shape and stores no plaintext mobile in D1", async () => {
    const db = new FakeD1();
    installFetch({ eligible: false });
    const response = await requestOtp(db);
    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body).toMatchObject({
      success: true,
      maskedMobile: "******3210",
      message: "If this mobile number is registered, an OTP has been sent.",
    });
    expect(db.otpChallenges[0]).toMatchObject({ status: "blocked", provider: "none", mobile_ciphertext: null });
    expect(JSON.stringify(db)).not.toContain("9876543210");
  });

  it("matches known and unknown invalid OTP response structure while counting attempts", async () => {
    const knownDb = new FakeD1();
    installFetch({ eligible: true });
    const knownRequest = await requestOtp(knownDb);
    const knownChallenge = String((await jsonBody(knownRequest)).challengeId);
    const knownVerify = await verifyOtp(knownDb, knownChallenge, "111111");

    const unknownDb = new FakeD1();
    installFetch({ eligible: false });
    const unknownRequest = await requestOtp(unknownDb);
    const unknownChallenge = String((await jsonBody(unknownRequest)).challengeId);
    const unknownVerify = await verifyOtp(unknownDb, unknownChallenge, "111111");

    expect(knownVerify.status).toBe(400);
    expect(unknownVerify.status).toBe(400);
    await expect(knownVerify.json()).resolves.toMatchObject({ success: false, code: "INVALID_OTP", message: "The OTP could not be verified." });
    await expect(unknownVerify.json()).resolves.toMatchObject({ success: false, code: "INVALID_OTP", message: "The OTP could not be verified." });
    expect(knownDb.otpChallenges[0].verification_attempts).toBe(1);
    expect(unknownDb.otpChallenges[0].verification_attempts).toBe(1);
  });

  it("returns the same expiry and attempt-limit codes for known and unknown challenges", async () => {
    for (const eligible of [true, false]) {
      const db = new FakeD1();
      installFetch({ eligible });
      const otpResponse = await requestOtp(db);
      const challengeId = String((await jsonBody(otpResponse)).challengeId);
      db.otpChallenges[0].expires_at = "2000-01-01T00:00:00.000Z";
      const expired = await verifyOtp(db, challengeId, "111111");
      expect(expired.status).toBe(400);
      await expect(expired.json()).resolves.toMatchObject({ success: false, code: "OTP_EXPIRED" });

      db.otpChallenges[0].expires_at = "2999-01-01T00:00:00.000Z";
      db.otpChallenges[0].verification_attempts = 5;
      const limited = await verifyOtp(db, challengeId, "111111");
      expect(limited.status).toBe(429);
      await expect(limited.json()).resolves.toMatchObject({ success: false, code: "TOO_MANY_ATTEMPTS" });
    }
  });

  it("isolates student and alumni roles on shared mobile profiles", async () => {
    const db = new FakeD1();
    installFetch({
      profiles: [
        profile("STU1", "Asha Student", "Asha", "Student"),
        profile("ALU1", "Ravi Alumni", "Ravi", "Alumni"),
      ],
    });
    const otpResponse = await requestOtp(db);
    const challengeId = String((await jsonBody(otpResponse)).challengeId);
    const verifyResponse = await verifyOtp(db, challengeId, "123456");
    expect(verifyResponse.status).toBe(200);
    const body = await jsonBody(verifyResponse);
    expect(body.session.activeProfile).toBeNull();
    expect(body.session.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ personId: "person_stu1", roles: ["student"] }),
        expect.objectContaining({ personId: "person_alu1", roles: ["alumni"] }),
      ]),
    );
    expect(body.session.mobileLastFour).toBe("3210");
    expect(body.session.profiles.find((item: Row) => item.personId === "person_stu1").roles).not.toContain("alumni");
    expect(body.session.profiles.find((item: Row) => item.personId === "person_alu1").roles).not.toContain("student");

    const cookie = sessionCookie(verifyResponse);
    const selected = await app.request(
      "http://localhost/api/auth/select-profile",
      {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ personId: "person_alu1" }),
      },
      env(db),
    );
    expect(selected.status).toBe(200);
    const alumniHome = await app.request("http://localhost/api/student/home", { headers: { Cookie: cookie } }, env(db));
    await expect(alumniHome.json()).resolves.toMatchObject({
      identity: {
        personId: "person_alu1",
        studentId: "SYK-SION-000002",
        lifecycleStatus: "ALUMNI",
      },
      courseHistory: [expect.objectContaining({ status: "completed" })],
    });
  });

  it("rejects selecting unrelated or another account's linked person", async () => {
    const db = new FakeD1();
    installFetch();
    const otpResponse = await requestOtp(db);
    const verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456");
    const cookie = sessionCookie(verifyResponse);
    db.people.push({ id: "person_other", organisation_id: "org_samyak", full_name: "Other Student", public_name: "Other", status: "active", created_at: "2026-07-01", updated_at: "2026-07-01" });
    db.students.push({ id: "student_other", organisation_id: "org_samyak", person_id: "person_other", home_branch_id: "branch_sion", student_number: "SYK-SION-999999", sequence_number: 999999, student_since: "2026-07-01", current_status: "active", portal_status: "active" });
    db.referrerProfiles.push({ id: "ref_other", organisation_id: "org_samyak", person_id: "person_other", external_referrer_id: "OTHER", referral_token: "OTHER_TOKEN", personal_link: "https://example.test/r/OTHER", active: 1, created_at: "2026-07-01", updated_at: "2026-07-01" });
    db.loginAccountPeople.push({ login_account_id: "acct_other", person_id: "person_other", access_type: "self", is_default: 1, is_available: 1, created_at: "2026-07-01" });

    for (const personId of ["person_missing", "person_other"]) {
      const response = await app.request(
        "http://localhost/api/auth/select-profile",
        {
          method: "POST",
          headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ personId }),
        },
        env(db),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ success: false, code: "PROFILE_NOT_LINKED" });
    }
  });

  it("handles synthetic shared-mobile scale with one login account and distinct linked people", async () => {
    const db = new FakeD1();
    const profiles = Array.from({ length: 25 }, (_, index) =>
      profile(`SHARED${index + 1}`, `Shared Person ${index + 1}`, `Shared ${index + 1}`, index % 2 === 0 ? "Student" : "Alumni"),
    );
    installFetch({ profiles });
    let otpResponse = await requestOtp(db);
    let verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456");
    expect(verifyResponse.status).toBe(200);
    let body = await jsonBody(verifyResponse);
    expect(body.session.activeProfile).toBeNull();
    expect(body.session.profiles).toHaveLength(25);
    expect(new Set(body.session.profiles.map((item: Row) => item.personId)).size).toBe(25);
    expect(db.loginAccounts).toHaveLength(1);
    expect(db.loginAccountPeople).toHaveLength(25);
    expect(db.people).toHaveLength(25);

    db.otpChallenges.forEach((challenge) => {
      challenge.requested_at = "2000-01-01T00:00:00.000Z";
    });
    otpResponse = await requestOtp(db);
    verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456");
    body = await jsonBody(verifyResponse);
    expect(verifyResponse.status).toBe(200);
    expect(body.session.profiles).toHaveLength(25);
    expect(db.loginAccounts).toHaveLength(1);
    expect(db.loginAccountPeople).toHaveLength(25);
    expect(db.people).toHaveLength(25);
  });

  it("synchronises returned profiles without rewriting referrer profiles", async () => {
    const db = new FakeD1();
    installFetch({ profiles: [profile("STU1", "Asha Student", "Asha", "Student"), profile("ALU1", "Ravi Alumni", "Ravi", "Alumni")] });
    let otpResponse = await requestOtp(db);
    let verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456");
    const cookie = sessionCookie(verifyResponse);

    await app.request(
      "http://localhost/api/auth/select-profile",
      {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ personId: "person_alu1" }),
      },
      env(db),
    );

    db.otpChallenges.forEach((challenge) => {
      challenge.requested_at = "2000-01-01T00:00:00.000Z";
    });
    installFetch({ profiles: [profile("STU1", "Asha Student", "Asha", "Student")] });
    otpResponse = await requestOtp(db, "9876543210");
    verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456");
    expect(verifyResponse.status).toBe(200);
    expect(db.loginAccountPeople.find((link) => link.person_id === "person_alu1")?.is_available).toBe(0);
    expect(db.referrerProfiles.find((link) => link.person_id === "person_alu1")?.active).toBe(1);
    expect(db.userSessions.every((session) => session.active_person_id !== "person_alu1")).toBe(true);
    expect(db.auditLogs.length).toBeGreaterThan(0);
  });

  it("keeps the session authenticated across refreshes, browser reopen, direct app checks and referrals", async () => {
    const db = new FakeD1();
    const fetchMock = installFetch();
    const otpResponse = await requestOtp(db);
    const challengeId = String((await jsonBody(otpResponse)).challengeId);
    const verifyResponse = await verifyOtp(db, challengeId, "123456");
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get("set-cookie")).toContain("Max-Age=2592000");
    const cookie = sessionCookie(verifyResponse);
    expect(cookie).toMatch(/^samyak_session=/);
    const productionCookie = cookie.replace(/^samyak_session=/, "__Host-samyak_session=");

    fetchMock.mockClear();
    const firstRefresh = await app.request("http://localhost/api/auth/session", { headers: { Cookie: cookie } }, env(db));
    const secondRefresh = await app.request("http://localhost/api/auth/session", { headers: { Cookie: cookie } }, env(db));
    const directAppSessionCheck = await app.request("https://portal.samyaksion.com/api/auth/session", { headers: { Cookie: productionCookie } }, env(db, { ENVIRONMENT: "production" }));
    const reopenedMobileSafari = await app.request(
      "https://portal.samyaksion.com/api/auth/session",
      {
        headers: {
          Cookie: productionCookie,
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
        },
      },
      env(db, { ENVIRONMENT: "production" }),
    );

    await expect(firstRefresh.json()).resolves.toMatchObject({ authenticated: true, activeProfile: expect.objectContaining({ personId: "person_stu1" }) });
    await expect(secondRefresh.json()).resolves.toMatchObject({ authenticated: true, activeProfile: expect.objectContaining({ personId: "person_stu1" }) });
    await expect(directAppSessionCheck.json()).resolves.toMatchObject({ authenticated: true });
    await expect(reopenedMobileSafari.json()).resolves.toMatchObject({ authenticated: true });
    expect(fetchMock).not.toHaveBeenCalled();

    const referrals = await app.request("http://localhost/api/student/referrals", { headers: { Cookie: cookie } }, env(db));
    expect(referrals.status).toBe(200);
    await expect(referrals.json()).resolves.toMatchObject({ success: true, referrals: [] });
    expect(fetchMock).not.toHaveBeenCalled();

    const home = await app.request("http://localhost/api/student/home", { headers: { Cookie: cookie } }, env(db));
    expect(home.status).toBe(200);
    const homeBody = await jsonBody(home);
    expect(homeBody).toMatchObject({
      success: true,
      identity: {
        personId: "person_stu1",
        studentId: "SYK-SION-000001",
        lifecycleStatus: "CURRENT",
        studentStatus: "on_hold",
      },
      courseHistory: [expect.objectContaining({ courseName: "Full Stack Development", status: "on_hold" })],
      skillCircle: { programmeName: "Samyak Skill Circle", referralDashboardPath: "/app/referrals" },
    });
    expect(JSON.stringify(homeBody)).not.toContain("9876543210");
    expect(fetchMock).not.toHaveBeenCalled();

    db.students.find((student) => student.person_id === "person_stu1")!.current_status = "completed";
    const staleAggregateHome = await app.request("http://localhost/api/student/home", { headers: { Cookie: cookie } }, env(db));
    expect(staleAggregateHome.status).toBe(200);
    await expect(staleAggregateHome.json()).resolves.toMatchObject({
      identity: {
        lifecycleStatus: "CURRENT",
        studentStatus: "completed",
      },
      courseHistory: [expect.objectContaining({ status: "on_hold" })],
    });
  });

  it("accepts a session after simulated Worker restart and ordinary deployment when SESSION_PEPPER is stable", async () => {
    const db = new FakeD1();
    const loginBindings = env(db, { SESSION_PEPPER: "stable-pepper" });
    installFetch();
    const otpResponse = await requestOtp(db, "9876543210", loginBindings);
    const verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456", undefined, loginBindings);
    const cookie = sessionCookie(verifyResponse);
    const token = rawSessionToken(cookie);
    const productionCookie = cookie.replace(/^samyak_session=/, "__Host-samyak_session=");

    const restartedWorker = env(db, { SESSION_PEPPER: "stable-pepper" });
    await expect((await app.request("http://localhost/api/auth/session", { headers: { Cookie: cookie } }, restartedWorker)).json()).resolves.toMatchObject({
      authenticated: true,
    });

    const deployedWorker = env(db, { ENVIRONMENT: "production", SESSION_PEPPER: "stable-pepper" });
    await expect((await app.request("https://portal.samyaksion.com/api/auth/session", { headers: { Cookie: productionCookie } }, deployedWorker)).json()).resolves.toMatchObject({
      authenticated: true,
    });
    expect(db.userSessions[0].token_hash).not.toBe(token);
    expect(JSON.stringify(db.userSessions)).not.toContain(token);
  });

  it("clears a stale active profile without destroying a valid account session", async () => {
    const db = new FakeD1();
    installFetch({ profiles: [profile("STU1", "Asha Student", "Asha", "Student"), profile("ALU1", "Ravi Alumni", "Ravi", "Alumni")] });
    const otpResponse = await requestOtp(db);
    const verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456");
    const cookie = sessionCookie(verifyResponse);

    await app.request(
      "http://localhost/api/auth/select-profile",
      {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ personId: "person_alu1" }),
      },
      env(db),
    );
    db.loginAccountPeople.find((link) => link.person_id === "person_alu1")!.is_available = 0;
    db.referrerProfiles.find((profile) => profile.person_id === "person_alu1")!.active = 0;

    const response = await app.request("http://localhost/api/auth/session", { headers: { Cookie: cookie } }, env(db));
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      authenticated: true,
      activeProfile: null,
      profiles: [expect.objectContaining({ personId: "person_stu1" })],
    });
    expect(db.userSessions[0].active_person_id).toBeNull();
    expect(authResultCodes(db)).toContain("SESSION_PROFILE_CLEARED");

    const referrals = await app.request("http://localhost/api/student/referrals", { headers: { Cookie: cookie } }, env(db));
    expect(referrals.status).toBe(409);
    expect(referrals.headers.get("set-cookie")).toBeNull();
  });

  it("stores no plaintext mobile after eligible and unknown login paths", async () => {
    const knownDb = new FakeD1();
    installFetch({ eligible: true });
    const knownOtp = await requestOtp(knownDb);
    const peopleBeforeLogin = knownDb.people.length;
    const referrersBeforeLogin = knownDb.referrerProfiles.length;
    const contactsBeforeLogin = knownDb.personContacts.length;
    await verifyOtp(knownDb, String((await jsonBody(knownOtp)).challengeId), "123456");
    expect(knownDb.people).toHaveLength(peopleBeforeLogin);
    expect(knownDb.referrerProfiles).toHaveLength(referrersBeforeLogin);
    expect(knownDb.personContacts).toHaveLength(contactsBeforeLogin);
    expect(JSON.stringify(knownDb.loginAccounts)).not.toContain("9876543210");
    expect(JSON.stringify(knownDb.personContacts)).not.toContain("9876543210");
    expect(JSON.stringify(knownDb.authEvents)).not.toContain("9876543210");
    expect(JSON.stringify(knownDb.auditLogs)).not.toContain("9876543210");
    expect(knownDb.otpChallenges[0].mobile_ciphertext).toMatch(/^v1:/);
    expect(knownDb.otpChallenges[0].mobile_ciphertext).not.toContain("9876543210");

    const unknownDb = new FakeD1();
    installFetch({ eligible: false });
    const unknownOtp = await requestOtp(unknownDb);
    await verifyOtp(unknownDb, String((await jsonBody(unknownOtp)).challengeId), "123456");
    expect(unknownDb.loginAccounts).toHaveLength(0);
    expect(unknownDb.people).toHaveLength(0);
    expect(unknownDb.referrerProfiles).toHaveLength(0);
    expect(unknownDb.otpChallenges[0].mobile_ciphertext).toBeNull();
    expect(JSON.stringify(unknownDb)).not.toContain("9876543210");
  });

  it("counts provider failures after Turnstile and does not call external services on Turnstile failure", async () => {
    const providerDb = new FakeD1();
    installFetch({ msg91Ok: false });
    const providerFailure = await requestOtp(
      providerDb,
      "9876543210",
      env(providerDb, { MSG91_AUTH_KEY: "test", MSG91_TEMPLATE_ID: "template", DEV_OTP: undefined }),
    );
    expect(providerFailure.status).toBe(503);
    expect(providerDb.otpChallenges[0].status).toBe("failed");

    const turnstileDb = new FakeD1();
    const fetchMock = installFetch({ turnstileOk: false });
    const turnstileFailure = await requestOtp(turnstileDb);
    expect(turnstileFailure.status).toBe(403);
    expect(turnstileDb.otpChallenges).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears invalid, revoked and expired sessions", async () => {
    const db = new FakeD1();
    installFetch();
    const otpResponse = await requestOtp(db);
    const verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456");
    const cookie = sessionCookie(verifyResponse);

    const invalidToken = await app.request("http://localhost/api/auth/session", { headers: { Cookie: "samyak_session=bad-token" } }, env(db));
    expect(invalidToken.status).toBe(200);
    await expect(invalidToken.json()).resolves.toMatchObject({ authenticated: false, activeProfile: null, profiles: [], code: "SESSION_TOKEN_NOT_FOUND" });
    expect(invalidToken.headers.get("set-cookie")).toContain("Max-Age=0");

    for (const [expectedCode, mutate] of [
      [
        "SESSION_REVOKED",
        () => {
          db.userSessions[0].revoked_at = new Date().toISOString();
        },
      ],
      [
        "SESSION_ABSOLUTE_EXPIRED",
        () => {
          db.userSessions[0].revoked_at = null;
          db.userSessions[0].expires_at = "2000-01-01T00:00:00.000Z";
        },
      ],
      [
        "SESSION_INACTIVE_EXPIRED",
        () => {
          db.userSessions[0].expires_at = "2999-01-01T00:00:00.000Z";
          db.userSessions[0].last_seen_at = "2000-01-01T00:00:00.000Z";
        },
      ],
    ] as const) {
      mutate();
      const response = await app.request("http://localhost/api/auth/session", { headers: { Cookie: cookie } }, env(db));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        authenticated: false,
        activeProfile: null,
        profiles: [],
        code: expectedCode,
      });
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    }
    expect(authResultCodes(db)).toEqual(expect.arrayContaining(["SESSION_TOKEN_NOT_FOUND", "SESSION_REVOKED", "SESSION_ABSOLUTE_EXPIRED", "SESSION_INACTIVE_EXPIRED"]));
  });

  it("throttles last_seen_at updates and clears logout cookies", async () => {
    const db = new FakeD1();
    installFetch();
    const otpResponse = await requestOtp(db);
    const verifyResponse = await verifyOtp(db, String((await jsonBody(otpResponse)).challengeId), "123456");
    const cookie = sessionCookie(verifyResponse);
    const originalLastSeen = db.userSessions[0].last_seen_at;

    await app.request("http://localhost/api/auth/session", { headers: { Cookie: cookie } }, env(db));
    expect(db.userSessions[0].last_seen_at).toBe(originalLastSeen);

    db.userSessions[0].last_seen_at = new Date(Date.now() - 7 * 60 * 60_000).toISOString();
    await app.request("http://localhost/api/auth/session", { headers: { Cookie: cookie } }, env(db));
    expect(db.userSessions[0].last_seen_at).not.toBe(originalLastSeen);

    const logoutResponse = await app.request(
      "http://localhost/api/auth/logout",
      { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: cookie }, body: "{}" },
      env(db),
    );
    expect(logoutResponse.headers.get("set-cookie")).toMatch(/^samyak_session=;/);
    expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(db.userSessions[0].revoked_at).toBeTruthy();
  });

  it("fails clearly when SESSION_PEPPER is missing instead of creating a fallback secret", async () => {
    const response = await app.request("http://localhost/api/auth/session", {}, env(new FakeD1(), { SESSION_PEPPER: "" }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "server_configuration_error",
        message: "Authentication is temporarily unavailable.",
      },
    });
  });

  it("keeps /api/health working and rejects unauthenticated dashboard access", async () => {
    expect((await app.request("https://portal.test/api/health", {}, env())).status).toBe(200);
    expect((await app.request("https://portal.test/api/student/referrals", {}, env())).status).toBe(401);
  });
});
