import { relations } from "drizzle-orm";
import {
  auditLogs,
  authEvents,
  branches,
  loginAccountPeople,
  loginAccountRoles,
  loginAccounts,
  organisations,
  otpChallenges,
  people,
  personContacts,
  referrerProfiles,
  roles,
  userSessions,
} from "./schema";

export const branchesRelations = relations(branches, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [branches.organisationId],
    references: [organisations.id],
  }),
  people: many(people),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [people.organisationId],
    references: [organisations.id],
  }),
  homeBranch: one(branches, {
    fields: [people.homeBranchId],
    references: [branches.id],
  }),
  contacts: many(personContacts),
  accountLinks: many(loginAccountPeople),
  referrerProfile: one(referrerProfiles),
}));

export const personContactsRelations = relations(personContacts, ({ one }) => ({
  person: one(people, {
    fields: [personContacts.personId],
    references: [people.id],
  }),
}));

export const loginAccountsRelations = relations(loginAccounts, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [loginAccounts.organisationId],
    references: [organisations.id],
  }),
  people: many(loginAccountPeople),
  roles: many(loginAccountRoles),
  sessions: many(userSessions),
  otpChallenges: many(otpChallenges),
  authEvents: many(authEvents),
}));

export const loginAccountPeopleRelations = relations(loginAccountPeople, ({ one }) => ({
  loginAccount: one(loginAccounts, {
    fields: [loginAccountPeople.loginAccountId],
    references: [loginAccounts.id],
  }),
  person: one(people, {
    fields: [loginAccountPeople.personId],
    references: [people.id],
  }),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [roles.organisationId],
    references: [organisations.id],
  }),
  loginAccounts: many(loginAccountRoles),
}));

export const loginAccountRolesRelations = relations(loginAccountRoles, ({ one }) => ({
  loginAccount: one(loginAccounts, {
    fields: [loginAccountRoles.loginAccountId],
    references: [loginAccounts.id],
  }),
  role: one(roles, {
    fields: [loginAccountRoles.roleId],
    references: [roles.id],
  }),
  branch: one(branches, {
    fields: [loginAccountRoles.branchId],
    references: [branches.id],
  }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  loginAccount: one(loginAccounts, {
    fields: [userSessions.loginAccountId],
    references: [loginAccounts.id],
  }),
  activePerson: one(people, {
    fields: [userSessions.activePersonId],
    references: [people.id],
  }),
}));

export const otpChallengesRelations = relations(otpChallenges, ({ one }) => ({
  organisation: one(organisations, {
    fields: [otpChallenges.organisationId],
    references: [organisations.id],
  }),
  loginAccount: one(loginAccounts, {
    fields: [otpChallenges.loginAccountId],
    references: [loginAccounts.id],
  }),
}));

export const referrerProfilesRelations = relations(referrerProfiles, ({ one }) => ({
  organisation: one(organisations, {
    fields: [referrerProfiles.organisationId],
    references: [organisations.id],
  }),
  person: one(people, {
    fields: [referrerProfiles.personId],
    references: [people.id],
  }),
}));

export const authEventsRelations = relations(authEvents, ({ one }) => ({
  organisation: one(organisations, {
    fields: [authEvents.organisationId],
    references: [organisations.id],
  }),
  loginAccount: one(loginAccounts, {
    fields: [authEvents.loginAccountId],
    references: [loginAccounts.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organisation: one(organisations, {
    fields: [auditLogs.organisationId],
    references: [organisations.id],
  }),
  branch: one(branches, {
    fields: [auditLogs.branchId],
    references: [branches.id],
  }),
  actorLoginAccount: one(loginAccounts, {
    fields: [auditLogs.actorLoginAccountId],
    references: [loginAccounts.id],
  }),
  actorPerson: one(people, {
    fields: [auditLogs.actorPersonId],
    references: [people.id],
  }),
}));
