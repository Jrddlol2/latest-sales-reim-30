// Loads .env for local dev (e.g. DATABASE_URL). Never overrides a variable
// the host environment already set, so this is a no-op in production, where
// real env vars are configured directly (see .env.example's own note).
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import multer from 'multer';
// NOTE: `vite` is imported dynamically inside the dev-only branch of createApp()
// so it never loads in a production/serverless bundle (Vercel), where it isn't used.
import { v4 as uuidv4 } from 'uuid';
import {
  User, UserRole, Mom, MomStatus, MinutesSource, Claim, ClaimStatus,
  ExpenseLineItem, Approval, StatusHistory, Email,
  CashAdvance, CashAdvanceStatus, Liquidation, LiquidationStatus,
  LiquidationVarianceType, LiquidationLineItem,
  ReviewMeeting, ReviewMeetingStatus, Company, SupportRequest, SupportRequestMessage, SupportRequestStatus, SupportRequestPriority, ImportBatch,
  ApproverDelegation, DelegationStatus,
  MasterDataRecord, Department, CostCenter, BusinessUnit, Branch, ProjectCode, Vendor,
  FieldDefinition
} from './src/serverTypes';
import {
  getReimbursementDateError,
  getTodayIsoDate,
} from './src/lib/reimbursementPolicy';
import { normalizeExpenseCategory } from './src/lib/expenseCategories';
import { isClaimTypeEnabled, COMING_SOON_MESSAGE } from './src/lib/featureFlags';
import { isDbConfigured, loadUsersFromDb, syncUsersToDb, clearUsersInDb, loadUserHistoryFromDb } from './src/db/usersRepo';
import { getDb } from './src/db/index';
import { sql } from 'drizzle-orm';
import {
  persistMom, persistClaim, persistExpenseLineItems, persistClaimWithLineItems, insertApproval,
  persistStatusHistoryFireAndForget, loadCoreLoopFromDb, clearCoreLoopInDb,
  nextClaimNumberFromDb, syncClaimNumberSequenceFloor, persistHistoricalImportBatch,
} from './src/db/coreLoopRepo';
import { getPersistenceHealth } from './src/db/persistenceHealth';
import {
  persistCashAdvance, persistLiquidation, persistLiquidationLineItems,
  persistLiquidationLineItem, deleteLiquidationLineItem, loadCashAdvanceLoopFromDb, clearCashAdvanceLoopInDb,
} from './src/db/cashAdvanceRepo';
import {
  persistCompany, loadCompaniesFromDb, persistMasterDataRecord, loadMasterDataTable, type MasterDataKey,
  persistFieldDefinition, loadFieldDefinitionsFromDb, persistSystemSettings, loadSystemSettingsFromDb,
  clearReferenceDataInDb, loadMasterDataHistoryFromDb,
} from './src/db/referenceDataRepo';
import {
  persistDelegation, loadDelegationsFromDb, loadDelegationHistoryFromDb, persistReviewMeeting, loadReviewMeetingsFromDb,
  persistSupportRequest, insertSupportMessage, loadSupportRequestsFromDb, clearWorkflowExtrasInDb,
} from './src/db/workflowExtrasRepo';
import pino from 'pino';
import pinoHttp from 'pino-http';

// Server-only — deliberately not under src/lib/ (which is shared with the
// Vite-bundled frontend); pino depends on Node built-ins that have no
// business in a browser bundle, so this stays a server.ts-local concern.
// Pretty-printed in dev for readability, plain JSON in production (what a
// log aggregator actually wants to ingest).
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
});

// Every request gets a correlation ID (reused from an inbound X-Request-Id
// if the caller already set one, e.g. a load balancer) and a structured
// start/finish log line — this is the "can I trace one request through the
// logs" capability that plain console.log calls can't give you. Existing
// console.log/console.error call sites elsewhere (mock-transport debug
// output, [db] persistence-failure warnings) are unchanged by this — this
// adds request-level tracing, it doesn't retrofit every log line in the file.
const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = (typeof existing === 'string' && existing) || crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  autoLogging: {
    ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
  },
});

const LIQUIDATION_DEADLINE_DAYS = 7;

/**
 * Generate a 6-character release/claim code the requestor must quote back to
 * confirm receipt. Uses crypto.randomBytes (not Math.random) so codes aren't
 * predictable, and excludes ambiguous characters (0/O, 1/I) so a custodian can
 * read it aloud without confusion. See docs/SYSTEM-AUDIT-2026-08-03.md (release
 * codes).
 *
 * Production hardening (punchlist #9): the code is deliberately kept
 * plaintext at rest rather than hashed — custodians re-display it later in
 * the Ready-for-Claim queue and Payouts history so they can read it back to
 * a requestor in person, which a one-way hash would make impossible. Expiry
 * and attempt throttling (below) are the mitigations that don't break that
 * workflow: a leaked/guessed code has a limited window and a limited number
 * of tries before it's useless.
 */
const RELEASE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RELEASE_CODE_VALIDITY_DAYS = 14;
const RELEASE_CODE_MAX_ATTEMPTS = 5;
const RELEASE_CODE_LOCKOUT_MINUTES = 15;

function generateReleaseCode(length = 6): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += RELEASE_CODE_ALPHABET[bytes[i] % RELEASE_CODE_ALPHABET.length];
  }
  return code;
}

function releaseCodeExpiryFrom(date: Date): string {
  return new Date(date.getTime() + RELEASE_CODE_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Resets a claim's release-code security state whenever a code is (re)issued. */
function resetReleaseCodeSecurity(claim: Claim, issuedAt: Date = new Date()) {
  claim.release_code_expires_at = releaseCodeExpiryFrom(issuedAt);
  claim.release_code_attempts = 0;
  claim.release_code_locked_until = undefined;
}

/** Constant-time equality so a wrong guess can't be timed to leak how many characters matched. */
function timingSafeCodeEquals(input: string, actual: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(actual);
  if (a.length !== b.length) {
    // Compare against itself so this branch takes comparable time to a real mismatch,
    // rather than returning immediately and leaking length via timing.
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

let moms: Mom[] = [];
let claims: Claim[] = [];
let expenses: ExpenseLineItem[] = [];
let approvals: Approval[] = [];
let statusHistories: StatusHistory[] = [];
let emails: Email[] = [];
let teamsMessages: Email[] = [];
let lastSeenStore: Record<string, Record<string, string>> = {};
let cashAdvances: CashAdvance[] = [];
let liquidations: Liquidation[] = [];
let liquidationLineItems: LiquidationLineItem[] = [];
let reviewMeetings: ReviewMeeting[] = [];
let importBatches: ImportBatch[] = [];
let supportRequests: SupportRequest[] = [];
let supportMessages: SupportRequestMessage[] = [];
let delegations: ApproverDelegation[] = [];

// System Settings (In-Memory)
let systemSettings = {
  expenseCategories: [
    'Client Meals', 'Accommodation', 'Transportation',
    'Office Supplies', 'Software Subscriptions', 'Training', 'Miscellaneous'
  ],
  highValueThreshold: 15000,
  // Single source of truth for every payment-method picker (disbursement,
  // cash advance release, liquidation refund collection) so adding/removing
  // a method is a one-line admin change, not a hunt through JSX.
  paymentMethods: ['Cash', 'GCash', 'Bank Transfer', 'Check'],
  // Legacy per-category blocking limits are intentionally empty. The current
  // policy allows filing the full expense and caps the actual reimbursement
  // amount instead of rejecting an over-limit claim.
  categoryLimits: {} as Record<string, number>,
};

const REIMBURSEMENT_CAP = 1000;

const FINANCE_REIMBURSEMENT_STATUSES = new Set<string>([
  ClaimStatus.APPROVED,
  ClaimStatus.PROCESSING,
  ClaimStatus.READY_FOR_CLAIM,
  ClaimStatus.COMPLETED,
]);
const FINANCE_CASH_ADVANCE_STATUSES = new Set<string>([
  CashAdvanceStatus.APPROVED,
  CashAdvanceStatus.RELEASED,
  CashAdvanceStatus.LIQUIDATED,
]);
const FINANCE_LIQUIDATION_STATUSES = new Set<string>([
  LiquidationStatus.REVIEWED,
  LiquidationStatus.CLOSED,
]);

/** Finance is a read-only downstream consumer, so pre-decision work is out of scope. */
function isFinanceVisibleFinancialRecord(
  type: 'Reimbursement' | 'Transport Reimbursement' | 'Cash Advance' | 'Liquidation',
  status: string,
): boolean {
  if (type === 'Cash Advance') return FINANCE_CASH_ADVANCE_STATUSES.has(status);
  if (type === 'Liquidation') return FINANCE_LIQUIDATION_STATUSES.has(status);
  return FINANCE_REIMBURSEMENT_STATUSES.has(status);
}

let claimCounter = 123;

/**
 * Allocates the next human-facing claim number (e.g. "REIM-2026-000123").
 * Uses the Postgres `claim_number_seq` sequence when a database is
 * configured — atomic under concurrent requests and durable across
 * restarts. Falls back to the in-memory counter only for the fully
 * in-memory (no DATABASE_URL) mode, which has no concurrency or durability
 * requirement to begin with.
 */
async function generateClaimNumber(): Promise<string> {
  if (isDbConfigured()) {
    return nextClaimNumberFromDb();
  }
  const year = new Date().getFullYear();
  const numStr = String(claimCounter++).padStart(6, '0');
  return `REIM-${year}-${numStr}`;
}

/**
 * Enforce the company spending policy against a set of expense lines. Returns an
 * error message describing the first line that breaks its category cap, or null
 * if every line is within policy. Shared by the reimbursement and liquidation
 * submit paths so the rule lives in exactly one place.
 */
function checkCategoryLimits(items: Array<{ category?: string; amount?: number }>): string | null {
  const limits = systemSettings.categoryLimits || {};
  for (const item of items) {
    const cap = item.category ? limits[item.category] : undefined;
    if (cap && cap > 0 && Number(item.amount) > cap) {
      return `Company policy caps ${item.category} at ${formatPHP(cap)} per item — one line is ${formatPHP(Number(item.amount))}. Adjust it or request an exception.`;
    }
  }
  return null;
}

/** Bare PHP amount formatter for server-side policy messages (no Intl on the amount). */
function formatPHP(n: number): string {
  return `PHP ${Number(n).toLocaleString('en-PH')}`;
}

// Company Directory - canonical master list of client companies. Seeded from
// the same names the mock-data generators use (see SEED_COMPANIES below)
// so seeding and the real directory share one source of truth: any client
// name touched by seeding or by a real MOM submission funnels through
// getOrCreateCompany() and ends up here exactly once.
const SEED_COMPANIES: { name: string; industry: string; notes: string; address?: string; contact_person?: string; contact_email?: string }[] = [
  // Sales
  { name: 'SM Prime Holdings', industry: 'Real Estate & Retail', notes: 'Enterprise account — mall and residential developments, decade-long relationship.', address: 'SM Corporate Offices, Bldg. A, SM Mall of Asia Complex, Pasay City', contact_person: 'Cristina Reyes', contact_email: 'c.reyes@smprime.com' },
  { name: 'PLDT Inc', industry: 'Telecommunications', notes: 'National telco carrier; ongoing infrastructure and connectivity contracts.', address: 'Ramon Cojuangco Building, Makati Ave, Makati City', contact_person: 'Miguel Torres', contact_email: 'm.torres@pldt.com.ph' },
  { name: 'Jollibee Foods Corp', industry: 'Food & Beverage', notes: 'Fast-food franchise group; recurring catering and supply agreements.', address: 'Jollibee Plaza, F. Ortigas Jr. Road, Ortigas Center, Pasig City', contact_person: 'Anna Villanueva', contact_email: 'a.villanueva@jollibee.com.ph' },
  { name: 'Bank of the Philippine Islands', industry: 'Banking & Finance', notes: 'Long-standing corporate banking client, multiple branches engaged.', address: 'BPI Building, Ayala Ave cor. Paseo de Roxas, Makati City', contact_person: 'Ramon Aquino', contact_email: 'r.aquino@bpi.com.ph' },
  { name: 'Globe Telecom', industry: 'Telecommunications', notes: 'Competing telco account, handled by a separate sales pod.', address: 'The Globe Tower, 32nd St cor 7th Ave, BGC, Taguig City', contact_person: 'Katrina Dizon', contact_email: 'k.dizon@globe.com.ph' },
  { name: 'San Miguel Corporation', industry: 'Conglomerate', notes: 'Diversified food, beverage, and infrastructure holding company.', address: 'San Miguel Properties Centre, St. Francis St, Mandaluyong City', contact_person: 'Ferdinand Cruz', contact_email: 'f.cruz@sanmiguel.com.ph' },
  { name: 'Meralco', industry: 'Utilities', notes: 'Power distribution utility; regulated-sector account, longer sales cycles.', address: 'Lopez Building, Ortigas Ave, Pasig City', contact_person: 'Josefina Ramos', contact_email: 'j.ramos@meralco.com.ph' },
  { name: 'BDO Unibank', industry: 'Banking & Finance', notes: 'Largest local bank by assets; high-value, high-touch relationship.', address: 'BDO Corporate Center, 7899 Makati Ave, Makati City', contact_person: 'Patricia Lim', contact_email: 'p.lim@bdo.com.ph' },
  // Marketing
  { name: 'Creative Agency', industry: 'Advertising & Marketing', notes: 'Retained creative and production partner for campaign assets.', address: '88 Corporate Center, Sedeño St, Salcedo Village, Makati City', contact_person: 'Diego Santos', contact_email: 'diego@creativeagency.ph' },
  { name: 'Partner Promo Group', industry: 'Marketing & Events', notes: 'Handles promotional campaigns and in-store activations.', address: 'Unit 12B, One Corporate Centre, Ortigas Center, Pasig City', contact_person: 'Bianca Fernando', contact_email: 'bianca@partnerpromo.ph' },
  { name: 'Media Corp', industry: 'Media & Broadcasting', notes: 'Ad placement and sponsorship partner across TV and digital.', address: 'Media Corp Building, EDSA cor Mother Ignacia Ave, Quezon City', contact_person: 'Leo Manalo', contact_email: 'leo.manalo@mediacorp.ph' },
  // Engineering
  { name: 'Internal Operations', industry: 'Internal', notes: 'Cross-department engineering support requests, not an external client.' },
  { name: 'Beta Testing Corp', industry: 'Software QA', notes: 'External beta/UAT partner for pre-release builds.' },
  { name: 'DevOps Consultants', industry: 'IT Consulting', notes: 'Infrastructure and CI/CD advisory retainer.' },
  // Operations
  { name: 'Headquarters', industry: 'Internal', notes: 'Main office — facilities and administrative expenses.' },
  { name: 'Cebu Branch Office', industry: 'Internal', notes: 'Regional office covering Visayas operations.' },
  { name: 'Manila Warehouse', industry: 'Internal', notes: 'Logistics and inventory hub serving NCR.' },
  // Used by the hand-written /api/admin/seed demo records and mkMomAndClaim
  { name: 'Ayala Land Inc', industry: 'Real Estate', notes: 'Premium property developer; executive-level relationship.' },
  { name: 'Maxs Restaurant Corp', industry: 'Food & Beverage', notes: 'Restaurant chain; catering and corporate events account.' },
  { name: 'JG Summit', industry: 'Conglomerate', notes: 'Diversified holdings spanning aviation, food, and petrochemicals.' },
  { name: 'Robinsons Land Corp', industry: 'Real Estate', notes: 'Mall and mixed-use property developer.' },
  { name: 'Cebu Pacific Air', industry: 'Aviation', notes: 'Airline partner for transportation and logistics arrangements.' },
  { name: 'Metrobank', industry: 'Banking & Finance', notes: 'Corporate banking and treasury services relationship.' },
  { name: 'Internal / Partner', industry: 'Internal', notes: 'Catch-all bucket for internal or not-yet-classified partner meetings.' },
  // Referenced by name only in the hand-written demo MOM records further
  // below (mkMom calls) — listed here too so getOrCreateCompany() finds them
  // already seeded with real detail instead of creating a bare stub.
  { name: 'Aboitiz Equity', industry: 'Conglomerate', notes: 'Diversified holdings in power, banking, and food.' },
  { name: 'San Miguel Corp', industry: 'Conglomerate', notes: 'Diversified food, beverage, and infrastructure holding company.' },
  { name: 'Megaworld Corp', industry: 'Real Estate', notes: 'Township and mixed-use property developer.' },
  { name: 'Robinsons Land', industry: 'Real Estate', notes: 'Mall and mixed-use property developer.' },
];

const buildInitialCompanies = (): Company[] =>
  SEED_COMPANIES.map(c => ({
    id: uuidv4(), name: c.name, industry: c.industry, notes: c.notes,
    address: c.address, contact_person: c.contact_person, contact_email: c.contact_email,
  }));

let companies: Company[] = buildInitialCompanies();

/**
 * In-memory only — used by the demo seed generator (seedYearOfData), which
 * (see coreLoopRepo.ts's file header) intentionally never writes this
 * domain's records to Postgres, so repeated auto-seeding on every dev
 * restart doesn't churn a live database with regenerated demo company rows.
 */
const getOrCreateCompanyInMemory = (name?: string | null): void => {
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const exists = companies.some(c => c.name.toLowerCase() === trimmed.toLowerCase());
  if (!exists) {
    companies.push({ id: uuidv4(), name: trimmed });
  }
};

/**
 * Real MOM create/update paths funnel client names through this one instead
 * — unlike the seed generator, a company an admin can already see in the
 * Company Directory right after a real MOM submission should still be there
 * after a restart (docs/project-handoff/REMAINING-BACKEND-GAPS.md #8).
 *
 * A company created this way — from a requestor's free-typed client name,
 * not deliberately added by an admin — is immediately usable (it's already
 * pushed into `companies` before this returns) but flagged `pending_review`
 * so Company Directory can surface it for enrichment/merging without
 * blocking the requestor's submission on that review happening first. The
 * CompanyPicker UI (src/components/shared/CompanyPicker.tsx) already nudges
 * the requestor toward an existing near-match before they get here — this is
 * the server-side floor for whatever gets through regardless (a client that
 * skipped the picker, an older bundle, direct API use).
 */
const getOrCreateCompany = async (name?: string | null, createdByUserId?: string): Promise<void> => {
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const exists = companies.some(c => c.name.toLowerCase() === trimmed.toLowerCase());
  if (exists) return;
  const created: Company = { id: uuidv4(), name: trimmed, pending_review: true, created_by: createdByUserId };
  companies.push(created);
  try {
    await persistCompany(created);
  } catch (err) {
    console.error('[db] Could not persist new company to Postgres:', err);
  }
};

// ===== Master Data (Phase 1 MDM) =====
// Generic catalog-style reference data, managed through
// registerMasterDataRoutes() (defined inside startServer(), alongside
// getUser/addUserHistory) rather than bespoke per-entity route blocks, so
// adding a 7th master-data type later is a config addition, not a new route
// set. There is deliberately no DELETE route for any of these — historical
// Claims/MOMs/Companies may reference a record by id, so deactivation
// (PUT { active: false }) is the only removal path.
const buildMasterDataSeed = (items: { name: string; code?: string }[]): MasterDataRecord[] => {
  const now = new Date().toISOString();
  return items.map(i => ({ id: uuidv4(), name: i.name, code: i.code, active: true, created_at: now, updated_at: now }));
};

const SEED_DEPARTMENTS = ['Sales', 'Marketing', 'Engineering', 'Operations', 'Finance', 'IT', 'Executive'].map(name => ({ name }));
const SEED_COST_CENTERS = [
  { name: 'Sales Ops', code: 'CC-100' },
  { name: 'Marketing', code: 'CC-200' },
  { name: 'Engineering', code: 'CC-300' },
  { name: 'Corporate', code: 'CC-400' },
];
const SEED_BUSINESS_UNITS = ['Enterprise Sales', 'SMB Sales', 'Client Services', 'Corporate'].map(name => ({ name }));
const SEED_BRANCHES = [
  { name: 'Manila HQ', code: 'MNL-01' },
  { name: 'Cebu Branch', code: 'CEB-01' },
  { name: 'Davao Branch', code: 'DVO-01' },
];
const SEED_PROJECT_CODES = [
  { name: 'General', code: 'PRJ-GENERAL' },
  { name: 'New Business', code: 'PRJ-NEWBIZ' },
  { name: 'Renewal', code: 'PRJ-RENEWAL' },
];
const SEED_VENDORS = ['Grab', 'Petron', 'Starbucks', 'PLDT'].map(name => ({ name }));

const buildInitialDepartments = (): Department[] => buildMasterDataSeed(SEED_DEPARTMENTS);
const buildInitialCostCenters = (): CostCenter[] => buildMasterDataSeed(SEED_COST_CENTERS);
const buildInitialBusinessUnits = (): BusinessUnit[] => buildMasterDataSeed(SEED_BUSINESS_UNITS);
const buildInitialBranches = (): Branch[] => buildMasterDataSeed(SEED_BRANCHES);
const buildInitialProjectCodes = (): ProjectCode[] => buildMasterDataSeed(SEED_PROJECT_CODES);
const buildInitialVendors = (): Vendor[] => buildMasterDataSeed(SEED_VENDORS);

let departments: Department[] = buildInitialDepartments();
let costCenters: CostCenter[] = buildInitialCostCenters();
let businessUnits: BusinessUnit[] = buildInitialBusinessUnits();
let branches: Branch[] = buildInitialBranches();
let projectCodes: ProjectCode[] = buildInitialProjectCodes();
let vendors: Vendor[] = buildInitialVendors();

// ===== Dynamic Field Definitions (Phase 2 MDM) =====
// Admin-configurable fields rendered on a form via
// src/components/DynamicFieldRenderer.tsx. Seeded here with the three MOM
// fields CLAUDE.md's spec calls for but that were never actually built
// (Type of Account, Category, Contact Person Designation) — the dead
// ClientMeetingDetails type they used to (theoretically) live in has been
// removed from src/types.ts in favor of this mechanism. All three are seeded
// as NOT required, so existing MOM-creation flows (and the Playwright suite's
// MOM-mandatory test) are unaffected until an Admin opts to require one.
const buildInitialFieldDefinitions = (): FieldDefinition[] => {
  const now = new Date().toISOString();
  const defs: Omit<FieldDefinition, 'id' | 'created_at' | 'updated_at'>[] = [
    {
      entity: 'mom', key: 'type_of_account', label: 'Type of Account', input_type: 'dropdown',
      required: false, active: true, display_order: 1,
      options: ['Existing', 'New Client', 'Dormant'],
    },
    {
      entity: 'mom', key: 'category', label: 'Category', input_type: 'dropdown',
      required: false, active: true, display_order: 2,
      options: ['Sales Call', 'Client Servicing', 'Business Review', 'Contract/Negotiation', 'Other'],
      allow_other: true,
    },
    {
      entity: 'mom', key: 'contact_person_designation', label: 'Contact Person Designation', input_type: 'text',
      required: false, active: true, display_order: 3,
    },
  ];
  return defs.map(d => ({ ...d, id: uuidv4(), created_at: now, updated_at: now }));
};

let fieldDefinitions: FieldDefinition[] = buildInitialFieldDefinitions();

// The standard demo org chart: two full approval chains (Bob<-Alice,Eve and
// Grace<-Frank,Henry) so Admin Reassignment always has a second Approver to
// offer and segregation-of-duties can be demoed across two independent
// chains. Shared by both /api/admin/seed and /api/admin/reset so the two
// never drift apart.
// Phase 3 (O365/Entra ID) prep: stamp every seed user with a fake-but-stable
// `entra_object_id`/`user_principal_name` so getUser() and every consumer can
// already resolve on those join keys. Real values will come from the Entra
// JWT (`oid` claim) once sign-in is wired in — this only makes the switch a
// data swap, not a schema change. See docs/PROTOTYPE-AUDIT.md.
const withEntraFields = (u: User): User => ({
  ...u,
  entra_object_id: `fake-oid-${u.id}`,
  user_principal_name: u.email,
});

const buildDefaultUsers = (): User[] => [
  { id: 'u13', name: 'Mia Fernandez', email: 'mia@mgenesis.com', role: UserRole.REQUESTOR, department: 'Marketing', job_title: 'Marketing Specialist', reports_to: 'u14', avatar_url: '/avatars/corp_female_1.jpg' },
  { id: 'u14', name: 'Noah Villanueva', email: 'noah@mgenesis.com', role: UserRole.APPROVER, department: 'Marketing', job_title: 'Marketing Director', reports_to: 'u19', avatar_url: '/avatars/corp_male_1.jpg' },
  { id: 'u15', name: 'Olivia Cruz', email: 'olivia@mgenesis.com', role: UserRole.REQUESTOR, department: 'Engineering', job_title: 'Software Engineer', reports_to: 'u16', avatar_url: '/avatars/corp_female_2.jpg' },
  { id: 'u16', name: 'Peter Aquino', email: 'peter@mgenesis.com', role: UserRole.APPROVER, department: 'Engineering', job_title: 'Engineering Manager', reports_to: 'u19', avatar_url: '/avatars/corp_male_2.jpg' },
  { id: 'u17', name: 'Quinn Domingo', email: 'quinn@mgenesis.com', role: UserRole.REQUESTOR, department: 'Operations', job_title: 'Operations Coordinator', reports_to: 'u18', avatar_url: '/avatars/corp_female_3.jpg' },
  { id: 'u18', name: 'Ryan Torres', email: 'ryan@mgenesis.com', role: UserRole.APPROVER, department: 'Operations', job_title: 'Operations Manager', reports_to: 'u19', avatar_url: '/avatars/corp_male_3.jpg' },
  { id: 'u19', name: 'Sarah Bautista', email: 'sarah@mgenesis.com', role: UserRole.APPROVER, department: 'Executive', job_title: 'VP of Operations', reports_to: null, avatar_url: '/avatars/corp_female_4.jpg' },
  { id: 'u1', name: 'Alice Reyes', email: 'alice@mgenesis.com', role: UserRole.REQUESTOR, department: 'Sales', job_title: 'Sales Executive', reports_to: 'u2', avatar_url: '/avatars/corp_female_1.jpg' },
  { id: 'u2', name: 'Bob Santos', email: 'bob@mgenesis.com', role: UserRole.APPROVER, department: 'Sales', job_title: 'Sales Director', reports_to: 'u9', avatar_url: '/avatars/corp_male_4.jpg' },
  { id: 'u3', name: 'Carol Ramos', email: 'carol@mgenesis.com', role: UserRole.CUSTODIAN, department: 'Finance', job_title: 'Reimbursement Processor', reports_to: null, avatar_url: '/avatars/corp_female_2.jpg' },
  { id: 'u4', name: 'Dave Lopez', email: 'dave@mgenesis.com', role: UserRole.ADMIN, department: 'IT', job_title: 'System Admin', reports_to: null, avatar_url: '/avatars/corp_male_1.jpg' },
  { id: 'u22', name: 'Sofia Lim', email: 'sofia@mgenesis.com', role: UserRole.FINANCE, department: 'Finance', job_title: 'Finance Analyst', reports_to: null, avatar_url: '/avatars/corp_female_4.jpg' },
  { id: 'u5', name: 'Eve Garcia', email: 'eve@mgenesis.com', role: UserRole.REQUESTOR, department: 'Sales', job_title: 'Sales Executive', reports_to: 'u2', avatar_url: '/avatars/corp_female_3.jpg' },
  { id: 'u6', name: 'Frank Mendoza', email: 'frank@mgenesis.com', role: UserRole.REQUESTOR, department: 'Sales', job_title: 'Sales Executive', reports_to: 'u2', avatar_url: '/avatars/corp_male_2.jpg' },
  { id: 'u7', name: 'Grace Navarro', email: 'grace@mgenesis.com', role: UserRole.APPROVER, department: 'Sales', job_title: 'Sales Director', reports_to: 'u9', avatar_url: '/avatars/corp_female_4.jpg' },
  { id: 'u8', name: 'Henry Castillo', email: 'henry@mgenesis.com', role: UserRole.APPROVER, department: 'Sales', job_title: 'Sales Director', reports_to: 'u9', avatar_url: '/avatars/corp_male_3.jpg' },
  { id: 'u9', name: 'Ivy Salazar', email: 'ivy@mgenesis.com', role: UserRole.APPROVER, department: 'Sales', job_title: 'VP of Sales', reports_to: null, avatar_url: '/avatars/corp_female_1.jpg' },
  { id: 'u10', name: 'Jack Herrera', email: 'jack@mgenesis.com', role: UserRole.APPROVER, department: 'Sales', job_title: 'Regional Sales Manager', reports_to: 'u9', avatar_url: '/avatars/corp_male_4.jpg' },
  { id: 'u11', name: 'Kyle Ocampo', email: 'kyle@mgenesis.com', role: UserRole.REQUESTOR, department: 'Sales', job_title: 'Sales Executive', reports_to: 'u10', avatar_url: '/avatars/corp_male_1.jpg' },
  { id: 'u12', name: 'Liam Villareal', email: 'liam@mgenesis.com', role: UserRole.REQUESTOR, department: 'Sales', job_title: 'Sales Executive', reports_to: 'u10', avatar_url: '/avatars/corp_male_2.jpg' },
  // Marketing had only one requestor (Mia) under Noah, making any
  // per-requestor comparison chart on his dashboard a single bar. These two
  // give Marketing the same "one approver, multiple reports" shape Sales has.
  { id: 'u20', name: 'Ella Flores', email: 'ella@mgenesis.com', role: UserRole.REQUESTOR, department: 'Marketing', job_title: 'Marketing Coordinator', reports_to: 'u14', avatar_url: '/avatars/corp_female_2.jpg' },
  { id: 'u21', name: 'Marco Bernardo', email: 'marco@mgenesis.com', role: UserRole.REQUESTOR, department: 'Marketing', job_title: 'Content Strategist', reports_to: 'u14', avatar_url: '/avatars/corp_male_3.jpg' }
].map(withEntraFields);

// Settings > Notifications' five toggleable categories (Settings.tsx's
// DEFAULT_NOTIFY_PREFS is the other half of this contract — keep the string
// literals in sync with its keys).
type NotificationEventKey = 'submitted' | 'approved' | 'returned' | 'ready' | 'delegation';

/**
 * Central event-to-preference check (docs/project-handoff/REMAINING-BACKEND-GAPS.md
 * #6 — "notification preferences are represented but not enforced"). Callers
 * pass `opts.eventKey` on sendEmail() only for the notifications that have a
 * corresponding toggle in Settings > Notifications; every other call (custodian
 * ops emails, escalations, support messages, client CCs, cash-advance/
 * liquidation lifecycle emails) has no matching category and is intentionally
 * left unconditional, exactly as before.
 *
 * sendEmail() creates exactly one record per notification (into `emails` or
 * `teamsMessages`, merged into one list for the frontend) that backs both the
 * in-app bell and the "email" — there's no separate in-app-only queue to honor
 * an inApp:true/email:false split against. Until that record model is split,
 * a category only suppresses the notification when BOTH toggles are off;
 * either toggle being on still creates the one record. A user with no saved
 * preferences yet is notified (matches DEFAULT_NOTIFY_PREFS, which defaults
 * every category to on) — failing open, since under-notifying a workflow
 * approval/return is worse than an unwanted extra email.
 */
function shouldNotify(recipientId: string, eventKey: NotificationEventKey): boolean {
  const recipient = users.find(u => u.id === recipientId);
  const pref = recipient?.notification_prefs?.[eventKey];
  if (!pref) return true;
  return pref.inApp !== false || pref.email !== false;
}

// Email Transport Mock
// opts.plain sends an unstyled personal-message email (no SharePoint header/footer) -
// used for the MOM email to an external client contact, which must read as a personal
// message, not a system notification. Every other notification keeps the full
// enterprise template by omitting opts.
const sendEmail = (toOrId: string, subject: string, body: string, ccId?: string, opts?: { plain?: boolean; recipientName?: string; fromLabel?: string; timestamp?: string; eventKey?: NotificationEventKey }) => {
  if (opts?.eventKey && !shouldNotify(toOrId, opts.eventKey)) return;
  const recipient = users.find(u => u.id === toOrId);
  const toEmail = recipient ? recipient.email : toOrId;
  const recipientId = recipient ? recipient.id : 'external';
  const recipientName = opts?.recipientName || (recipient ? recipient.name : toOrId.split('@')[0]);
  const fromLine = opts?.plain ? (opts.fromLabel || 'system@reimbursement.local') : "SharePoint Online <no-reply@mgenesis.com>";

  const emailTimestamp = opts?.timestamp || new Date().toISOString();
  const sentString = new Date(emailTimestamp).toLocaleString('en-US', { timeZone: 'Asia/Manila' });

  const finalBody = opts?.plain
    ? `Dear ${recipientName},


${body}`
    : `From:
${fromLine}

Sent:
${sentString}

To:
${toEmail}${ccId ? `\nCC:\n${users.find(u => u.id === ccId)?.email || ccId}` : ''}

Subject:
${subject}


Dear ${recipientName},


${body}


This is an automatically generated email.
Please do not reply.


Sales Reimbursement System
Business Support Management Assistant`;

  if (recipient) {
    teamsMessages.push({
      id: uuidv4(),
      recipient_id: recipient.id,
      from: 'Microsoft Teams',
      to: recipient.email,
      subject,
      body,
      read: false,
      timestamp: emailTimestamp,
      channel: 'Teams',
    });
  } else {
    emails.push({
      id: uuidv4(),
      recipient_id: recipientId,
      from: fromLine,
      to: toEmail,
      subject,
      body: finalBody,
      read: false,
      timestamp: emailTimestamp,
      channel: 'Email'
    });
  }

  if (ccId) {
    const ccRecipient = users.find(u => u.id === ccId);
    if (ccRecipient) {
      teamsMessages.push({
        id: uuidv4(),
        recipient_id: ccRecipient.id,
        from: 'Microsoft Teams',
        to: ccRecipient.email,
        subject: `[CC] ${subject}`,
        body,
        read: false,
        timestamp: emailTimestamp,
        channel: 'Teams',
      });
    }
  }

  console.log(`\n--- MOCK ${recipient ? 'TEAMS' : 'EMAIL'} TRANSPORT ---`);
  console.log(`To: ${toEmail}`);
  if (ccId) console.log(`CC: ${users.find(u => u.id === ccId)?.email}`);
  console.log(`Subject: ${subject}`);
  console.log(`Body:\n${recipient ? body : finalBody}`);
  console.log(`----------------------------\n`);
};

const notifyClientCcSent = ({
  recipientIds,
  claimNumber,
  clientName,
  clientEmail,
  eventLabel,
}: {
  recipientIds: Array<string | undefined>;
  claimNumber: string;
  clientName?: string;
  clientEmail: string;
  eventLabel: string;
}) => {
  const clientLabel = clientName?.trim()
    ? `${clientName.trim()} (${clientEmail})`
    : clientEmail;
  const subject = `Client CC Sent - ${claimNumber} (${eventLabel})`;
  const body = `A courtesy copy of the ${eventLabel.toLowerCase()} notification for ${claimNumber} was sent to ${clientLabel}.

This confirms that the client contact was CCed as requested.`;

  [...new Set(recipientIds.filter((id): id is string => Boolean(id)))]
    .forEach(recipientId => sendEmail(recipientId, subject, body));
};

// Simulated initial Entra ID sync: employment status defaults to Active, and
// approval authority defaults to "has at least one direct report" — see
// docs/hierarchy-sync-design.md §2-3. can_approve_reimbursements is
// Admin-overridable afterward and won't be silently re-derived once set.
// Called every time the user list is (re)seeded, including demo-data resets.
const applyHierarchySyncDefaults = (userList: User[]) => {
  userList.forEach(u => {
    u.employment_status = 'Active';
    // Only Approvers can hold approval authority — see PUT /api/users/:id.
    u.can_approve_reimbursements = u.role === UserRole.APPROVER && userList.some(x => x.reports_to === u.id);
  });
};

const users: User[] = buildDefaultUsers();
applyHierarchySyncDefaults(users);

// Uploads need a *writable* directory. Locally that's `<cwd>/uploads`, but on a
// serverless host (Vercel) the deployment filesystem is read-only — only the OS
// temp dir (/tmp) is writable. Creating the dir at module load must therefore
// never throw, or importing this module crashes the whole function (every route
// then 500s). NOTE: on serverless, /tmp is per-instance and ephemeral, so
// uploads don't persist across cold starts — that's the object-storage work in
// PRODUCTION-PASS.md #4.
const uploadDir = process.env.UPLOAD_DIR
  || (process.env.VERCEL ? path.join(os.tmpdir(), 'uploads') : path.join(process.cwd(), 'uploads'));
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.error(`Could not create upload dir at ${uploadDir}:`, err);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

// Matches what the upload UI already tells users is supported: receipts
// (image/*, PDF - see ExpenseLineItemEditor's `accept` attribute) and MOM
// documents (PDF/DOC/DOCX - see Moms.tsx's `accept` attribute, which already
// says "up to 10MB" even though nothing previously enforced it).
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Unsupported file type. Please upload an image (JPG, PNG, GIF, WEBP), a PDF, or a Word document (DOC, DOCX).'));
    }
    cb(null, true);
  }
});

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Authentication deployment contract. Demo identity remains the default
  // while the organization is obtaining its Entra registration. Switching to
  // Microsoft later is configuration-driven, so the UI and the rest of the API
  // do not need another auth redesign.
  // DEMO_MODE is the production cutover switch: turning it off removes fake
  // identities/reference records from bootstrap, closes every seed/reset
  // surface, skips auto-seeding, and hides demo UI through /api/auth/config.
  // The narrower flags remain useful while DEMO_MODE is on (for example, a
  // clean-data demo that still needs the account launcher).
  const demoModeEnabled = process.env.DEMO_MODE?.toLowerCase() !== 'false';
  const requestedAuthMode = process.env.AUTH_MODE?.toLowerCase() === 'microsoft' ? 'microsoft' : 'demo';
  const authMode = demoModeEnabled ? requestedAuthMode : 'microsoft';
  const demoLoginEnabled = demoModeEnabled && (process.env.ENABLE_DEMO_LOGIN === undefined
    ? authMode === 'demo'
    : process.env.ENABLE_DEMO_LOGIN.toLowerCase() === 'true');

  // --- Users persistence bootstrap (docs/DATABASE-MIGRATION.md, step 4) ---
  // Postgres, when configured, is the source of truth: load existing rows so
  // real data survives a restart. An empty table means either a fresh
  // database (persist the in-memory demo seed that already ran at module
  // load) or DEMO_MODE=false with nothing real yet (stay empty — never
  // auto-seed fake users into a production-postured database). Without
  // DATABASE_URL (e.g. the test suite) this block is inert and `users`
  // keeps behaving exactly as it always has: pure in-memory.
  let usersLoadedFromDb = false;
  if (isDbConfigured()) {
    try {
      const dbUsers = await loadUsersFromDb();
      if (dbUsers.length > 0) {
        users.length = 0;
        users.push(...dbUsers);
        usersLoadedFromDb = true;
      } else if (demoModeEnabled && process.env.AUTO_SEED !== 'false') {
        await syncUsersToDb(users);
      } else {
        users.length = 0;
      }
    } catch (err) {
      console.error('[db] Could not load users from Postgres — falling back to the in-memory demo seed for this boot:', err);
    }
  } else if (!demoModeEnabled) {
    users.length = 0;
  }
  if (isDbConfigured()) {
    try {
      statusHistories.push(...(await loadUserHistoryFromDb()));
    } catch (err) {
      console.error('[db] Could not load user history from Postgres for this boot:', err);
    }
  }

  // --- Core loop persistence bootstrap (moms/claims/expenses/approvals) ---
  // Loading from Postgres here (rather than reseeding) only happens with
  // DEMO_MODE=false — see coreLoopRepo.ts's file header for why the demo
  // seed generator itself isn't gated yet. Every route still writes through
  // to Postgres regardless of DEMO_MODE, so this load reflects real
  // transactions the moment a real cutover happens.
  if (isDbConfigured() && !demoModeEnabled) {
    try {
      const loaded = await loadCoreLoopFromDb();
      moms = loaded.moms;
      claims = loaded.claims;
      expenses = loaded.expenses;
      approvals = loaded.approvals;
      statusHistories.push(...loaded.statusHistories);
    } catch (err) {
      console.error('[db] Could not load the core reimbursement loop from Postgres for this boot:', err);
    }
    try {
      const loadedCa = await loadCashAdvanceLoopFromDb();
      cashAdvances = loadedCa.cashAdvances;
      liquidations = loadedCa.liquidations;
      liquidationLineItems = loadedCa.liquidationLineItems;
      statusHistories.push(...loadedCa.statusHistories);
    } catch (err) {
      console.error('[db] Could not load cash advances/liquidations from Postgres for this boot:', err);
    }
    try {
      companies = await loadCompaniesFromDb();
      departments = await loadMasterDataTable('departments');
      costCenters = await loadMasterDataTable('cost-centers');
      businessUnits = await loadMasterDataTable('business-units');
      branches = await loadMasterDataTable('branches');
      projectCodes = await loadMasterDataTable('project-codes');
      vendors = await loadMasterDataTable('vendors');
      fieldDefinitions = await loadFieldDefinitionsFromDb();
      const loadedSettings = await loadSystemSettingsFromDb();
      if (loadedSettings) systemSettings = loadedSettings;
      statusHistories.push(...(await loadMasterDataHistoryFromDb()));
      delegations = await loadDelegationsFromDb();
      statusHistories.push(...(await loadDelegationHistoryFromDb()));
      reviewMeetings = await loadReviewMeetingsFromDb();
      const loadedSupport = await loadSupportRequestsFromDb();
      supportRequests = loadedSupport.requests;
      supportMessages = loadedSupport.messages;
    } catch (err) {
      console.error('[db] Could not load reference data/delegations/support from Postgres for this boot:', err);
    }
  } else if (!demoModeEnabled) {
    // No DATABASE_URL and DEMO_MODE=false: stay empty rather than serving
    // fake reference data in a production posture (matches the users
    // bootstrap's same fallback a few lines up).
    companies = [];
    departments = [];
    costCenters = [];
    businessUnits = [];
    branches = [];
    projectCodes = [];
    vendors = [];
    fieldDefinitions = [];
  }
  const microsoftAuth = {
    tenantId: process.env.MICROSOFT_TENANT_ID || process.env.TENANT_ID || '',
    clientId: process.env.MICROSOFT_CLIENT_ID || process.env.CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || process.env.CLIENT_SECRET || '',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || process.env.OAUTH_REDIRECT_URI || '',
  };
  const microsoftAuthConfigured = Object.values(microsoftAuth).every(Boolean);

  // --- P1 #7 HTTP security middleware -------------------------------------
  // contentSecurityPolicy is now on. It used to be off because the SPA loaded
  // a Google Fonts CDN stylesheet and needed to allow that external origin —
  // fonts are self-hosted now (src/main.tsx's @fontsource imports), so the
  // whole app has no legitimate external-origin dependency left, and the
  // policy can be `'self'`-only for everything except the two exceptions
  // below. `upgradeInsecureRequests` is disabled: local dev serves plain
  // http://localhost, and helmet's default would rewrite those requests to
  // https and break them.
  const isProdEnv = process.env.NODE_ENV === 'production';

  // Mounted before helmet/cors so even a request helmet would otherwise
  // reject still gets a correlation ID and a logged start/finish line.
  app.use(httpLogger);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'], // data: for inline/base64 assets, blob: for client-generated PDF/receipt previews
        // Vite's dev server injects an inline HMR client script and relies on
        // eval-based sourcemaps — both are dev-only; the production build
        // emits only external, hashed <script> files, so the built app needs
        // neither.
        scriptSrc: isProdEnv ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind/inline component styles
        connectSrc: isProdEnv ? ["'self'"] : ["'self'", 'ws:'], // ws: for Vite's dev HMR websocket
        upgradeInsecureRequests: null, // local dev serves plain http://localhost; helmet's default would rewrite requests to https and break them
      },
    },
  }));

  // Same-origin by default (the Express app serves its own built frontend on
  // this port — no cross-origin caller has a legitimate reason to hit these
  // routes). Set ALLOWED_ORIGINS to a comma-separated list to allow specific
  // external origins (e.g. a separately-hosted frontend) if that changes.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
  app.use(cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  }));

  // JSON bodies only carry text fields — files go through multer's own
  // 10 MB cap on /api/upload. 1 MB is generous headroom for the largest
  // legitimate payload (a claim with many line items).
  app.use(express.json({ limit: '1mb' }));

  // --- Health / readiness ---------------------------------------------------
  // Unauthenticated, top-level (not under /api), and registered before the
  // rate limiters below so a monitoring probe polling every few seconds is
  // never throttled or mistaken for auth abuse.
  // /healthz — liveness: this process is up and handling requests at all.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  // /readyz — readiness: liveness plus "can actually serve traffic that
  // depends on it." When no DATABASE_URL is configured the app runs fully
  // in-memory by design (see isDbConfigured() callers throughout), so
  // readiness in that mode is the same as liveness. When a database IS
  // configured, a real round-trip query is required — DATABASE_URL being
  // *set* doesn't mean the database is actually reachable right now.
  // `persistence` reports write-through health: whether the most recent
  // instrumented Postgres write succeeded (see src/db/persistenceHealth.ts).
  // It is REPORTED but does NOT affect the pass/fail status here — a
  // write-through failure means Postgres is drifting behind the in-memory
  // arrays, which a monitor should alert on, but the app is still serving
  // correct data from memory, so failing readiness (and pulling the process
  // out of a load balancer) would be the wrong response while DEMO_MODE=true.
  // The active `select 1` probe below is what gates readiness on the DB.
  app.get('/readyz', async (_req, res) => {
    const persistence = getPersistenceHealth();
    if (!isDbConfigured()) {
      return res.status(200).json({ status: 'ok', database: 'not_configured', persistence });
    }
    try {
      await getDb().execute(sql`select 1`);
      res.status(200).json({ status: 'ok', database: 'reachable', persistence });
    } catch (err: any) {
      res.status(503).json({ status: 'unavailable', database: 'unreachable', error: err?.message, persistence });
    }
  });

  // --- Rate limiting -------------------------------------------------------
  // Auth endpoints are the highest-value target for credential/enumeration
  // abuse — a tight cap here matters even before real sign-in exists (the
  // mock X-User-Id path and the /api/auth/microsoft/start hand-off both sit
  // behind this same door). Generous elsewhere: this is meant to blunt a
  // runaway client or script, not to throttle normal interactive use.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again in a few minutes.' },
    // /api/auth/config is a public, side-effect-free capability read (login
    // mode flags) that the frontend's own bootstrap fetches on every single
    // page load/navigation, not an auth *attempt* — counting it here meant a
    // user just clicking around the app for a while could get locked out of
    // loading any page. The actual attempt surface (/api/auth/microsoft/start
    // and anything else under this prefix) stays limited.
    skip: (req) => req.path === '/config',
  });
  app.use('/api/auth', authLimiter);

  // Every other mutating request (GET/HEAD/OPTIONS pass through unlimited —
  // reads are cheap and this app's own polling-free UI doesn't hammer them
  // anyway; the risk is repeated writes).
  const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down and try again shortly.' },
  });
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return writeLimiter(req, res, next);
  });

  // Public, secret-free capability endpoint used by the sign-in screen. The
  // response shape stays stable when Entra is enabled; only these flags change.
  app.get('/api/auth/config', (_req, res) => {
    res.json({
      provider: 'microsoft',
      mode: authMode,
      demoModeEnabled,
      demoLoginEnabled,
      microsoft: {
        configured: microsoftAuthConfigured,
        loginUrl: '/api/auth/microsoft/start',
      },
    });
  });

  // This route is the stable hand-off point for a future MSAL/OIDC adapter.
  // It deliberately refuses to imitate SSO: until IT provides the tenant app
  // registration and a signed-session implementation is installed, no user is
  // authenticated and no authorization URL is generated without CSRF state.
  app.get('/api/auth/microsoft/start', (_req, res) => {
    if (!microsoftAuthConfigured) {
      return res.status(503).json({
        code: 'MICROSOFT_AUTH_NOT_CONFIGURED',
        message: 'Microsoft sign-in is awaiting the organization\'s Entra app registration.',
      });
    }
    return res.status(501).json({
      code: 'MICROSOFT_AUTH_ADAPTER_REQUIRED',
      message: 'Entra settings are present. Install the approved OIDC session adapter before enabling Microsoft sign-in.',
    });
  });

  // --- Upload access gate ----------------------------------------------
  // Still built on the same mock-auth identity model as the rest of this
  // file (X-User-Id / ?uid=) pending real sessions (Phase 2) — but unlike
  // the previous version, "a valid identity" is no longer sufficient by
  // itself. The file is resolved back to whichever claim/expense-line-item/
  // mom/liquidation-line-item currently references it, and the SAME
  // per-resource access predicate its own detail route enforces
  // (canAccessClaim/canAccessMom/canAccessLiquidation) is applied here too —
  // so a receipt or MOM document is only visible to someone who could
  // already see the record it's attached to, not to any other logged-in
  // user who happens to guess or intercept the filename.
  //
  // Browsers don't attach custom headers to <img>/<iframe>/direct-navigation
  // requests, so this also accepts the same identity via a `?uid=` query
  // param (see uploadUrl() in src/lib/api.ts) for those cases — deliberately
  // scoped to just this route, not merged into the shared getUser() used by
  // every other API route.
  app.get('/uploads/:filename', (req, res) => {
    const userId = req.header('X-User-Id') || (req.query.uid as string | undefined);
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // express.static normally guards against path traversal itself;
    // path.basename() replicates that here since this route serves files
    // manually. Multer-generated filenames are always `${uuid}${ext}` with
    // no path separators, so this never rejects a legitimate request.
    const safeFilename = path.basename(req.params.filename);

    // A file with no known owning record (never attached, or the
    // attachment was since replaced) is treated as not found rather than
    // fetchable by any authenticated user — the client-side submit flows
    // preview a freshly picked file from a local blob URL, not this route,
    // so a real, still-attached file always resolves here.
    const authorized = findUploadAccessCheck(`/uploads/${safeFilename}`);
    if (!authorized) return res.status(404).json({ error: 'File not found' });
    if (!authorized(user)) return res.status(403).json({ error: 'Forbidden' });

    const filePath = path.join(uploadDir, safeFilename);
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'File not found' });
      }
    });
  });

  app.post('/api/upload', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role === UserRole.FINANCE) {
      return res.status(403).json({ error: 'Finance access is view-only.' });
    }

    // Invoked manually (rather than passed as route middleware) so multer's
    // fileFilter rejection and file-size-limit errors land here as a normal
    // caught error, instead of crashing past Express's default handler with
    // an unhelpful stack trace / generic 500.
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `File is too large. Maximum size is ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB.` });
        }
        return res.status(400).json({ error: err.message || 'Upload failed.' });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      res.json({ url: `/uploads/${req.file.filename}` });
    });
  });

  // Set true only while seedYearOfData() is running. The demo seed generator
  // calls the same addHistory/addCaHistory/addLiqHistory/addDelegationHistory
  // helpers real routes use, but its claims/cash-advances/liquidations/
  // delegations are demo-only and never persisted (see coreLoopRepo.ts's file
  // header) — so their history's fire-and-forget insert would otherwise
  // FK-violate against a parent row Postgres never received. Suppressing it
  // during seeding avoids hundreds of wasted, always-failing queries on every
  // boot/reseed rather than trying to skip it at each individual call site.
  let suppressHistoryPersistence = false;

  // Helper to get current user from header (mock auth). This is the ONE seam
  // identity is derived through — every route below calls this, never the
  // header directly (the /uploads/:filename gate is the one documented
  // exception, since browsers don't attach custom headers to <img> loads).
  // Phase 3: swapping "read X-User-Id" for "validate the Entra JWT and read
  // its `oid` claim" is a one-function change specifically because of that,
  // and because the lookup already resolves on entra_object_id /
  // user_principal_name — not just the internal id — so a real token's join
  // key already exists on the seed today.
  const getUser = (req: express.Request) => {
    const userId = req.header('X-User-Id');
    if (!userId) return undefined;
    return users.find(u => u.id === userId || u.entra_object_id === userId || u.user_principal_name === userId);
  };

  // Finance is a dedicated view-only role. Keep this centralized so newly
  // added write routes cannot accidentally become Finance-editable simply
  // because they forgot a role check of their own.
  app.use('/api', (req, res, next) => {
    const user = getUser(req);
    const isRead = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    const isSelfService = req.path === '/me/notification-prefs' || req.path.startsWith('/support');
    if (user?.role === UserRole.FINANCE && !isRead && !isSelfService) {
      return res.status(403).json({ error: 'Finance access is view-only.' });
    }
    next();
  });

  // An Active ApproverDelegation stands in for the delegating approver on
  // every claim/cash-advance/liquidation visibility and action check below —
  // otherwise a delegate could accept a delegation (see /api/delegations/:id/accept)
  // and still see zero of the work it was meant to hand them. Pending, Declined,
  // Expired, and Cancelled delegations grant nothing.
  const isActiveDelegateFor = (delegateId: string, approverId: string | undefined | null): boolean =>
    !!approverId && delegations.some(d =>
      d.delegate_id === delegateId && d.approver_id === approverId && d.status === DelegationStatus.ACTIVE
    );

  // Shared with GET /api/claims/:id, GET /api/moms/:id, GET /api/liquidations/:id
  // (each still enforces the same rule at its own route) and with the
  // /uploads/:filename attachment gate below, which resolves a requested file
  // back to the claim/mom/liquidation that owns it and applies the matching
  // predicate — so a receipt/document is only ever visible to someone who
  // could already see the record it's attached to.
  const canAccessClaim = (user: User, claim: Claim): boolean => {
    if (user.role === UserRole.ADMIN) return true;
    if (user.role === UserRole.FINANCE) return isFinanceVisibleFinancialRecord(claim.claim_type || 'Reimbursement', claim.status);
    if (user.role === UserRole.REQUESTOR) return claim.requestor_id === user.id;
    if (user.role === UserRole.APPROVER) {
      return claim.current_approver_id === user.id || claim.original_approver_id === user.id ||
        claim.requestor_id === user.id || isActiveDelegateFor(user.id, claim.current_approver_id);
    }
    if (user.role === UserRole.CUSTODIAN) {
      return [ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED].includes(claim.status)
        || claim.requestor_id === user.id;
    }
    return false;
  };

  const canAccessMom = (user: User, mom: Mom): boolean => {
    if (user.role === UserRole.CUSTODIAN) return false;
    if (user.role === UserRole.ADMIN) return true;
    if (user.role === UserRole.FINANCE) {
      const linkedClaim = claims.find(c => c.id === mom.claim_id);
      return Boolean(linkedClaim && isFinanceVisibleFinancialRecord(linkedClaim.claim_type || 'Reimbursement', linkedClaim.status));
    }
    if (user.role === UserRole.REQUESTOR) return mom.requestor_id === user.id;
    if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      return mom.requestor_id === user.id || !!(mom.claim_id && mom.requestor_id && reporteeIds.includes(mom.requestor_id));
    }
    return false;
  };

  const canAccessLiquidation = (user: User, l: Liquidation): boolean => {
    if (user.role === UserRole.REQUESTOR) return l.requestorId === user.id;
    if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      const relatedCa = cashAdvances.find(c => c.id === l.cashAdvanceId);
      return l.requestorId === user.id || relatedCa?.approverId === user.id ||
        reporteeIds.includes(l.requestorId) || isActiveDelegateFor(user.id, relatedCa?.approverId);
    }
    if (user.role === UserRole.FINANCE) return isFinanceVisibleFinancialRecord('Liquidation', l.status);
    return true; // Custodian and Admin see all
  };

  /**
   * Resolves an uploaded file back to whichever claim/expense-line-item/
   * mom/liquidation-line-item currently references it, and returns that
   * record's own access predicate. Returns null when no known record
   * references the file (e.g. it was uploaded but never attached, or the
   * attachment it belonged to was since replaced) — callers should treat
   * that as "not found", not as "anyone may fetch it".
   */
  const findUploadAccessCheck = (uploadUrlPath: string): ((user: User) => boolean) | null => {
    const claim = claims.find(c => c.receipt_url === uploadUrlPath);
    if (claim) return (user) => canAccessClaim(user, claim);

    const expense = expenses.find(e => e.receipt_url === uploadUrlPath);
    if (expense) {
      const parentClaim = claims.find(c => c.id === expense.claim_id);
      if (parentClaim) return (user) => canAccessClaim(user, parentClaim);
    }

    const mom = moms.find(m => m.file_url === uploadUrlPath);
    if (mom) return (user) => canAccessMom(user, mom);

    const liqItem = liquidationLineItems.find(li => li.receipt_url === uploadUrlPath);
    if (liqItem) {
      const parentLiquidation = liquidations.find(l => l.id === liqItem.liquidationId);
      if (parentLiquidation) return (user) => canAccessLiquidation(user, parentLiquidation);
    }

    return null;
  };

  const addHistory = (claimId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    const entry = {
      id: uuidv4(),
      claim_id: claimId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    };
    statusHistories.push(entry);
    // Fire-and-forget: see coreLoopRepo.ts's comment on why this isn't
    // awaited at each of addHistory's dozen call sites.
    if (!suppressHistoryPersistence) persistStatusHistoryFireAndForget(entry);
  };

  const addCaHistory = (caId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    const entry = {
      id: uuidv4(),
      claim_id: '',
      cash_advance_id: caId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    };
    statusHistories.push(entry);
    if (!suppressHistoryPersistence) persistStatusHistoryFireAndForget(entry);
  };

  const addLiqHistory = (liqId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    const entry = {
      id: uuidv4(),
      claim_id: '',
      liquidation_id: liqId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    };
    statusHistories.push(entry);
    if (!suppressHistoryPersistence) persistStatusHistoryFireAndForget(entry);
  };

  const addUserHistory = (userId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    const entry = {
      id: uuidv4(),
      claim_id: '',
      user_id: userId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    };
    statusHistories.push(entry);
    if (!suppressHistoryPersistence) persistStatusHistoryFireAndForget(entry);
  };

  const addDelegationHistory = (delegationId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    const entry = {
      id: uuidv4(),
      claim_id: '',
      delegation_id: delegationId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    };
    statusHistories.push(entry);
    if (!suppressHistoryPersistence) persistStatusHistoryFireAndForget(entry);
  };

  // Master Data (Phase 1 MDM) — one history helper shared by every entity's
  // route factory below, following the exact same "push into statusHistories,
  // one call per meaningfully-changed field" shape as addUserHistory.
  const addMasterDataHistory = (entityKey: string, recordId: string, field: string, oldVal: string, newVal: string, changedBy: string) => {
    const entry = {
      id: uuidv4(),
      claim_id: '',
      master_data_key: entityKey,
      master_data_id: recordId,
      old_status: `${field}: ${oldVal}`,
      new_status: `${field}: ${newVal}`,
      changed_by: changedBy,
      reason: `Changed ${entityKey} ${field}`,
      timestamp: new Date().toISOString()
    };
    statusHistories.push(entry);
    if (!suppressHistoryPersistence) persistStatusHistoryFireAndForget(entry);
  };

  type AnalyticsDateBasis = 'submitted' | 'expense' | 'approved' | 'paid' | 'completed';
  type AnalyticsRecord = {
    id: string;
    ref: string;
    type: 'Reimbursement' | 'Transport Reimbursement' | 'Cash Advance' | 'Liquidation';
    status: string;
    requestorId: string;
    requestorName: string;
    department: string;
    purpose: string;
    client?: string;
    claimedAmount: number;
    approvedAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    createdAt: string;
    submittedAt?: string;
    approvedAt?: string;
    paidAt?: string;
    completedAt?: string;
    categories: string[];
    paymentMethods: string[];
    lineItems: Array<{ category: string; amount: number; paymentMethod: string; expenseDate: string }>;
  };

  const sortedEntityHistory = (
    entityId: string,
    key: 'claim_id' | 'cash_advance_id' | 'liquidation_id'
  ) => statusHistories
    .filter(h => h[key] === entityId)
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const eventTimestamp = (history: StatusHistory[], statuses: string[]) =>
    history.find(h => statuses.includes(h.new_status))?.timestamp;

  const normalizeAnalyticsStatus = (status: string) =>
    status === ClaimStatus.RETURNED || status === LiquidationStatus.RETURNED_FOR_REVISION
      ? 'Returned for Revision'
      : status;

  const analyticsScopeIncludes = (
    user: User,
    type: AnalyticsRecord['type'],
    status: string,
    requestorId: string,
    approverId?: string,
    originalApproverId?: string
  ) => {
    if (user.role === UserRole.ADMIN) return true;
    if (user.role === UserRole.FINANCE) return isFinanceVisibleFinancialRecord(type, status);
    if (user.role === UserRole.REQUESTOR) return requestorId === user.id;
    if (user.role === UserRole.APPROVER) {
      const isReportee = users.some(candidate => candidate.id === requestorId && candidate.reports_to === user.id);
      return requestorId === user.id
        || approverId === user.id
        || originalApproverId === user.id
        || isReportee
        || isActiveDelegateFor(user.id, approverId);
    }
    if (user.role === UserRole.CUSTODIAN) {
      if (requestorId === user.id) return true;
      if (type === 'Reimbursement' || type === 'Transport Reimbursement') {
        return [ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED].includes(status as ClaimStatus);
      }
      if (type === 'Cash Advance') {
        return [CashAdvanceStatus.APPROVED, CashAdvanceStatus.RELEASED, CashAdvanceStatus.LIQUIDATED].includes(status as CashAdvanceStatus);
      }
      return [LiquidationStatus.SUBMITTED, LiquidationStatus.REVIEWED, LiquidationStatus.CLOSED].includes(status as LiquidationStatus);
    }
    return false;
  };

  const buildAnalyticsRecords = (user: User): AnalyticsRecord[] => {
    const reimbursementRecords: AnalyticsRecord[] = claims
      .filter(claim => analyticsScopeIncludes(
        user,
        'Reimbursement',
        claim.status,
        claim.requestor_id,
        claim.current_approver_id,
        claim.original_approver_id
      ))
      .map(claim => {
        const history = sortedEntityHistory(claim.id, 'claim_id');
        const requestor = users.find(candidate => candidate.id === claim.requestor_id);
        const mom = moms.find(candidate => candidate.id === claim.mom_id);
        const items = expenses.filter(item => item.claim_id === claim.id);
        const claimedAmount = Number(claim.total_amount) || 0;
        // Gated on demoModeEnabled 2026-08-05, matching src/lib/api.ts's
        // fromServerClaim() (docs/project-handoff/REMAINING-BACKEND-GAPS.md
        // #11). AnalyticsRecord.approvedAmount/paidAmount stay non-optional
        // numbers (unlike the frontend Claim type) since they're summed
        // directly into dashboard/report totals just below and in
        // src/lib/analytics.ts/downloadAnalyticsCsv — an `undefined` would
        // need every summation site + the CSV's .toFixed(2) call updated to
        // treat "unknown" as distinct from "zero". Demo mode keeps the old
        // plausible-looking inference so seeded dashboards still populate;
        // production falls back to 0 instead of inventing a number — an
        // approved claim missing its real approved_amount is a
        // data-integrity problem to investigate, not paper over with a
        // number a Finance user could mistake for the authoritative figure.
        const approvedAmount = Number(claim.approved_amount)
          || (demoModeEnabled && [ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED].includes(claim.status)
            ? Math.min(claimedAmount, REIMBURSEMENT_CAP)
            : 0);
        const paidAmount = Number(claim.paid_amount)
          || (demoModeEnabled && [ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED].includes(claim.status) ? approvedAmount : 0);
        return {
          id: claim.id,
          ref: claim.claim_number || `REIM-${claim.id.slice(0, 6)}`,
          type: claim.claim_type === 'Transport Reimbursement' ? 'Transport Reimbursement' : 'Reimbursement',
          status: normalizeAnalyticsStatus(claim.status),
          requestorId: claim.requestor_id,
          requestorName: requestor?.name || 'Unknown',
          department: requestor?.department || 'Unknown',
          purpose: claim.remarks || mom?.purpose || claim.expense_category || 'Reimbursement',
          client: mom?.client,
          claimedAmount,
          approvedAmount,
          paidAmount,
          outstandingAmount: Math.max(approvedAmount - paidAmount, 0),
          createdAt: claim.created_at,
          submittedAt: eventTimestamp(history, [ClaimStatus.PENDING_APPROVAL]),
          approvedAt: claim.approved_at || eventTimestamp(history, [ClaimStatus.APPROVED, ClaimStatus.PROCESSING]),
          paidAt: claim.paid_at || eventTimestamp(history, [ClaimStatus.READY_FOR_CLAIM]),
          completedAt: eventTimestamp(history, [ClaimStatus.COMPLETED]),
          categories: Array.from(new Set(items.map(item => item.category).filter(Boolean))),
          paymentMethods: Array.from(new Set([
            claim.payment_method,
            ...items.map(item => item.payment_method),
          ].filter((value): value is string => Boolean(value)))),
          lineItems: items.map(item => ({
            category: item.category,
            amount: Number(item.amount) || 0,
            paymentMethod: item.payment_method,
            expenseDate: item.expense_date,
          })),
        };
      });

    const advanceRecords: AnalyticsRecord[] = cashAdvances
      .filter(advance => analyticsScopeIncludes(
        user,
        'Cash Advance',
        advance.status,
        advance.requestorId,
        advance.approverId
      ))
      .map(advance => {
        const history = sortedEntityHistory(advance.id, 'cash_advance_id');
        const requestor = users.find(candidate => candidate.id === advance.requestorId);
        const mom = advance.momId ? moms.find(candidate => candidate.id === advance.momId) : undefined;
        const claimedAmount = Number(advance.amount) || 0;
        const approvedAmount = [CashAdvanceStatus.APPROVED, CashAdvanceStatus.RELEASED, CashAdvanceStatus.LIQUIDATED].includes(advance.status)
          ? claimedAmount
          : 0;
        const paidAmount = Number(advance.paidAmount)
          || ([CashAdvanceStatus.RELEASED, CashAdvanceStatus.LIQUIDATED].includes(advance.status) ? claimedAmount : 0);
        return {
          id: advance.id,
          ref: `CADV-${advance.id.slice(0, 6)}`,
          type: 'Cash Advance',
          status: normalizeAnalyticsStatus(advance.status),
          requestorId: advance.requestorId,
          requestorName: requestor?.name || 'Unknown',
          department: requestor?.department || 'Unknown',
          purpose: advance.purpose,
          client: mom?.client,
          claimedAmount,
          approvedAmount,
          paidAmount,
          outstandingAmount: Math.max(approvedAmount - paidAmount, 0),
          createdAt: advance.createdAt,
          submittedAt: eventTimestamp(history, [CashAdvanceStatus.SUBMITTED]),
          approvedAt: advance.approvedAt || eventTimestamp(history, [CashAdvanceStatus.APPROVED]),
          paidAt: advance.releaseDate || eventTimestamp(history, [CashAdvanceStatus.RELEASED]),
          completedAt: eventTimestamp(history, [CashAdvanceStatus.LIQUIDATED]),
          categories: [],
          paymentMethods: advance.releaseMethod ? [advance.releaseMethod] : [],
          lineItems: [],
        };
      });

    const liquidationRecords: AnalyticsRecord[] = liquidations
      .filter(liquidation => {
        const advance = cashAdvances.find(candidate => candidate.id === liquidation.cashAdvanceId);
        return analyticsScopeIncludes(
          user,
          'Liquidation',
          liquidation.status,
          liquidation.requestorId,
          advance?.approverId
        );
      })
      .map(liquidation => {
        const history = sortedEntityHistory(liquidation.id, 'liquidation_id');
        const requestor = users.find(candidate => candidate.id === liquidation.requestorId);
        const advance = cashAdvances.find(candidate => candidate.id === liquidation.cashAdvanceId);
        const mom = advance?.momId ? moms.find(candidate => candidate.id === advance.momId) : undefined;
        const items = liquidationLineItems.filter(item => item.liquidationId === liquidation.id);
        const claimedAmount = Number(liquidation.totalSpent) || 0;
        const approvedAmount = [LiquidationStatus.REVIEWED, LiquidationStatus.CLOSED].includes(liquidation.status)
          ? claimedAmount
          : 0;
        return {
          id: liquidation.id,
          ref: `LIQ-${liquidation.id.slice(0, 6)}`,
          type: 'Liquidation',
          status: normalizeAnalyticsStatus(liquidation.status),
          requestorId: liquidation.requestorId,
          requestorName: requestor?.name || 'Unknown',
          department: requestor?.department || 'Unknown',
          purpose: advance?.purpose || 'Liquidation',
          client: mom?.client,
          claimedAmount,
          approvedAmount,
          // A liquidation describes use/settlement of an already-paid advance.
          paidAmount: 0,
          outstandingAmount: 0,
          createdAt: liquidation.createdAt,
          submittedAt: eventTimestamp(history, [LiquidationStatus.SUBMITTED]),
          approvedAt: eventTimestamp(history, [LiquidationStatus.REVIEWED, LiquidationStatus.CLOSED]),
          completedAt: eventTimestamp(history, [LiquidationStatus.CLOSED]),
          categories: Array.from(new Set(items.map(item => item.category).filter(Boolean))),
          paymentMethods: Array.from(new Set([
            liquidation.refundMethod,
            ...items.map(item => item.payment_method),
          ].filter((value): value is string => Boolean(value)))),
          lineItems: items.map(item => ({
            category: item.category,
            amount: Number(item.amount) || 0,
            paymentMethod: item.payment_method,
            expenseDate: item.expense_date,
          })),
        };
      });

    return [...reimbursementRecords, ...advanceRecords, ...liquidationRecords];
  };

  app.get('/api/analytics/summary', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const scopedRecords = buildAnalyticsRecords(user);
    const {
      dateBasis = 'submitted',
      dateFrom,
      dateTo,
      type,
      status,
      department,
      requestorId,
      client,
      category,
      paymentMethod,
      search,
    } = req.query as Record<string, string | undefined>;
    const basis = (['submitted', 'expense', 'approved', 'paid', 'completed'].includes(dateBasis)
      ? dateBasis
      : 'submitted') as AnalyticsDateBasis;

    const dateForRecord = (record: AnalyticsRecord): string | undefined => {
      if (basis === 'expense') {
        const dates = record.lineItems.map(item => item.expenseDate).filter(Boolean).sort();
        return dates[0];
      }
      if (basis === 'approved') return record.approvedAt;
      if (basis === 'paid') return record.paidAt;
      if (basis === 'completed') return record.completedAt;
      return record.submittedAt;
    };

    const fromTime = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : undefined;
    const query = search?.trim().toLowerCase();
    const filteredRecords = scopedRecords.filter(record => {
      if (type && record.type !== type) return false;
      if (status && record.status !== status) return false;
      if (department && record.department !== department) return false;
      if (requestorId && record.requestorId !== requestorId) return false;
      if (client && record.client !== client) return false;
      if (category && !record.categories.includes(category)) return false;
      if (paymentMethod && !record.paymentMethods.includes(paymentMethod)) return false;
      if (query && ![
        record.ref,
        record.requestorName,
        record.department,
        record.purpose,
        record.client,
      ].some(value => value?.toLowerCase().includes(query))) return false;
      if (fromTime !== undefined || toTime !== undefined) {
        const date = dateForRecord(record);
        if (!date) return false;
        const time = new Date(date).getTime();
        if (!Number.isFinite(time)) return false;
        if (fromTime !== undefined && time < fromTime) return false;
        if (toTime !== undefined && time > toTime) return false;
      }
      return true;
    }).sort((a, b) =>
      new Date(dateForRecord(b) || b.createdAt).getTime() - new Date(dateForRecord(a) || a.createdAt).getTime()
    );

    const sumBy = (selector: (record: AnalyticsRecord) => number) =>
      filteredRecords.reduce((total, record) => total + selector(record), 0);
    const aggregateBy = (selector: (record: AnalyticsRecord) => string) => {
      const groups = new Map<string, { name: string; count: number; claimedAmount: number; approvedAmount: number; paidAmount: number }>();
      filteredRecords.forEach(record => {
        const name = selector(record) || 'Unknown';
        const group = groups.get(name) || { name, count: 0, claimedAmount: 0, approvedAmount: 0, paidAmount: 0 };
        group.count += 1;
        group.claimedAmount += record.claimedAmount;
        group.approvedAmount += record.approvedAmount;
        group.paidAmount += record.paidAmount;
        groups.set(name, group);
      });
      return Array.from(groups.values()).sort((a, b) => b.claimedAmount - a.claimedAmount);
    };

    const categoryTotals = new Map<string, { name: string; count: number; amount: number }>();
    filteredRecords.forEach(record => {
      record.lineItems
        .filter(item => !category || item.category === category)
        .forEach(item => {
          const group = categoryTotals.get(item.category) || { name: item.category, count: 0, amount: 0 };
          group.count += 1;
          group.amount += item.amount;
          categoryTotals.set(item.category, group);
        });
    });

    const approvalDurations = filteredRecords
      .filter(record => record.submittedAt && record.approvedAt)
      .map(record => new Date(record.approvedAt!).getTime() - new Date(record.submittedAt!).getTime())
      .filter(duration => duration >= 0);

    const uniqueSorted = (values: Array<string | undefined>) =>
      Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b));

    res.json({
      appliedFilters: { dateBasis: basis, dateFrom, dateTo, type, status, department, requestorId, client, category, paymentMethod, search },
      metrics: {
        recordCount: filteredRecords.length,
        lineItemCount: filteredRecords.reduce((total, record) => total + record.lineItems.length, 0),
        claimedAmount: sumBy(record => record.claimedAmount),
        approvedAmount: sumBy(record => record.approvedAmount),
        paidAmount: sumBy(record => record.paidAmount),
        outstandingAmount: sumBy(record => record.outstandingAmount),
        avgApprovalTurnaroundDays: approvalDurations.length
          ? approvalDurations.reduce((total, duration) => total + duration, 0) / approvalDurations.length / (1000 * 60 * 60 * 24)
          : null,
      },
      breakdowns: {
        byStatus: aggregateBy(record => record.status),
        byType: aggregateBy(record => record.type),
        byRequestor: aggregateBy(record => record.requestorName),
        byDepartment: aggregateBy(record => record.department),
        byCategory: Array.from(categoryTotals.values()).sort((a, b) => b.amount - a.amount),
      },
      dimensions: {
        types: uniqueSorted(scopedRecords.map(record => record.type)),
        statuses: uniqueSorted(scopedRecords.map(record => record.status)),
        departments: uniqueSorted(scopedRecords.map(record => record.department)),
        requestors: Array.from(new Map(scopedRecords.map(record => [
          record.requestorId,
          { id: record.requestorId, name: record.requestorName },
        ])).values()).sort((a, b) => a.name.localeCompare(b.name)),
        clients: uniqueSorted(scopedRecords.map(record => record.client)),
        categories: uniqueSorted(scopedRecords.flatMap(record => record.categories)),
        paymentMethods: uniqueSorted(scopedRecords.flatMap(record => record.paymentMethods)),
      },
      records: filteredRecords.map(({ lineItems: _lineItems, categories, paymentMethods, ...record }) => ({
        ...record,
        categories,
        paymentMethods,
      })),
    });
  });

  interface MasterDataEntityConfig<T extends MasterDataRecord> {
    key: string;   // used in the URL, e.g. 'departments'
    dbKey: MasterDataKey; // matching key in referenceDataRepo.ts's table map
    label: string; // used in error messages, e.g. 'Department'
    store: () => T[];
    validateFields: (body: any, existing: T[], editingId?: string) => { errors: string[]; fields: Partial<T> };
  }

  // Generalizes the /api/companies CRUD pattern (name required + case-
  // insensitive uniqueness, Admin-only write, any-authenticated-user read)
  // into one reusable route factory, so a future master-data type is a ~15
  // line config block instead of a new copy-pasted route set. Auth is not
  // abstracted away — every route below still explicitly re-checks
  // user.role === ADMIN inline, matching every other write route in this file.
  const registerMasterDataRoutes = <T extends MasterDataRecord>(config: MasterDataEntityConfig<T>) => {
    const base = `/api/master-data/${config.key}`;

    app.get(base, (req, res) => {
      const user = getUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      res.json([...config.store()].sort((a, b) => a.name.localeCompare(b.name)));
    });

    app.post(base, async (req, res) => {
      const user = getUser(req);
      if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

      const { errors, fields } = config.validateFields(req.body, config.store());
      if (errors.length) return res.status(400).json({ error: errors[0] });

      const now = new Date().toISOString();
      const record = { id: uuidv4(), active: true, created_at: now, updated_at: now, ...fields } as T;
      config.store().push(record);
      try {
        await persistMasterDataRecord(config.dbKey, record);
      } catch (err) {
        console.error(`[db] Could not persist new ${config.label} to Postgres:`, err);
      }
      res.json(record);
    });

    app.put(`${base}/:id`, async (req, res) => {
      const user = getUser(req);
      if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

      const record = config.store().find(r => r.id === req.params.id);
      if (!record) return res.status(404).json({ error: `${config.label} not found` });

      const { errors, fields } = config.validateFields(req.body, config.store(), req.params.id);
      if (errors.length) return res.status(400).json({ error: errors[0] });

      (Object.entries(fields) as [keyof T, any][]).forEach(([field, value]) => {
        if (value !== undefined && record[field] !== value) {
          addMasterDataHistory(config.key, record.id, String(field), String(record[field]), String(value), user.id);
          record[field] = value;
        }
      });
      record.updated_at = new Date().toISOString();
      try {
        await persistMasterDataRecord(config.dbKey, record);
      } catch (err) {
        console.error(`[db] Could not persist ${config.label} changes to Postgres:`, err);
      }
      res.json(record);
    });
  };

  // Shared validation for the six uniform catalog entities: name required,
  // case-insensitive unique among active+inactive records, code/notes/active
  // pass through untouched. Each registerMasterDataRoutes() call below is
  // still its own explicit config — nothing here hides an entity's rules.
  const validateNamedCatalogEntity = <T extends MasterDataRecord>(label: string) =>
    (body: any, existing: T[], editingId?: string): { errors: string[]; fields: Partial<T> } => {
      const errors: string[] = [];
      const fields: Partial<T> = {};
      if (body.name !== undefined) {
        const trimmed = String(body.name).trim();
        if (!trimmed) errors.push(`${label} name is required.`);
        else if (existing.some(r => r.id !== editingId && r.name.toLowerCase() === trimmed.toLowerCase())) {
          errors.push(`A ${label.toLowerCase()} with this name already exists.`);
        } else {
          (fields as any).name = trimmed;
        }
      }
      if (body.code !== undefined) (fields as any).code = body.code ? String(body.code).trim() : undefined;
      if (body.notes !== undefined) (fields as any).notes = body.notes;
      if (body.active !== undefined) (fields as any).active = !!body.active;
      return { errors, fields };
    };

  registerMasterDataRoutes<Department>({
    key: 'departments', dbKey: 'departments', label: 'Department',
    store: () => departments,
    validateFields: validateNamedCatalogEntity('Department'),
  });
  registerMasterDataRoutes<CostCenter>({
    key: 'cost-centers', dbKey: 'cost-centers', label: 'Cost Center',
    store: () => costCenters,
    validateFields: validateNamedCatalogEntity('Cost Center'),
  });
  registerMasterDataRoutes<BusinessUnit>({
    key: 'business-units', dbKey: 'business-units', label: 'Business Unit',
    store: () => businessUnits,
    validateFields: validateNamedCatalogEntity('Business Unit'),
  });
  registerMasterDataRoutes<Branch>({
    key: 'branches', dbKey: 'branches', label: 'Branch',
    store: () => branches,
    validateFields: validateNamedCatalogEntity('Branch'),
  });
  registerMasterDataRoutes<ProjectCode>({
    key: 'project-codes', dbKey: 'project-codes', label: 'Project Code',
    store: () => projectCodes,
    validateFields: validateNamedCatalogEntity('Project Code'),
  });
  registerMasterDataRoutes<Vendor>({
    key: 'vendors', dbKey: 'vendors', label: 'Vendor',
    store: () => vendors,
    validateFields: validateNamedCatalogEntity('Vendor'),
  });

  // Aggregate fetch — lets a form (or the Admin module's landing page) load
  // every catalog in one call instead of six, and is what Phase 3's
  // cascading-dropdown/company-autofill wiring will consume.
  app.get('/api/master-data/all', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json({
      departments: [...departments].sort((a, b) => a.name.localeCompare(b.name)),
      costCenters: [...costCenters].sort((a, b) => a.name.localeCompare(b.name)),
      businessUnits: [...businessUnits].sort((a, b) => a.name.localeCompare(b.name)),
      branches: [...branches].sort((a, b) => a.name.localeCompare(b.name)),
      projectCodes: [...projectCodes].sort((a, b) => a.name.localeCompare(b.name)),
      vendors: [...vendors].sort((a, b) => a.name.localeCompare(b.name)),
    });
  });

  // ===== Field Definitions (Phase 2 MDM) =====
  // Admin-configurable form fields. Read is open to any authenticated user
  // (a Requestor needs the active field list to render the MOM form); writes
  // are Admin-only, same split as every other master-data/config route.
  const VALID_INPUT_TYPES = new Set(['text', 'number', 'dropdown', 'date', 'textarea']);
  const VALID_MASTER_DATA_ENTITIES = new Set(['departments', 'costCenters', 'businessUnits', 'branches', 'projectCodes', 'vendors']);

  app.get('/api/field-definitions', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const entity = req.query.entity as string | undefined;
    const list = entity ? fieldDefinitions.filter(f => f.entity === entity) : fieldDefinitions;
    res.json([...list].sort((a, b) => a.display_order - b.display_order));
  });

  const validateFieldDefinitionBody = (body: any, existing: FieldDefinition[], editingId?: string): string | null => {
    if (body.key !== undefined) {
      const key = String(body.key).trim();
      if (!key) return 'Field key is required.';
      if (!/^[a-z][a-z0-9_]*$/.test(key)) return 'Field key must be lowercase letters, numbers, and underscores, starting with a letter.';
      if (existing.some(f => f.id !== editingId && f.entity === (body.entity || existing.find(e => e.id === editingId)?.entity) && f.key === key)) {
        return 'A field with this key already exists for this form.';
      }
    }
    if (body.label !== undefined && !String(body.label).trim()) return 'Field label is required.';
    if (body.input_type !== undefined && !VALID_INPUT_TYPES.has(body.input_type)) return `Input type must be one of: ${[...VALID_INPUT_TYPES].join(', ')}.`;
    if (body.master_data_entity !== undefined && body.master_data_entity !== null && !VALID_MASTER_DATA_ENTITIES.has(body.master_data_entity)) {
      return `Master data source must be one of: ${[...VALID_MASTER_DATA_ENTITIES].join(', ')}.`;
    }
    if (body.display_order !== undefined && typeof body.display_order !== 'number') return 'Display order must be a number.';
    return null;
  };

  app.post('/api/field-definitions', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    if (!req.body.key || !req.body.label || !req.body.input_type || !req.body.entity) {
      return res.status(400).json({ error: 'entity, key, label, and input_type are required.' });
    }
    const validationError = validateFieldDefinitionBody(req.body, fieldDefinitions);
    if (validationError) return res.status(400).json({ error: validationError });

    const now = new Date().toISOString();
    const def: FieldDefinition = {
      id: uuidv4(),
      entity: req.body.entity,
      key: String(req.body.key).trim(),
      label: String(req.body.label).trim(),
      input_type: req.body.input_type,
      required: !!req.body.required,
      active: req.body.active !== undefined ? !!req.body.active : true,
      default_value: req.body.default_value || undefined,
      display_order: typeof req.body.display_order === 'number' ? req.body.display_order : fieldDefinitions.length + 1,
      options: Array.isArray(req.body.options) ? req.body.options : undefined,
      master_data_entity: req.body.master_data_entity || undefined,
      allow_other: !!req.body.allow_other,
      applicableClaimTypes: Array.isArray(req.body.applicableClaimTypes) ? req.body.applicableClaimTypes : undefined,
      validation: req.body.validation || undefined,
      created_at: now,
      updated_at: now,
    };
    fieldDefinitions.push(def);
    try {
      await persistFieldDefinition(def);
    } catch (err) {
      console.error('[db] Could not persist new field definition to Postgres:', err);
    }
    res.json(def);
  });

  app.put('/api/field-definitions/:id', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const def = fieldDefinitions.find(f => f.id === req.params.id);
    if (!def) return res.status(404).json({ error: 'Field definition not found' });

    const validationError = validateFieldDefinitionBody(req.body, fieldDefinitions, def.id);
    if (validationError) return res.status(400).json({ error: validationError });

    (['key', 'label', 'input_type', 'required', 'active', 'default_value', 'display_order', 'options', 'master_data_entity', 'allow_other', 'applicableClaimTypes', 'validation'] as const)
      .forEach(field => {
        const value = req.body[field];
        if (value !== undefined && JSON.stringify((def as any)[field]) !== JSON.stringify(value)) {
          addMasterDataHistory('field-definitions', def.id, field, JSON.stringify((def as any)[field] ?? null), JSON.stringify(value), user.id);
          (def as any)[field] = value;
        }
      });
    def.updated_at = new Date().toISOString();
    try {
      await persistFieldDefinition(def);
    } catch (err) {
      console.error('[db] Could not persist field definition changes to Postgres:', err);
    }
    res.json(def);
  });

  // Shared by any route that saves an entity with dynamic custom_fields
  // (currently just MOM) — returns an error message naming the first missing
  // required+active field, or null if satisfied. Enforced server-side, not
  // just in the form, since an Admin can flip a field to required at any time.
  const validateRequiredCustomFields = (entity: FieldDefinition['entity'], customFields: Record<string, string> | undefined): string | null => {
    const missing = fieldDefinitions.find(f =>
      f.entity === entity && f.active && f.required && !(customFields && String(customFields[f.key] ?? '').trim())
    );
    return missing ? `${missing.label} is required.` : null;
  };

  // Flips any Active delegation whose end_date has passed to Expired. Called
  // defensively on every read/use of the delegations list (getActiveDelegation
  // below) so routing decisions never use a stale Active delegation, and also
  // driven by the scheduled job further down so it fires even when nothing
  // happens to read delegations for a while. Idempotent either way — only an
  // Active row already past its own end_date is touched.
  const syncDelegationStatuses = () => {
    const now = new Date();
    delegations.forEach(d => {
      if (d.status === DelegationStatus.ACTIVE) {
        const end = new Date(d.end_date);
        end.setHours(23, 59, 59, 999);
        if (now > end) {
          const oldStatus = d.status;
          d.status = DelegationStatus.EXPIRED;
          d.updated_at = now.toISOString();
          addDelegationHistory(d.id, oldStatus, DelegationStatus.EXPIRED, 'system', 'Delegation window ended.');
          // Fire-and-forget, matching persistStatusHistoryFireAndForget's
          // convention just above — this function is called synchronously
          // from many routing-decision code paths (getActiveDelegation), so
          // making it async would ripple awaits through all of them. The
          // status itself is cheaply re-derivable from end_date on every
          // call, so a dropped write on a transient DB blip self-heals the
          // next time this runs; only the audit trail needs the fire-and-
          // forget it already had.
          persistDelegation(d).catch((err: unknown) =>
            console.error('[db] Could not persist delegation expiry to Postgres:', err));
        }
      }
    });
  };

  // The one place "who is actually approving for this approver right now"
  // gets decided - every claim/CADV/MOM/review-meeting routing check below
  // calls this instead of re-deriving it inline.
  const getActiveDelegation = (approverId: string, atDate: Date = new Date()): ApproverDelegation | undefined => {
    syncDelegationStatuses();
    return delegations.find(d => {
      if (d.approver_id !== approverId || d.status !== DelegationStatus.ACTIVE) return false;
      const start = new Date(d.start_date);
      const end = new Date(d.end_date);
      end.setHours(23, 59, 59, 999);
      return atDate >= start && atDate <= end;
    });
  };

  // Walks the (pre-change) reporting chain upward from candidateManagerId; if
  // it ever reaches userId, assigning candidateManagerId as userId's manager
  // would close a loop (direct or transitive). Guards against pre-existing
  // cycles/bad data causing an infinite walk.
  const wouldCreateCycle = (userId: string, candidateManagerId: string): boolean => {
    if (candidateManagerId === userId) return true;
    let currentId: string | null = candidateManagerId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === userId) return true;
      if (visited.has(currentId)) return false;
      visited.add(currentId);
      const currentUser: User | undefined = users.find(u => u.id === currentId);
      currentId = currentUser?.reports_to ?? null;
    }
    return false;
  };

  // --- Simulated Entra ID hierarchy sync ------------------------------
  // See docs/hierarchy-sync-design.md. There's no real Graph API here — the
  // Admin editing a user's `reports_to` in User Accounts stands in for a
  // sync cycle picking up an org-chart change (promotion/demotion/transfer).

  const STALE_APPROVER_FALLBACK_DAYS = 7;

  // §3: approval authority is derived from headcount, not role — re-derived
  // every time the org chart changes for this person, in either direction
  // (gaining a first report grants it, dropping to zero revokes it). An
  // Admin override via the "Can Approve Reimbursements" checkbox in User
  // Accounts persists until the next headcount change for that person.
  const recalcApprovalAuthority = (userId: string | null) => {
    if (!userId) return;
    const u = users.find(x => x.id === userId);
    if (!u) return;
    // Only an Approver can ever hold approval authority — see the role check
    // in PUT /api/users/:id. A non-Approver gaining a direct report (an
    // unusual org-chart state) still doesn't grant it.
    u.can_approve_reimbursements = u.role === UserRole.APPROVER && users.some(x => x.reports_to === userId);
  };

  // §5: when a requestor's manager changes, any claim already Pending
  // Approval under their old approver stays put — but the old approver gets
  // notified and offered a transfer, with a 7-day fallback to Admin.
  const detectStaleApprovers = async (requestorId: string, oldManagerId: string | null, newManagerId: string | null, changedBy: string) => {
    if (!oldManagerId || oldManagerId === newManagerId) return;
    const requestor = users.find(u => u.id === requestorId);
    const oldApprover = users.find(u => u.id === oldManagerId);
    const newApprover = newManagerId ? users.find(u => u.id === newManagerId) : undefined;

    const affected = claims.filter(c =>
      c.requestor_id === requestorId &&
      c.current_approver_id === oldManagerId &&
      c.status === ClaimStatus.PENDING_APPROVAL
    );

    for (const claim of affected) {
      claim.approver_stale_since = new Date().toISOString();
      claim.pending_transfer_to = newManagerId || null;
      claim.approver_stale_reason = `${requestor?.name || 'This requestor'} no longer reports to ${oldApprover?.name || 'you'}.`;
      claim.escalated_to_admin = false;

      addHistory(claim.id, claim.status, claim.status, changedBy,
        `Org change: ${requestor?.name || requestorId}'s manager changed from ${oldApprover?.name || '(none)'} to ${newApprover?.name || '(none)'}. Approver notified per hierarchy-sync policy.`);

      const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0, 6)}`;
      sendEmail(oldManagerId,
        `Org change — approver review needed for ${claimNumber}`,
        `${requestor?.name || 'This requestor'} no longer reports to you. Their manager is now ${newApprover?.name || 'unassigned'}.

You can keep reviewing ${claimNumber} yourself, or transfer it to ${newApprover?.name || 'the new manager'} from your Approver Inbox.

If no action is taken within ${STALE_APPROVER_FALLBACK_DAYS} days, this will be escalated to an Admin for manual reassignment.`);

      try {
        await persistClaim(claim);
      } catch (err) {
        console.error('[db] Could not persist stale-approver flag to Postgres:', err);
      }
    }
  };

  // Prototype account picker. It intentionally exposes only the fields needed
  // to choose a demo identity; the full directory remains authenticated. This
  // endpoint automatically closes when AUTH_MODE=microsoft unless explicitly
  // reopened for a controlled test environment.
  app.get('/api/demo-users', (_req, res) => {
    if (!demoLoginEnabled) {
      return res.status(404).json({ error: 'Demo login is disabled.' });
    }
    res.json(users.map(({ id, name, email, role, department, job_title, avatar_url }) => ({
      id,
      name,
      email,
      role,
      department,
      job_title,
      avatar_url,
    })));
  });

  app.get('/api/users', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json(users);
  });

  // Admin settings endpoints
  app.get('/api/admin/settings', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json(systemSettings);
  });

  app.put('/api/admin/settings', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { expenseCategories, highValueThreshold, paymentMethods, categoryLimits } = req.body;
    if (expenseCategories && Array.isArray(expenseCategories)) {
      systemSettings.expenseCategories = Array.from(new Set(expenseCategories.map(normalizeExpenseCategory).filter(Boolean)));
    }
    if (typeof highValueThreshold === 'number') {
      systemSettings.highValueThreshold = highValueThreshold;
    }
    if (paymentMethods && Array.isArray(paymentMethods)) {
      systemSettings.paymentMethods = paymentMethods;
    }
    if (categoryLimits && typeof categoryLimits === 'object' && !Array.isArray(categoryLimits)) {
      // Keep only positive numeric caps; a 0 or blank clears that category's cap.
      const cleaned: Record<string, number> = {};
      for (const [cat, val] of Object.entries(categoryLimits)) {
        const num = Number(val);
        if (Number.isFinite(num) && num > 0) cleaned[normalizeExpenseCategory(cat)] = num;
      }
      systemSettings.categoryLimits = cleaned;
    }
    try {
      await persistSystemSettings(systemSettings);
    } catch (err) {
      console.error('[db] Could not persist system settings to Postgres:', err);
    }
    res.json(systemSettings);
  });

  // Admin: Update a user's role/department/job title/reporting manager.
  // Configuration action, deliberately separate from claim approval/processing
  // permissions - segregation of duties for claims is untouched by this route.
  app.put('/api/users/:id', async (req, res) => {
    const admin = getUser(req);
    if (!admin || admin.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const target = users.find(u => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { role, department, job_title, reports_to, confirmOrphan, employment_status, can_approve_reimbursements } = req.body;

    // Defense in depth - the UI also disables this, but never trust the client.
    if (target.id === admin.id && role !== undefined && role !== UserRole.ADMIN) {
      return res.status(400).json({ error: 'You cannot remove your own Admin role.' });
    }

    if (reports_to !== undefined && reports_to !== null) {
      if (reports_to === target.id) {
        return res.status(400).json({ error: 'A user cannot report to themselves.' });
      }
      if (wouldCreateCycle(target.id, reports_to)) {
        return res.status(400).json({ error: 'This change would create a circular reporting chain.' });
      }
    }

    const roleChanging = role !== undefined && role !== target.role;
    if (roleChanging && target.role === UserRole.APPROVER && role !== UserRole.APPROVER) {
      const reportees = users.filter(u => u.reports_to === target.id);
      if (reportees.length > 0 && !confirmOrphan) {
        return res.status(409).json({
          error: 'orphan_warning',
          message: `${target.name} still has ${reportees.length} direct report${reportees.length > 1 ? 's' : ''} (${reportees.map(u => u.name).join(', ')}) who will be left without a valid approver. Confirm to proceed anyway.`,
          reportees: reportees.map(u => ({ id: u.id, name: u.name }))
        });
      }
    }

    const changed: string[] = [];
    const staleFlaggedClaims: Claim[] = [];

    if (role !== undefined && role !== target.role) {
      addUserHistory(target.id, target.role, role, admin.id, `Changed ${target.name}'s role`);
      target.role = role;
      changed.push('role');
      // Approval authority only ever makes sense for the Approver role — see
      // docs/hierarchy-sync-design.md §3 and CLAUDE.md's segregation-of-duties
      // rule. Moving someone off Approver strips it automatically so a
      // Requestor/Custodian/Admin can never be left showing "can approve".
      if (role !== UserRole.APPROVER && target.can_approve_reimbursements) {
        addUserHistory(target.id, 'true', 'false', admin.id, `Approval authority revoked — ${target.name} is no longer an Approver`);
        target.can_approve_reimbursements = false;
      }
    }
    if (department !== undefined && department !== target.department) {
      addUserHistory(target.id, target.department, department, admin.id, `Changed ${target.name}'s department`);
      target.department = department;
      changed.push('department');
    }
    if (job_title !== undefined && job_title !== target.job_title) {
      addUserHistory(target.id, target.job_title || '(none)', job_title || '(none)', admin.id, `Changed ${target.name}'s job title`);
      target.job_title = job_title;
      changed.push('job_title');
    }
    if (reports_to !== undefined && reports_to !== target.reports_to) {
      const oldManagerId = target.reports_to;
      const oldManagerName = users.find(u => u.id === oldManagerId)?.name || '(none)';
      const newManagerName = reports_to ? (users.find(u => u.id === reports_to)?.name || reports_to) : '(none)';
      addUserHistory(target.id, oldManagerName, newManagerName, admin.id, `Changed ${target.name}'s reporting manager`);
      target.reports_to = reports_to;
      changed.push('reports_to');

      // Simulated Entra ID sync consequences — docs/hierarchy-sync-design.md §3, §5
      recalcApprovalAuthority(oldManagerId);
      recalcApprovalAuthority(reports_to);
      await detectStaleApprovers(target.id, oldManagerId, reports_to, admin.id);
    }
    if (employment_status !== undefined && employment_status !== target.employment_status) {
      addUserHistory(target.id, target.employment_status || 'Active', employment_status, admin.id, `Changed ${target.name}'s employment status`);
      target.employment_status = employment_status;
      changed.push('employment_status');
      // §9: an approver going Inactive with claims still pending under them is
      // treated the same as a non-response — flag immediately rather than
      // waiting on a notification nobody can act on.
      if (employment_status === 'Inactive') {
        claims.forEach(c => {
          if (c.current_approver_id === target.id && c.status === ClaimStatus.PENDING_APPROVAL && !c.approver_stale_since) {
            c.approver_stale_since = new Date().toISOString();
            c.pending_transfer_to = null;
            c.approver_stale_reason = `${target.name} is now marked Inactive.`;
            staleFlaggedClaims.push(c);
          }
        });
      }
    }
    if (can_approve_reimbursements !== undefined && can_approve_reimbursements !== target.can_approve_reimbursements) {
      if (can_approve_reimbursements && target.role !== UserRole.APPROVER) {
        return res.status(400).json({ error: `Only Approvers can be granted approval authority. ${target.name} is currently ${target.role} — change their role first.` });
      }
      addUserHistory(target.id, String(target.can_approve_reimbursements), String(can_approve_reimbursements), admin.id, `Admin override: ${target.name}'s approval authority`);
      target.can_approve_reimbursements = can_approve_reimbursements;
      changed.push('can_approve_reimbursements');
    }

    // recalcApprovalAuthority() above can touch users other than `target`
    // (the old/new manager), so sync the whole array rather than just one
    // row. A sync failure doesn't fail the request — the in-memory state
    // (already authoritative for this process) is correct either way; it
    // just means this write hasn't durably landed yet, which self-heals on
    // the next successful sync rather than breaking a live demo over a
    // transient DB blip.
    try {
      await syncUsersToDb(users);
      for (const claim of staleFlaggedClaims) await persistClaim(claim);
    } catch (err) {
      console.error('[db] Could not persist user/claim changes to Postgres:', err);
    }

    res.json({ user: target, changed });
  });

  // Company Directory - readable by any authenticated role since MOM creation
  // (any Requestor/Approver) needs to read it; create/edit is Admin-only.
  app.get('/api/companies', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json([...companies].sort((a, b) => a.name.localeCompare(b.name)));
  });

  app.post('/api/companies', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const {
      name, industry, notes,
      address, business_unit_id, cost_center_id, default_department_id, currency, tax_id, default_approver_id,
      contact_person, contact_email
    } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Company name is required.' });
    if (companies.some(c => c.name.toLowerCase() === name.trim().toLowerCase())) {
      return res.status(400).json({ error: 'A company with this name already exists.' });
    }

    const company: Company = {
      id: uuidv4(), name: name.trim(), industry, notes,
      address, business_unit_id, cost_center_id, default_department_id, currency, tax_id, default_approver_id,
      contact_person, contact_email,
      // Deliberately added by an admin, who already filled in whatever
      // details they had — nothing here needs a later review pass.
      pending_review: false,
      created_by: user.id,
    };
    companies.push(company);
    try {
      await persistCompany(company);
    } catch (err) {
      console.error('[db] Could not persist new company to Postgres:', err);
    }
    res.json(company);
  });

  app.post('/api/companies/import', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const rows = Array.isArray(req.body?.companies) ? req.body.companies : [];
    if (!rows.length) return res.status(400).json({ error: 'The import contains no company rows.' });
    if (rows.length > 5000) return res.status(400).json({ error: 'A single import is limited to 5,000 companies.' });

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (const [index, raw] of rows.entries()) {
      const name = String(raw?.name || '').trim();
      if (!name) {
        errors.push({ row: index + 2, error: 'Company name is required.' });
        continue;
      }

      const values = {
        industry: String(raw.industry || '').trim() || undefined,
        notes: String(raw.notes || '').trim() || undefined,
        address: String(raw.address || raw.location || '').trim() || undefined,
        currency: String(raw.currency || '').trim() || undefined,
        tax_id: String(raw.tax_id || raw.taxId || '').trim() || undefined,
        contact_person: String(raw.contact_person || raw.contactPerson || '').trim() || undefined,
        contact_email: String(raw.contact_email || raw.contactEmail || '').trim() || undefined,
      };
      const existing = companies.find(company => company.name.toLowerCase() === name.toLowerCase());

      if (!existing) {
        const company: Company = { id: uuidv4(), name, ...values };
        companies.push(company);
        addMasterDataHistory('companies', company.id, 'import', '(new)', name, user.id);
        try {
          await persistCompany(company);
        } catch (err) {
          console.error('[db] Could not persist imported company to Postgres:', err);
        }
        inserted++;
        continue;
      }

      let changed = false;
      (Object.keys(values) as Array<keyof typeof values>).forEach(field => {
        const next = values[field];
        if (next !== undefined && existing[field] !== next) {
          addMasterDataHistory('companies', existing.id, field, String(existing[field] ?? '(none)'), next, user.id);
          (existing as any)[field] = next;
          changed = true;
        }
      });
      if (changed) {
        try {
          await persistCompany(existing);
        } catch (err) {
          console.error('[db] Could not persist updated company to Postgres:', err);
        }
        updated++;
      } else {
        skipped++;
      }
    }

    res.json({ inserted, updated, skipped, errors, total: rows.length });
  });

  // Phase 1 MDM enrichment fields below (address/business_unit_id/etc.) are
  // additive to the pre-existing name/industry/notes fields — see
  // src/types.ts's Company interface. default_approver_id is informational
  // reference data ONLY: it must never be read by claim approval routing,
  // which stays 100% derived from requestor.reports_to / an active
  // ApproverDelegation, per CLAUDE.md's segregation-of-duties rule.
  app.put('/api/companies/:id', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const company = companies.find(c => c.id === req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { name, industry, notes } = req.body;
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Company name is required.' });
      if (companies.some(c => c.id !== company.id && c.name.toLowerCase() === name.trim().toLowerCase())) {
        return res.status(400).json({ error: 'A company with this name already exists.' });
      }
      company.name = name.trim();
    }
    if (industry !== undefined) company.industry = industry;
    if (notes !== undefined) company.notes = notes;

    const enrichmentFields = ['address', 'business_unit_id', 'cost_center_id', 'default_department_id', 'currency', 'tax_id', 'default_approver_id', 'contact_person', 'contact_email'] as const;
    (['pending_review', ...enrichmentFields] as const)
      .forEach(field => {
        const value = req.body[field];
        if (value !== undefined && company[field] !== value) {
          addMasterDataHistory('companies', company.id, field, String(company[field] ?? '(none)'), String(value || '(none)'), user.id);
          (company as any)[field] = value;
        }
      });

    // Any substantive edit is itself an implicit review — an admin who just
    // touched the name or an enrichment field has looked at the record, even
    // if they didn't explicitly clear the flag via the "Mark reviewed" action.
    const editedSomethingElse = name !== undefined || industry !== undefined || notes !== undefined
      || enrichmentFields.some(field => req.body[field] !== undefined);
    if (editedSomethingElse && req.body.pending_review === undefined) {
      company.pending_review = false;
    }

    try {
      await persistCompany(company);
    } catch (err) {
      console.error('[db] Could not persist company changes to Postgres:', err);
    }
    res.json(company);
  });
  app.post('/api/login', (req, res) => {
    const { email } = req.body;
    const user = users.find(u => u.email === email);
    if (user) {
      res.json(user);
    } else {
      res.status(401).json({ error: 'User not found' });
    }
  });

  app.get('/api/me', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json(user);
  });

  // Self-service notification preferences — any authenticated user can set
  // their own; unlike PUT /api/users/:id this isn't an admin-only route.
  app.put('/api/me/notification-prefs', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    user.notification_prefs = req.body;
    try {
      await syncUsersToDb(users);
    } catch (err) {
      console.error('[db] Could not persist notification preferences to Postgres:', err);
    }
    res.json(user.notification_prefs);
  });

  // MOM endpoints (accessed for managing meeting notes)
  app.get('/api/moms', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    let relevantMoms: Mom[] = [];
    if (user.role === UserRole.ADMIN) {
      relevantMoms = moms; // Admin sees all MOMs
    } else if (user.role === UserRole.CUSTODIAN) {
      // Custodians only need the claim/receipt to verify and release payment;
      // MOM client-meeting content is out of scope for that role.
      relevantMoms = [];
    } else if (user.role === UserRole.FINANCE) {
      // MOM content follows the linked record's Finance boundary; merely
      // submitting a request does not make meeting content Finance-visible.
      relevantMoms = moms.filter(m => {
        const claim = claims.find(candidate => candidate.id === m.claim_id);
        return Boolean(claim && isFinanceVisibleFinancialRecord(claim.claim_type || 'Reimbursement', claim.status));
      });
    } else if (user.role === UserRole.REQUESTOR) {
      relevantMoms = moms.filter(m => m.requestor_id === user.id);
    } else if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      relevantMoms = moms.filter(m =>
        m.requestor_id === user.id ||
        (!!m.claim_id && !!m.requestor_id && reporteeIds.includes(m.requestor_id))
      );
    }

    // Enrich with requestor name
    const enriched = relevantMoms.map(m => {
      const requestor = users.find(u => u.id === m.requestor_id);
      return { 
        ...m, 
        prepared_by: requestor ? requestor.name : (m.prepared_by || 'Unknown'),
        prepared_by_department: requestor ? requestor.department : undefined,
        prepared_by_job_title: requestor ? requestor.job_title : undefined,
        client_name: m.client || m.summary || 'Unknown Client' // for calendar/retro-compatibility
      };
    });
    
    res.json(enriched);
  });

  app.get('/api/moms/:id', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    if (user.role === UserRole.CUSTODIAN) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const mom = moms.find(m => m.id === req.params.id);
    if (!mom) return res.status(404).json({ error: 'Minutes of Meeting not found' });

    if (!canAccessMom(user, mom)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const requestor = users.find(u => u.id === mom.requestor_id);
    const linkedClaim = mom.claim_id ? claims.find(c => c.id === mom.claim_id) : undefined;

    res.json({
      ...mom,
      requestor,
      prepared_by: requestor ? requestor.name : (mom.prepared_by || 'Unknown'),
      prepared_by_department: requestor ? requestor.department : undefined,
      prepared_by_job_title: requestor ? requestor.job_title : undefined,
      linkedClaim,
    });
  });

  app.get('/api/receipts', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.FINANCE) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const flatReceipts = [];

    // 1. Flatten claim expenses
    for (const exp of expenses) {
      const claim = claims.find(c => c.id === exp.claim_id);
      if (user.role === UserRole.FINANCE && (!claim || !isFinanceVisibleFinancialRecord(claim.claim_type || 'Reimbursement', claim.status))) continue;
      const reqUser = claim ? users.find(u => u.id === claim.requestor_id) : undefined;
      const claimNo = claim ? (claim.claim_number || `REIM-${claim.id.substring(0, 6)}`) : 'Unknown';
      
      flatReceipts.push({
        id: `exp-${exp.id}`,
        sourceId: exp.id,
        parentId: claim?.id || '',
        parentType: 'Claim',
        parentNumber: claimNo,
        receipt_url: exp.receipt_url || '',
        or_number: exp.or_number || '',
        vendor: exp.vendor || 'Unknown Vendor',
        amount: exp.amount,
        expense_date: exp.expense_date,
        category: exp.category,
        business_purpose: exp.business_purpose || '',
        requestor_name: reqUser ? reqUser.name : 'Unknown',
        requestor_department: reqUser ? reqUser.department : 'Unknown',
      });
    }

    // 2. Flatten liquidation expenses
    for (const item of liquidationLineItems) {
      const liq = liquidations.find(l => l.id === item.liquidationId);
      if (user.role === UserRole.FINANCE && (!liq || !isFinanceVisibleFinancialRecord('Liquidation', liq.status))) continue;
      const reqUser = liq ? users.find(u => u.id === liq.requestorId) : undefined;
      const liqNo = liq ? `LIQ-${liq.id.substring(0, 6)}` : 'Unknown';

      flatReceipts.push({
        id: `liq-${item.id}`,
        sourceId: item.id,
        parentId: liq?.id || '',
        parentType: 'Liquidation',
        parentNumber: liqNo,
        receipt_url: item.receipt_url || '',
        or_number: item.or_number || '',
        vendor: item.vendor || 'Unknown Vendor',
        amount: item.amount,
        expense_date: item.expense_date,
        category: item.category,
        business_purpose: item.business_purpose || '',
        requestor_name: reqUser ? reqUser.name : 'Unknown',
        requestor_department: reqUser ? reqUser.department : 'Unknown',
      });
    }

    // Sort by expense date descending
    flatReceipts.sort((a, b) => new Date(b.expense_date).getTime() - new Date(a.expense_date).getTime());

    res.json(flatReceipts);
  });

  app.post('/api/moms', async (req, res) => {
    const user = getUser(req);
    if (!user || !user.reports_to) return res.status(403).json({ error: 'Forbidden: You must have a designated manager (reports_to) to submit.' });

    const mom: Mom = {
      id: uuidv4(),
      requestor_id: user.id,
      document_type: req.body.document_type === 'LOA' ? 'LOA' : 'MoM',
      client: req.body.client || '',
      contact_person: req.body.contact_person || '',
      contact_person_email: req.body.contact_person_email || '',
      cc_client: Boolean(req.body.cc_client),
      meeting_date: req.body.meeting_date || new Date().toISOString().split('T')[0],
      meeting_time: req.body.meeting_time || '',
      location: req.body.location || '',
      purpose: req.body.purpose || '',
      discussion: req.body.discussion || '',
      agreements: req.body.agreements || '',
      action_items: req.body.action_items || '',
      prepared_by: user.name,
      // Smart defaults (Phase 3 MDM) — the logged-in user's department/job
      // title are already known, so there's no reason to ask them again.
      prepared_by_department: user.department,
      prepared_by_job_title: user.job_title,
      file_url: req.body.file_url,
      file_name: req.body.file_name,
      status: req.body.status || MomStatus.DRAFT,
      created_at: new Date().toISOString(),
      minutes_source: req.body.minutes_source || MinutesSource.TEMPLATE,
      meeting_type: req.body.meeting_type || '',
      participants_internal: req.body.participants_internal || '',
      participants_external: req.body.participants_external || '',
      custom_fields: req.body.custom_fields || undefined
    };

    await getOrCreateCompany(mom.client, user.id);
    moms.push(mom);
    try {
      await persistMom(mom);
    } catch (err) {
      console.error('[db] Could not persist new MOM to Postgres:', err);
    }
    res.json(mom);
  });

  app.put('/api/moms/:id', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const mom = moms.find(m => m.id === req.params.id);
    if (!mom) return res.status(404).json({ error: 'MOM not found' });

    if (user.role === UserRole.REQUESTOR && mom.requestor_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (user.role === UserRole.APPROVER && mom.requestor_id !== user.id) {
      const momOwner = users.find(u => u.id === mom.requestor_id);
      let authorized = !!momOwner && momOwner.reports_to === user.id;
      if (!authorized && momOwner?.reports_to) {
        const activeDelegation = getActiveDelegation(momOwner.reports_to);
        authorized = activeDelegation?.delegate_id === user.id;
      }
      if (!authorized) {
        return res.status(403).json({ error: 'Forbidden: not your direct report' });
      }
    }

    mom.client = req.body.client ?? mom.client;
    await getOrCreateCompany(mom.client, user.id);
    mom.contact_person = req.body.contact_person ?? mom.contact_person;
    mom.contact_person_email = req.body.contact_person_email ?? mom.contact_person_email;
    mom.cc_client = req.body.cc_client ?? mom.cc_client;
    mom.meeting_date = req.body.meeting_date ?? mom.meeting_date;
    mom.meeting_time = req.body.meeting_time ?? mom.meeting_time;
    mom.location = req.body.location ?? mom.location;
    mom.purpose = req.body.purpose ?? mom.purpose;
    mom.discussion = req.body.discussion ?? mom.discussion;
    mom.agreements = req.body.agreements ?? mom.agreements;
    mom.action_items = req.body.action_items ?? mom.action_items;
    mom.status = req.body.status ?? mom.status;
    mom.file_url = req.body.file_url ?? mom.file_url;
    mom.file_name = req.body.file_name ?? mom.file_name;
    mom.meeting_type = req.body.meeting_type ?? mom.meeting_type;
    mom.participants_internal = req.body.participants_internal ?? mom.participants_internal;
    mom.participants_external = req.body.participants_external ?? mom.participants_external;
    mom.custom_fields = req.body.custom_fields ?? mom.custom_fields;

    try {
      await persistMom(mom);
    } catch (err) {
      console.error('[db] Could not persist MOM changes to Postgres:', err);
    }
    res.json(mom);
  });

  app.post('/api/moms/:id/send', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const mom = moms.find(m => m.id === req.params.id && m.requestor_id === user.id);
    if (!mom) return res.status(404).json({ error: 'MOM not found' });

    // Finalizing (Draft -> Completed) is the actual "submit" moment for a MOM
    // in every current flow (both MomQuickCreateModal and Moms.tsx always
    // POST as Draft first, then call this route) — so required dynamic
    // fields are enforced here, not on the earlier POST/PUT.
    const customFieldError = validateRequiredCustomFields('mom', mom.custom_fields);
    if (customFieldError) return res.status(400).json({ error: customFieldError });

    mom.status = MomStatus.COMPLETED;

    // Send MOM email - 1. MOM Email (To: Contact Person, CC: Approver)
    const approverId = user.reports_to || '';
    const subject = `Meeting Summary - ${mom.client || 'Client'}`;
    const body = `Thank you for meeting with us on ${mom.meeting_date} regarding ${mom.purpose || 'our business discussion'}.

Discussion:
${mom.discussion || 'No discussion points added.'}

Agreements:
${mom.agreements || 'No agreements listed.'}

Action Items:
${mom.action_items || 'No action items listed.'}

Best regards,
${user.name}`;

    sendEmail(
      mom.contact_person_email || 'client@mgenesis.com',
      subject,
      body,
      approverId || undefined,
      { plain: true, recipientName: mom.contact_person || 'Valued Client', fromLabel: `${user.name} <${user.email}>` }
    );

    try {
      await persistMom(mom);
    } catch (err) {
      console.error('[db] Could not persist MOM changes to Postgres:', err);
    }
    res.json(mom);
  });

  // Claim endpoints
  app.get('/api/claims', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    let filtered: Claim[] = [];
    if (user.role === UserRole.REQUESTOR) {
      filtered = claims.filter(c => c.requestor_id === user.id);
    } else if (user.role === UserRole.APPROVER) {
      filtered = claims.filter(c => c.current_approver_id === user.id || c.original_approver_id === user.id || c.requestor_id === user.id || isActiveDelegateFor(user.id, c.current_approver_id));
    } else if (user.role === UserRole.CUSTODIAN) {
      // APPROVED is included so the custodian can see (and review) a claim the
      // moment an approver clears it — otherwise it's invisible to them until
      // it reaches PROCESSING, and the review-before-processing step in
      // ProcessingQueue.tsx would never be reachable in practice.
      filtered = claims.filter(c => [ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED].includes(c.status) || c.requestor_id === user.id);
    } else if (user.role === UserRole.FINANCE) {
      filtered = claims.filter(c => isFinanceVisibleFinancialRecord(c.claim_type || 'Reimbursement', c.status));
    } else if (user.role === UserRole.ADMIN) {
      filtered = claims; // Admin sees all
    }

    const enriched = filtered.map(c => {
      const mom = moms.find(m => m.id === c.mom_id);
      const reqUser = users.find(u => u.id === c.requestor_id);
      const claimExpenses = expenses.filter(e => e.claim_id === c.id);
      const claimApprovals = approvals.filter(a => a.claim_id === c.id);
      const claimHistory = statusHistories.filter(h => h.claim_id === c.id).map(h => ({
        ...h,
        changedBy: users.find(u => u.id === h.changed_by)
      })).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const reviewMeeting = reviewMeetings.find(rm => rm.claim_id === c.id);
      return { ...c, mom, requestor: reqUser, expenses: claimExpenses, approvals: claimApprovals, history: claimHistory, reviewMeeting };
    });

    const { page, pageSize, search, status } = req.query;

    let scoped = enriched;
    if (typeof status === 'string' && status.trim()) {
      scoped = scoped.filter(c => c.status === status);
    }
    if (typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      scoped = scoped.filter((c: any) =>
        [c.claim_number, c.mom?.purpose].some(v => (v || '').toString().toLowerCase().includes(q))
      );
    }

    // loadWorkspace (dashboards, KPIs, the claims-into-context merge) needs the
    // full list and never sends page/pageSize — this stays exactly as before
    // for that caller. Only a caller that opts in gets the paginated shape.
    if (page && pageSize) {
      const p = Math.max(1, parseInt(page as string, 10) || 1);
      const ps = Math.max(1, parseInt(pageSize as string, 10) || 25);
      const total = scoped.length;
      const items = scoped
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice((p - 1) * ps, p * ps);
      return res.json({ items, total, page: p, pageSize: ps });
    }

    res.json(enriched);
  });

  app.get('/api/claims/:id', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Not found' });

    // Mirror the scoping already applied by GET /api/claims - the list endpoint
    // was correctly scoped but this single-record lookup was not, allowing any
    // authenticated user to read any claim by id.
    if (!canAccessClaim(user, claim)) return res.status(403).json({ error: 'Forbidden' });

    const claimExpenses = expenses.filter(e => e.claim_id === claim.id);
    const claimApprovals = approvals.filter(a => a.claim_id === claim.id);
    const claimHistory = statusHistories.filter(h => h.claim_id === claim.id).map(h => ({      ...h,      changedBy: users.find(u => u.id === h.changed_by)    })).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const mom = moms.find(m => m.id === claim.mom_id);
    const requestor = users.find(u => u.id === claim.requestor_id);
    const reviewMeeting = reviewMeetings.find(rm => rm.claim_id === claim.id);

    res.json({
      ...claim,
      expenses: claimExpenses,
      approvals: claimApprovals,
      history: claimHistory,
      mom,
      requestor,
      reviewMeeting
    });
  });

  app.post('/api/claims', async (req, res) => {
    const user = getUser(req);
    if (!user || !user.reports_to) return res.status(403).json({ error: 'Forbidden: You must have a designated manager (reports_to) to submit.' });
    
    const { claim_type, mom_id, expense_category, total_amount, receipt_url, or_number, expense_date, remarks, supporting_documents, line_items, is_draft } = req.body;
    const claimType = claim_type === 'Transport Reimbursement' ? 'Transport Reimbursement' : 'Reimbursement';
    const isTransportReimbursement = claimType === 'Transport Reimbursement';

    if (!isTransportReimbursement && !mom_id) {
      return res.status(400).json({ error: 'Minutes of Meeting (MOM) is required.' });
    }
    const mom = mom_id ? moms.find(m => m.id === mom_id) : undefined;
    if (mom_id && !mom) return res.status(400).json({ error: 'Minutes of Meeting (MOM) not found.' });

    if (!is_draft && mom && mom.status !== MomStatus.COMPLETED) {
      return res.status(400).json({ error: 'Cannot attach an incomplete or draft Minutes of Meeting.' });
    }
    if (mom?.claim_id) {
      return res.status(400).json({ error: 'This Minutes of Meeting is already linked to another claim and cannot be reused.' });
    }

    let itemsToCreate: any[] = [];
    let claimTotal = 0;
    let mainCategory = normalizeExpenseCategory(expense_category || 'Multiple Categories');
    let mainReceipt = receipt_url || '';

    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      for (const [index, item] of line_items.entries()) {
        if (!is_draft && !item.category) return res.status(400).json({ error: 'Each expense must have a category.' });
        const numericAmount = Number(item.amount);
        if (isNaN(numericAmount) || numericAmount <= 0) return res.status(400).json({ error: 'Each expense amount must be a valid number greater than zero.' });
        if (!item.receipt_url) return res.status(400).json({ error: 'Each expense must have a receipt.' });
        if (!is_draft) {
          const dateError = getReimbursementDateError(item.expense_date, getTodayIsoDate());
          if (dateError) return res.status(400).json({ error: `Expense row ${index + 1}: ${dateError}` });
        }
        
        itemsToCreate.push({
          category: normalizeExpenseCategory(item.category),
          amount: numericAmount,
          receipt_url: item.receipt_url,
          or_number: item.or_number,
          // Preserve the per-row detail the requestor entered; fall back to the
          // meeting-derived values only when a field wasn't provided.
          vendor: item.vendor,
          expense_date: item.expense_date,
          payment_method: item.payment_method,
          business_purpose: item.business_purpose || remarks ||
            (isTransportReimbursement ? 'Business transport reimbursement' : `Sales reimbursement for meeting with ${mom?.client || 'client'}`)
        });
        claimTotal += numericAmount;
      }
      mainCategory = itemsToCreate.length === 1 ? itemsToCreate[0].category : 'Multiple Categories';
      mainReceipt = itemsToCreate[0].receipt_url;
    } else {
      if (!is_draft) {
        const dateError = getReimbursementDateError(expense_date, getTodayIsoDate());
        if (dateError) return res.status(400).json({ error: dateError });
      }
      if (!expense_category) return res.status(400).json({ error: 'Expense Category is required.' });
      if (total_amount === undefined || total_amount === null || total_amount === '') {
        return res.status(400).json({ error: 'Expense amount is required.' });
      }
      const numericAmount = Number(total_amount);
      if (isNaN(numericAmount)) {
        return res.status(400).json({ error: 'Expense amount must be a valid number.' });
      }
      if (numericAmount <= 0) {
        return res.status(400).json({ error: 'Expense amount must be greater than zero.' });
      }
      if (!receipt_url) return res.status(400).json({ error: 'Receipt image or PDF is required.' });
      
      itemsToCreate.push({
        category: normalizeExpenseCategory(expense_category),
        amount: numericAmount,
        receipt_url: receipt_url,
        or_number: or_number,
        expense_date,
        business_purpose: remarks ||
          (isTransportReimbursement ? 'Business transport reimbursement' : `Sales reimbursement for meeting with ${mom?.client || 'client'}`)
      });
      claimTotal = numericAmount;
      mainCategory = normalizeExpenseCategory(expense_category);
      mainReceipt = receipt_url;
    }

    // Company spending policy — enforce per-category caps on a real submission.
    // Drafts are allowed to hold over-cap lines so the requestor can save and fix.
    if (!is_draft) {
      const policyError = checkCategoryLimits(itemsToCreate);
      if (policyError) return res.status(400).json({ error: policyError });
    }

    const claimId = uuidv4();

    // Generate Philippine format Claim Number (e.g. REIM-2026-000123)
    const claimNumber = await generateClaimNumber();

    // Create compatible expense items
    for (const item of itemsToCreate) {
      expenses.push({
        id: uuidv4(),
        claim_id: claimId,
        expense_date: item.expense_date || mom?.meeting_date || new Date().toISOString().split('T')[0],
        vendor: item.vendor || mom?.client || (isTransportReimbursement ? 'Transport Provider' : 'Client Meeting'),
        category: item.category,
        amount: item.amount,
        payment_method: item.payment_method || 'Cash',
        business_purpose: item.business_purpose,
        receipt_url: item.receipt_url,
        or_number: item.or_number
      });
    }

    let originalApproverId: string | undefined = undefined;
    let currentApproverId = user.reports_to || '';
    
    if (user.reports_to) {
      const activeDelegation = getActiveDelegation(user.reports_to);
      if (activeDelegation) {
        originalApproverId = user.reports_to;
        currentApproverId = activeDelegation.delegate_id;
      }
    }

    const claim: Claim = {
      id: claimId,
      claim_number: claimNumber,
      requestor_id: user.id,
      current_approver_id: currentApproverId,
      original_approver_id: originalApproverId,
      mom_id: mom_id || undefined,
      claim_type: claimType,
      status: is_draft ? ClaimStatus.DRAFT : ClaimStatus.PENDING_APPROVAL,
      total_amount: claimTotal,
      expense_category: mainCategory,
      receipt_url: mainReceipt,
      remarks,
      supporting_documents,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      flagged_high_value: itemsToCreate.some(item => item.amount > systemSettings.highValueThreshold)
    };

    claims.push(claim);
    if (mom) mom.claim_id = claimId; // link MOM to claim

    // Order matters: the claim row must exist before addHistory's
    // fire-and-forget insert (status_histories.claim_id FKs to it), and
    // before persisting the mom (moms.claim_id FKs to claims.id too). All
    // three writes go through one transaction so a mid-sequence failure
    // can't leave the claim committed without its expenses (or vice versa).
    try {
      await persistClaimWithLineItems(claim, expenses.filter(e => e.claim_id === claim.id), mom ? [mom] : []);
    } catch (err) {
      console.error('[db] Could not persist new claim to Postgres:', err);
    }

    addHistory(
      claim.id,
      ClaimStatus.DRAFT,
      claim.status,
      user.id,
      is_draft ? 'Draft saved by requestor' : `${claimType} filed and received by the system`
    );
    
    if (!is_draft && originalApproverId && currentApproverId !== originalApproverId) {
      const origName = users.find(u => u.id === originalApproverId)?.name || originalApproverId;
      const delegateName = users.find(u => u.id === currentApproverId)?.name || currentApproverId;
      
      statusHistories.push({
        id: uuidv4(),
        claim_id: claim.id,
        old_status: ClaimStatus.DRAFT,
        new_status: ClaimStatus.PENDING_APPROVAL,
        changed_by: user.id,
        reason: `Auto-routed to delegate ${delegateName} (on behalf of ${origName})`,
        timestamp: new Date().toISOString()
      });
    }
    
    if (!is_draft && currentApproverId) {
      const approver = users.find(u => u.id === currentApproverId);
      const approverName = approver ? approver.name : 'Approver';

      const emailSubject = `${claimType} Submitted - ${claimNumber}`;
      const emailBody = `A new ${claimType.toLowerCase()} request ${claimNumber} by ${user.name} has been submitted and is awaiting your review and approval.

Reference:
${claimNumber}

Required Action:
Please log in to the system and navigate to the Approval Queue to approve or reject this claim.`;

      sendEmail(currentApproverId, emailSubject, emailBody, undefined, { eventKey: 'submitted' });

      sendEmail(
        user.id,
        `${claimType} Submitted - ${claimNumber}`,
        `Your ${claimType.toLowerCase()} request ${claimNumber} for PHP ${claimTotal} has been successfully submitted and routed to ${approverName} for review.

Reference:
${claimNumber}

You'll receive another email as soon as ${approverName} makes a decision.`,
        undefined,
        { eventKey: 'submitted' }
       );

      if (mom?.cc_client && mom.contact_person_email) {
        sendEmail(
          mom.contact_person_email,
          `Copy: ${claimType} Submitted - ${claimNumber}`,
          `${user.name} submitted ${claimNumber}, which references the meeting with ${mom.client || 'your organization'}. This is a courtesy copy requested by the filer.`,
          undefined,
          { plain: true, recipientName: mom.contact_person || undefined, fromLabel: `${user.name} via Sales Reimbursement System` }
        );
        notifyClientCcSent({
          recipientIds: [user.id, currentApproverId],
          claimNumber,
          clientName: mom.contact_person,
          clientEmail: mom.contact_person_email,
          eventLabel: 'Submission',
        });
      }
    }

    res.json(claim);
  });

  // Review Meetings: internal review calls an Approver may schedule when
  // returning or rejecting a claim. Separate from the MOM's client meeting date -
  // filtered the same way /api/moms is (Requestor: own; Approver: own + direct
  // reports') so the Calendar can plot both without conflating them.
  app.get('/api/review-meetings', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    let relevant: ReviewMeeting[] = [];
    if (user.role === UserRole.REQUESTOR) {
      relevant = reviewMeetings.filter(rm => rm.requestor_id === user.id);
    } else if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      relevant = reviewMeetings.filter(rm => rm.requestor_id === user.id || reporteeIds.includes(rm.requestor_id));
    } else if (user.role === UserRole.ADMIN) {
      relevant = reviewMeetings;
    }

    const enriched = relevant.map(rm => {
      const requestor = users.find(u => u.id === rm.requestor_id);
      const approver = users.find(u => u.id === rm.approver_id);
      const claim = claims.find(c => c.id === rm.claim_id);
      return {
        ...rm,
        requestor_name: requestor?.name || 'Unknown',
        approver_name: approver?.name || 'Unknown',
        claim_number: claim?.claim_number,
        total_amount: claim?.total_amount
      };
    });

    res.json(enriched);
  });

  // Shared by confirm/decline: a Review Meeting can be acted on by its
  // assigned approver_id, or by whoever they've actively delegated to right
  // now - the same dynamic delegation check already used for MOM PUT access.
  const isAuthorizedForReviewMeeting = (rm: ReviewMeeting, user: User): boolean => {
    if (rm.approver_id === user.id) return true;
    return getActiveDelegation(rm.approver_id)?.delegate_id === user.id;
  };

  // Approver (or active delegate) confirms a proposed Review Meeting time.
  app.post('/api/review-meetings/:id/confirm', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const rm = reviewMeetings.find(r => r.id === req.params.id);
    if (!rm) return res.status(404).json({ error: 'Review Meeting not found' });
    if (!isAuthorizedForReviewMeeting(rm, user)) {
      return res.status(403).json({ error: 'Forbidden: not your assigned Review Meeting' });
    }
    if (rm.status !== ReviewMeetingStatus.PENDING_CONFIRMATION) {
      return res.status(400).json({ error: 'Only a meeting pending confirmation can be confirmed.' });
    }

    rm.status = ReviewMeetingStatus.CONFIRMED;
    rm.decline_reason = undefined;

    const requestor = users.find(u => u.id === rm.requestor_id);
    const claim = claims.find(c => c.id === rm.claim_id);
    const claimNumber = claim?.claim_number || `REIM-${rm.claim_id.substring(0, 6)}`;

    sendEmail(
      rm.requestor_id,
      `Review Meeting Confirmed - ${claimNumber}`,
      `${user.name} has confirmed your proposed Review Meeting for claim ${claimNumber} on ${rm.meeting_date} at ${rm.meeting_time}.

Reference:
${claimNumber}`
    );

    try {
      await persistReviewMeeting(rm);
    } catch (err) {
      console.error('[db] Could not persist review meeting confirmation to Postgres:', err);
    }
    res.json(rm);
  });

  // Approver (or active delegate) declines a proposed Review Meeting time,
  // optionally with a reason. The Requestor must propose a new time via
  // PUT /api/review-meetings/:id/reschedule before the meeting can move
  // forward again.
  app.post('/api/review-meetings/:id/decline', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const rm = reviewMeetings.find(r => r.id === req.params.id);
    if (!rm) return res.status(404).json({ error: 'Review Meeting not found' });
    if (!isAuthorizedForReviewMeeting(rm, user)) {
      return res.status(403).json({ error: 'Forbidden: not your assigned Review Meeting' });
    }
    if (rm.status !== ReviewMeetingStatus.PENDING_CONFIRMATION) {
      return res.status(400).json({ error: 'Only a meeting pending confirmation can be declined.' });
    }

    const { reason } = req.body;
    rm.status = ReviewMeetingStatus.DECLINE_REQUESTED;
    rm.decline_reason = reason || undefined;

    const claim = claims.find(c => c.id === rm.claim_id);
    const claimNumber = claim?.claim_number || `REIM-${rm.claim_id.substring(0, 6)}`;

    sendEmail(
      rm.requestor_id,
      `Review Meeting Declined - ${claimNumber}`,
      `${user.name} can't make the proposed Review Meeting for claim ${claimNumber} on ${rm.meeting_date} at ${rm.meeting_time}.
${reason ? `\nReason:\n${reason}\n` : ''}
Required Action:
Please log in to the system and propose a new date/time for this Review Meeting.`
    );

    try {
      await persistReviewMeeting(rm);
    } catch (err) {
      console.error('[db] Could not persist review meeting decline to Postgres:', err);
    }
    res.json(rm);
  });

  // Requestor proposes a new date/time for their own Review Meeting - reused
  // after a decline (or any time before the meeting is Completed), re-opening
  // the same pending-confirmation cycle rather than a separate claim step.
  app.put('/api/review-meetings/:id/reschedule', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const rm = reviewMeetings.find(r => r.id === req.params.id && r.requestor_id === user.id);
    if (!rm) return res.status(404).json({ error: 'Review Meeting not found' });
    if (rm.status === ReviewMeetingStatus.COMPLETED) {
      return res.status(400).json({ error: 'This Review Meeting has already been completed.' });
    }

    const { meeting_date, meeting_time } = req.body;
    if (!meeting_date || !meeting_time) {
      return res.status(400).json({ error: 'A new meeting date and time are required.' });
    }

    const hasConflict = reviewMeetings.some(other =>
      other.id !== rm.id &&
      other.approver_id === rm.approver_id &&
      [ReviewMeetingStatus.PENDING_CONFIRMATION, ReviewMeetingStatus.CONFIRMED].includes(other.status) &&
      other.meeting_date === meeting_date &&
      other.meeting_time === meeting_time
    );
    if (hasConflict) {
      return res.status(409).json({ error: 'Your Approver already has a Review Meeting scheduled at that date and time. Please choose another slot.' });
    }

    rm.meeting_date = meeting_date;
    rm.meeting_time = meeting_time;
    rm.status = ReviewMeetingStatus.PENDING_CONFIRMATION;
    rm.decline_reason = undefined;

    const claim = claims.find(c => c.id === rm.claim_id);
    const claimNumber = claim?.claim_number || `REIM-${rm.claim_id.substring(0, 6)}`;

    sendEmail(
      rm.approver_id,
      `Review Meeting Rescheduled - ${claimNumber}`,
      `${user.name} has proposed a new time for the Review Meeting on claim ${claimNumber}: ${meeting_date} at ${meeting_time}.

Required Action:
Please log in to the system and confirm or decline this new time.`
    );

    try {
      await persistReviewMeeting(rm);
    } catch (err) {
      console.error('[db] Could not persist review meeting reschedule to Postgres:', err);
    }
    res.json(rm);
  });

  // Revise & Resubmit: a Requestor reopens their own Returned claim, edits
  // it, and sends it back to Pending Approval with a fresh Approval record.
  // The prior "Returned" decision and status-history entry are never
  // touched - this only ever appends new rows.
  app.put('/api/claims/:id/resubmit', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const claim = claims.find(c => c.id === req.params.id && c.requestor_id === user.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.status !== ClaimStatus.RETURNED) {
      return res.status(400).json({ error: 'Only a claim that has been Returned can be revised and resubmitted.' });
    }

    const { mom_id, claim_type, expense_category, total_amount, receipt_url, or_number, expense_date, remarks, supporting_documents, line_items } = req.body;
    const claimType = claim_type === 'Transport Reimbursement' || claim.claim_type === 'Transport Reimbursement'
      ? 'Transport Reimbursement'
      : 'Reimbursement';
    const isTransportReimbursement = claimType === 'Transport Reimbursement';

    if (!isTransportReimbursement && !mom_id) return res.status(400).json({ error: 'Minutes of Meeting (MOM) is required.' });
    const mom = mom_id ? moms.find(m => m.id === mom_id) : undefined;
    if (mom_id && !mom) return res.status(400).json({ error: 'Minutes of Meeting (MOM) not found.' });
    if (mom && mom.status !== MomStatus.COMPLETED) {
      return res.status(400).json({ error: 'Cannot attach an incomplete or draft Minutes of Meeting.' });
    }
    if (mom?.claim_id && mom.claim_id !== claim.id) {
      const linkedClaim = claims.find(c => c.id === mom.claim_id);
      const linkedNumber = linkedClaim?.claim_number || (mom.claim_id ? `REIM-${mom.claim_id.substring(0, 6)}` : 'another claim');
      return res.status(400).json({ error: `This MOM is already linked to claim ${linkedNumber}.` });
    }

    let itemsToCreate: any[] = [];
    let claimTotal = 0;
    let mainCategory = normalizeExpenseCategory(expense_category || 'Multiple Categories');
    let mainReceipt = receipt_url || '';

    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      for (const [index, item] of line_items.entries()) {
        if (!item.category) return res.status(400).json({ error: 'Each expense must have a category.' });
        const numericAmount = Number(item.amount);
        if (isNaN(numericAmount) || numericAmount <= 0) return res.status(400).json({ error: 'Each expense amount must be a valid number greater than zero.' });
        if (!item.receipt_url) return res.status(400).json({ error: 'Each expense must have a receipt.' });
        const dateError = getReimbursementDateError(item.expense_date, getTodayIsoDate());
        if (dateError) return res.status(400).json({ error: `Expense row ${index + 1}: ${dateError}` });
        
        itemsToCreate.push({
          category: normalizeExpenseCategory(item.category),
          amount: numericAmount,
          receipt_url: item.receipt_url,
          or_number: item.or_number,
          // Preserve the per-row detail the requestor entered; fall back to the
          // meeting-derived values only when a field wasn't provided.
          vendor: item.vendor,
          expense_date: item.expense_date,
          payment_method: item.payment_method,
          business_purpose: item.business_purpose || remarks ||
            (isTransportReimbursement ? 'Business transport reimbursement' : `Sales reimbursement for meeting with ${mom?.client || 'client'}`)
        });
        claimTotal += numericAmount;
      }
      mainCategory = itemsToCreate.length === 1 ? itemsToCreate[0].category : 'Multiple Categories';
      mainReceipt = itemsToCreate[0].receipt_url;
    } else {
      const dateError = getReimbursementDateError(expense_date, getTodayIsoDate());
      if (dateError) return res.status(400).json({ error: dateError });
      if (!expense_category) return res.status(400).json({ error: 'Expense Category is required.' });
      if (total_amount === undefined || total_amount === null || total_amount === '') {
        return res.status(400).json({ error: 'Expense amount is required.' });
      }
      const numericAmount = Number(total_amount);
      if (isNaN(numericAmount)) {
        return res.status(400).json({ error: 'Expense amount must be a valid number.' });
      }
      if (numericAmount <= 0) {
        return res.status(400).json({ error: 'Expense amount must be greater than zero.' });
      }
      if (!receipt_url) return res.status(400).json({ error: 'Receipt image or PDF is required.' });
      
      itemsToCreate.push({
        category: normalizeExpenseCategory(expense_category),
        amount: numericAmount,
        receipt_url: receipt_url,
        or_number: or_number,
        expense_date,
        business_purpose: remarks ||
          (isTransportReimbursement ? 'Business transport reimbursement' : `Sales reimbursement for meeting with ${mom?.client || 'client'}`)
      });
      claimTotal = numericAmount;
      mainCategory = normalizeExpenseCategory(expense_category);
      mainReceipt = receipt_url;
    }

    // Company spending policy — a resubmit is always a real submission.
    const policyError = checkCategoryLimits(itemsToCreate);
    if (policyError) return res.status(400).json({ error: policyError });

    // Re-link the MOM if the requestor swapped it out for a different one.
    let unlinkedOldMom: Mom | undefined;
    if (claim.mom_id !== mom_id) {
      unlinkedOldMom = moms.find(m => m.id === claim.mom_id);
      if (unlinkedOldMom) unlinkedOldMom.claim_id = undefined;
    }
    if (mom) mom.claim_id = claim.id;

    // Remove old expenses and add new ones
    for (let i = expenses.length - 1; i >= 0; i--) {
      if (expenses[i].claim_id === claim.id) {
        expenses.splice(i, 1);
      }
    }
    for (const item of itemsToCreate) {
      expenses.push({
        id: uuidv4(),
        claim_id: claim.id,
        expense_date: item.expense_date || mom?.meeting_date || new Date().toISOString().split('T')[0],
        vendor: item.vendor || mom?.client || (isTransportReimbursement ? 'Transport Provider' : 'Client Meeting'),
        category: item.category,
        amount: item.amount,
        payment_method: item.payment_method || 'Cash',
        business_purpose: item.business_purpose,
        receipt_url: item.receipt_url,
        or_number: item.or_number
      });
    }

    const oldStatus = claim.status;
    claim.mom_id = mom_id || undefined;
    claim.claim_type = claimType;
    claim.expense_category = mainCategory;
    claim.total_amount = claimTotal;
    claim.approved_amount = undefined;
    claim.paid_amount = undefined;
    claim.approved_at = undefined;
    claim.paid_at = undefined;
    claim.receipt_url = mainReceipt;
    claim.remarks = remarks;
    claim.supporting_documents = supporting_documents;
    claim.status = ClaimStatus.PENDING_APPROVAL;
    claim.updated_at = new Date().toISOString();
    claim.flagged_high_value = itemsToCreate.some(item => item.amount > systemSettings.highValueThreshold);

    addHistory(claim.id, oldStatus, ClaimStatus.PENDING_APPROVAL, user.id, 'Revised and resubmitted by requestor after being returned');

    const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0, 6)}`;

    if (claim.current_approver_id) {
      const approverName = users.find(u => u.id === claim.current_approver_id)?.name || 'Approver';

      const emailSubject = `Reimbursement Resubmitted - ${claimNumber}`;
      const emailBody = `A previously returned reimbursement request ${claimNumber} by ${user.name} has been revised and resubmitted, and is awaiting your review and approval.

Reference:
${claimNumber}

Required Action:
Please log in to the system and navigate to the Approval Queue to approve or reject this claim.`;
      sendEmail(claim.current_approver_id, emailSubject, emailBody, undefined, { eventKey: 'submitted' });

      sendEmail(
        user.id,
        `Reimbursement Resubmitted - ${claimNumber}`,
        `Your revised reimbursement claim ${claimNumber} has been successfully resubmitted and routed to ${approverName} for review.

Reference:
${claimNumber}

You'll receive another email as soon as ${approverName} makes a decision.`,
        undefined,
        { eventKey: 'submitted' }
      );
    }

    try {
      const momsToBackfill = [unlinkedOldMom, mom].filter((m): m is NonNullable<typeof m> => !!m);
      await persistClaimWithLineItems(claim, expenses.filter(e => e.claim_id === claim.id), momsToBackfill);
    } catch (err) {
      console.error('[db] Could not persist resubmitted claim to Postgres:', err);
    }
    res.json(claim);
  });

  app.get('/api/approver/schedule', (req, res) => {
    const user = getUser(req);
    if (!user || !user.reports_to) return res.json([]);
    
    // Resolve who the actual approver is right now based on delegation
    let currentApproverId = user.reports_to;
    const activeDelegation = getActiveDelegation(user.reports_to);
    if (activeDelegation) {
      currentApproverId = activeDelegation.delegate_id;
    }
    
    // Find claims currently assigned to that approver
    const relevantClaims = claims.filter(c => c.current_approver_id === currentApproverId);
    const relevantClaimIds = relevantClaims.map(c => c.id);
    const relevantMoms = moms.filter(m => m.claim_id && relevantClaimIds.includes(m.claim_id));

    res.json(relevantMoms);
  });

  // Lets a Requestor check their resolved Approver's existing Review Meeting
  // slots (date/time only, not full detail) before picking a time in the
  // Submit Claim wizard, so a conflict can be flagged client-side pre-submit.
  app.get('/api/approver/review-meetings', (req, res) => {
    const user = getUser(req);
    if (!user || !user.reports_to) return res.json([]);

    let currentApproverId = user.reports_to;
    const activeDelegation = getActiveDelegation(user.reports_to);
    if (activeDelegation) {
      currentApproverId = activeDelegation.delegate_id;
    }

    const relevant = reviewMeetings.filter(rm => rm.approver_id === currentApproverId && [ReviewMeetingStatus.PENDING_CONFIRMATION, ReviewMeetingStatus.CONFIRMED].includes(rm.status));
    res.json(relevant.map(rm => ({ meeting_date: rm.meeting_date, meeting_time: rm.meeting_time })));
  });

  app.post('/api/claims/:id/approve', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Not found' });

    // Segregation of duties: Requestors cannot approve their own claims
    if (claim.requestor_id === user.id) {
      return res.status(403).json({ error: 'Segregation of Duties: You cannot approve your own reimbursement claim.' });
    }

    // docs/hierarchy-sync-design.md §8: authorization is claim-scoped, not
    // role-scoped — a user who's lost approval authority elsewhere in the org
    // (e.g. demoted, no longer has direct reports) can still finish claims
    // already assigned to them here.
    const requestor = users.find(u => u.id === claim.requestor_id);
    if (
      claim.current_approver_id !== user.id &&
      claim.original_approver_id !== user.id &&
      !isActiveDelegateFor(user.id, claim.current_approver_id)
    ) {
      return res.status(403).json({ error: 'Not your direct report' });
    }

    // Workflow guard: an approval decision is only valid while the claim is
    // awaiting one. Reimbursements enter the queue as Pending Approval and leave
    // it the moment a decision is recorded, so any other status here means a
    // replay or an out-of-order API call (e.g. re-approving a completed or
    // already-rejected claim). See docs/SYSTEM-AUDIT-2026-08-03.md.
    if (claim.status !== ClaimStatus.PENDING_APPROVAL) {
      return res.status(409).json({ error: `This claim is "${claim.status}" and is no longer awaiting an approval decision.` });
    }

    const { decision, comment, review_meeting_date, review_meeting_time } = req.body; // Approved, Rejected, Returned
    if (!['Approved', 'Rejected', 'Returned'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
    if ((decision === 'Rejected' || decision === 'Returned') && !comment) {
      return res.status(400).json({ error: 'Comment required' });
    }
    if (Boolean(review_meeting_date) !== Boolean(review_meeting_time)) {
      return res.status(400).json({ error: 'Provide both a review meeting date and time, or leave both blank.' });
    }
    if (review_meeting_date && decision === 'Approved') {
      return res.status(400).json({ error: 'A review meeting can only be scheduled when returning or rejecting a claim.' });
    }
    if (review_meeting_date) {
      const hasConflict = reviewMeetings.some(rm =>
        rm.approver_id === user.id &&
        [ReviewMeetingStatus.PENDING_CONFIRMATION, ReviewMeetingStatus.CONFIRMED].includes(rm.status) &&
        rm.meeting_date === review_meeting_date &&
        rm.meeting_time === review_meeting_time
      );
      if (hasConflict) {
        return res.status(409).json({ error: 'You already have a review meeting scheduled at that date and time.' });
      }
    }
    
    const oldStatus = claim.status;
    let newStatus: ClaimStatus = claim.status;

    if (decision === 'Approved') newStatus = ClaimStatus.PROCESSING;
    else if (decision === 'Rejected') newStatus = ClaimStatus.REJECTED;
    else if (decision === 'Returned') newStatus = ClaimStatus.RETURNED;
    
    claim.status = newStatus;
    claim.updated_at = new Date().toISOString();
    
    
    const newApproval: Approval = {
      id: uuidv4(),
      claim_id: claim.id,
      approver_id: user.id,
      decision,
      comment: comment || '',
      timestamp: new Date().toISOString()
    };
    approvals.push(newApproval);

    addHistory(claim.id, oldStatus, newStatus, user.id, comment || undefined);

    let newReviewMeeting: ReviewMeeting | undefined;
    if (review_meeting_date && review_meeting_time) {
      newReviewMeeting = {
        id: uuidv4(),
        claim_id: claim.id,
        requestor_id: claim.requestor_id,
        approver_id: user.id,
        meeting_date: review_meeting_date,
        meeting_time: review_meeting_time,
        status: ReviewMeetingStatus.CONFIRMED,
        created_at: new Date().toISOString()
      };
      reviewMeetings.push(newReviewMeeting);
      addHistory(
        claim.id,
        newStatus,
        newStatus,
        user.id,
        `Review meeting scheduled for ${review_meeting_date} at ${review_meeting_time}`
      );
    }
    
    const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0,6)}`;

    if (decision === 'Approved') {
      claim.approved_at = new Date().toISOString();
      claim.approved_amount = Math.min(claim.total_amount, REIMBURSEMENT_CAP);

      // Email Notification 3: Approved (Recipient: Requestor)
      const approvedSubject = `Approved - ${claimNumber}`;
      const approvedBody = `Your reimbursement request ${claimNumber} has been approved by ${user.name}. It has been forwarded to the Custodian for processing and payment release.

Claimed amount: ${formatPHP(claim.total_amount)}
Approved reimbursement: ${formatPHP(claim.approved_amount)}${claim.total_amount > REIMBURSEMENT_CAP ? ` (capped at ${formatPHP(REIMBURSEMENT_CAP)})` : ''}

Reference:
${claimNumber}`;
      sendEmail(claim.requestor_id, approvedSubject, approvedBody, undefined, { eventKey: 'approved' });

      // Email Notification 5: Processing (Recipient: Custodian)
      const custodians = users.filter(u => u.role === UserRole.CUSTODIAN);
      custodians.forEach(c => {
        const custodianSubject = `Reimbursement Processing Required - ${claimNumber}`;
        const custodianBody = `Reimbursement request ${claimNumber} submitted by ${requestor?.name || 'Requestor'} and approved by ${user.name} is now in your processing queue.

Reference:
${claimNumber}

Required Action:
Please generate the Claim Code, release the payment, and mark it as Ready for Claim.`;
        sendEmail(c.id, custodianSubject, custodianBody);
      });
    } else {
      claim.approved_at = undefined;
      claim.approved_amount = undefined;
      claim.paid_at = undefined;
      claim.paid_amount = undefined;
      const actionText = decision === 'Returned' ? 'Please revise and resubmit your claim.' : 'No action required.';
      const meetingText = review_meeting_date && review_meeting_time
        ? `\n\nReview Meeting:\n${review_meeting_date} at ${review_meeting_time}`
        : '';
      const emailSubject = `Reimbursement ${decision} - ${claimNumber}`;
      const emailBody = `Your reimbursement request ${claimNumber} has been ${decision.toLowerCase()} by ${user.name}.

Reason:
${comment}${meetingText}

Reference:
${claimNumber}

Required Action:
${actionText}`;
      // Settings > Notifications only has a "returned" toggle, not a
      // "rejected" one — a rejection is terminal (no revise-and-resubmit
      // expected of the requestor), so leave it unconditional rather than
      // guess it into a category the UI doesn't actually expose.
      sendEmail(claim.requestor_id, emailSubject, emailBody, undefined,
        decision === 'Returned' ? { eventKey: 'returned' } : undefined);
    }

    const claimMom = claim.mom_id ? moms.find(candidate => candidate.id === claim.mom_id) : undefined;
    if (claimMom?.cc_client && claimMom.contact_person_email) {
      sendEmail(
        claimMom.contact_person_email,
        `Copy: Reimbursement ${decision} - ${claimNumber}`,
        `${claimNumber}, filed by ${requestor?.name || 'the requestor'}, was ${decision.toLowerCase()}.${comment ? `\n\nComment: ${comment}` : ''}`,
        undefined,
        { plain: true, recipientName: claimMom.contact_person || undefined, fromLabel: `${user.name} via Sales Reimbursement System` }
      );
      notifyClientCcSent({
        recipientIds: [claim.requestor_id, user.id],
        claimNumber,
        clientName: claimMom.contact_person,
        clientEmail: claimMom.contact_person_email,
        eventLabel: decision,
      });
    }

    try {
      await persistClaim(claim);
      await insertApproval(newApproval);
      if (newReviewMeeting) await persistReviewMeeting(newReviewMeeting);
    } catch (err) {
      console.error('[db] Could not persist approval decision to Postgres:', err);
    }

    res.json(claim);
  });

  // docs/hierarchy-sync-design.md §5: the flagged old approver (or an Admin,
  // any time, per §7) hands a stale claim off to the suggested new approver.
  app.post('/api/claims/:id/transfer-approver', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Not found' });

    const isCurrentApprover = claim.current_approver_id === user.id;
    const isAdmin = user.role === UserRole.ADMIN;
    if (!isCurrentApprover && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    const targetApproverId = req.body?.to || claim.pending_transfer_to;
    if (!targetApproverId) return res.status(400).json({ error: 'No target approver specified.' });
    const newApprover = users.find(u => u.id === targetApproverId);
    if (!newApprover) return res.status(404).json({ error: 'Target approver not found.' });

    const oldApprover = users.find(u => u.id === claim.current_approver_id);
    const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0, 6)}`;

    claim.current_approver_id = targetApproverId;
    claim.approver_stale_since = null;
    claim.pending_transfer_to = null;
    claim.approver_stale_reason = undefined;
    claim.escalated_to_admin = false;
    claim.updated_at = new Date().toISOString();

    addHistory(claim.id, claim.status, claim.status, user.id,
      `Approver transferred from ${oldApprover?.name || '(unknown)'} to ${newApprover.name} — org change`);

    sendEmail(targetApproverId, `Reimbursement now assigned to you - ${claimNumber}`,
      `${claimNumber} has been transferred to you for review following an organizational change.`);

    try {
      await persistClaim(claim);
    } catch (err) {
      console.error('[db] Could not persist approver transfer to Postgres:', err);
    }
    res.json(claim);
  });

  // Simulates the daily/hourly Entra ID sync's fallback cron
  // (docs/hierarchy-sync-design.md §5). Shared by the scheduled job further
  // down (runs automatically, `force: false`) and the Admin Dashboard's
  // manual "Run Fallback Check" button (still useful for demoing without
  // waiting on the schedule, and `force: true` additionally skips the
  // day-count gate). `changedBy` records who/what triggered this run in the
  // resulting history entries.
  async function runStaleApproverFallbackCheck(force: boolean, changedBy: string): Promise<Claim[]> {
    const now = Date.now();
    const escalated: Claim[] = [];
    const admins = users.filter(u => u.role === UserRole.ADMIN);

    claims.forEach(claim => {
      if (!claim.approver_stale_since || claim.escalated_to_admin) return;
      const days = (now - new Date(claim.approver_stale_since).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= STALE_APPROVER_FALLBACK_DAYS || force) {
        claim.escalated_to_admin = true;
        escalated.push(claim);

        const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0, 6)}`;
        const currentApprover = users.find(u => u.id === claim.current_approver_id);
        const suggested = claim.pending_transfer_to ? users.find(u => u.id === claim.pending_transfer_to) : undefined;
        addHistory(claim.id, claim.status, claim.status, changedBy,
          `Fallback escalation: ${claimNumber} unresolved org-change notice sent to Admin.`);
        admins.forEach(admin => sendEmail(admin.id, `Escalation: stuck approval - ${claimNumber}`,
          `${claimNumber} has had an unresolved org-change approver notice for ${STALE_APPROVER_FALLBACK_DAYS}+ days.

Current approver: ${currentApprover?.name || '(unknown)'}
Suggested new approver: ${suggested?.name || '(unassigned)'}
Reason: ${claim.approver_stale_reason || 'Org change'}

Manual reassignment may be needed.`));
      }
    });

    try {
      for (const claim of escalated) await persistClaim(claim);
    } catch (err) {
      console.error('[db] Could not persist fallback escalation to Postgres:', err);
    }

    return escalated;
  }

  app.post('/api/admin/run-fallback-check', async (req, res) => {
    const admin = getUser(req);
    if (!admin || admin.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const force = !!req.body?.force;
    const escalated = await runStaleApproverFallbackCheck(force, admin.id);
    res.json({ escalatedCount: escalated.length, escalated: escalated.map(c => c.id) });
  });

  // Generate, Edit or Regenerate Claim Code (Release Code) - Custodian
  app.post('/api/custodian/claims/:id/decision', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.CUSTODIAN) {
      return res.status(403).json({ error: 'Forbidden: Only Custodians can make processing decisions.' });
    }

    const { decision, comment } = req.body as { decision?: 'Return' | 'Reject'; comment?: string };
    if (decision !== 'Return' && decision !== 'Reject') {
      return res.status(400).json({ error: 'Decision must be Return or Reject.' });
    }
    if (!comment?.trim()) {
      return res.status(400).json({ error: 'A reason is required so the requestor and audit trail are clear.' });
    }

    const claim = claims.find(item => item.id === req.params.id);
    const cashAdvance = cashAdvances.find(item => item.id === req.params.id);
    const liquidation = liquidations.find(item => item.id === req.params.id);
    const now = new Date().toISOString();

    if (claim) {
      if (![ClaimStatus.APPROVED, ClaimStatus.PROCESSING].includes(claim.status)) {
        return res.status(400).json({ error: 'Only approved or processing reimbursements can be returned or rejected by the Custodian.' });
      }
      const oldStatus = claim.status;
      const newStatus = decision === 'Return' ? ClaimStatus.RETURNED : ClaimStatus.REJECTED;
      claim.status = newStatus;
      claim.updated_at = now;
      claim.processing_date = undefined;
      claim.processed_by = undefined;
      claim.release_code = undefined;
      claim.release_code_expires_at = undefined;
      claim.release_code_attempts = 0;
      claim.release_code_locked_until = undefined;
      addHistory(claim.id, oldStatus, newStatus, user.id, `Custodian ${decision.toLowerCase()}: ${comment.trim()}`);

      const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0, 6)}`;
      sendEmail(
        claim.requestor_id,
        `Reimbursement ${decision === 'Return' ? 'Returned for Revision' : 'Rejected'} - ${claimNumber}`,
        `${user.name} ${decision === 'Return' ? 'returned' : 'rejected'} ${claimNumber} during payment processing.\n\nReason: ${comment.trim()}`
      );
      if (claim.current_approver_id) {
        sendEmail(
          claim.current_approver_id,
          `Custodian ${decision} - ${claimNumber}`,
          `${user.name} ${decision.toLowerCase()}ed ${claimNumber} during payment processing.\n\nReason: ${comment.trim()}`
        );
      }
      try {
        await persistClaim(claim);
      } catch (err) {
        console.error('[db] Could not persist custodian decision to Postgres:', err);
      }
      return res.json(claim);
    }

    if (cashAdvance) {
      if (decision !== 'Reject') {
        return res.status(400).json({ error: 'Approved Cash Advances can be rejected before release, but they do not have a return-for-revision state.' });
      }
      if (cashAdvance.status !== CashAdvanceStatus.APPROVED) {
        return res.status(400).json({ error: 'Only an Approved Cash Advance can be rejected before release.' });
      }
      const oldStatus = cashAdvance.status;
      cashAdvance.status = CashAdvanceStatus.REJECTED;
      addCaHistory(cashAdvance.id, oldStatus, CashAdvanceStatus.REJECTED, user.id, `Custodian rejected before release: ${comment.trim()}`);
      sendEmail(
        cashAdvance.requestorId,
        `Cash Advance Rejected - CADV-${cashAdvance.id.substring(0, 6)}`,
        `${user.name} rejected this Cash Advance before funds were released.\n\nReason: ${comment.trim()}`
      );
      try {
        await persistCashAdvance(cashAdvance);
      } catch (err) {
        console.error('[db] Could not persist custodian cash advance decision to Postgres:', err);
      }
      return res.json(cashAdvance);
    }

    if (liquidation) {
      if (decision !== 'Return') {
        return res.status(400).json({ error: 'A reviewed Liquidation can be returned for correction, but it cannot be rejected after the Cash Advance was released.' });
      }
      if (liquidation.status !== LiquidationStatus.REVIEWED || liquidation.varianceType !== 'RefundDue') {
        return res.status(400).json({ error: 'Only a reviewed Liquidation awaiting refund collection can be returned.' });
      }
      const oldStatus = liquidation.status;
      liquidation.status = LiquidationStatus.RETURNED_FOR_REVISION;
      addLiqHistory(liquidation.id, oldStatus, LiquidationStatus.RETURNED_FOR_REVISION, user.id, `Custodian returned before refund collection: ${comment.trim()}`);
      sendEmail(
        liquidation.requestorId,
        `Liquidation Returned - LIQ-${liquidation.id.substring(0, 6)}`,
        `${user.name} returned this Liquidation for correction before refund collection.\n\nReason: ${comment.trim()}`
      );
      try {
        await persistLiquidation(liquidation);
      } catch (err) {
        console.error('[db] Could not persist custodian liquidation decision to Postgres:', err);
      }
      return res.json(liquidation);
    }

    return res.status(404).json({ error: 'Processing record not found.' });
  });

  // Generate, Edit or Regenerate Claim Code (Release Code) - Custodian
  app.put('/api/claims/:id/claim-code', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.CUSTODIAN) return res.status(403).json({ error: 'Forbidden' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    // Workflow guard: a claim code is only meaningful once the claim is being
    // processed for release. Allow generation while Processing and re-generation
    // while Ready for Claim (custodian re-issuing a lost code), but never on a
    // draft, pending, completed, rejected, or returned claim.
    if (![ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM].includes(claim.status)) {
      return res.status(409).json({ error: `A claim code can only be generated for a claim in Processing or Ready for Claim (this one is "${claim.status}").` });
    }

    const { code } = req.body;
    const isRegen = !!claim.release_code;
    claim.release_code = code || generateReleaseCode();
    resetReleaseCodeSecurity(claim);

    addHistory(claim.id, claim.status, claim.status, user.id, isRegen ? `Regenerated Claim Code to ${claim.release_code}` : `Generated Claim Code ${claim.release_code}`);

    try {
      await persistClaim(claim);
    } catch (err) {
      console.error('[db] Could not persist claim code to Postgres:', err);
    }
    res.json(claim);
  });

  // Mark Ready for Claim - Custodian
  app.post('/api/claims/:id/ready-for-claim', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.CUSTODIAN) return res.status(403).json({ error: 'Forbidden' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    // Workflow guard: only a claim currently in Processing can be released to
    // Ready for Claim. This makes the transition idempotent-safe and blocks
    // marking a draft, pending, completed, rejected, or already-ready claim as
    // ready out of sequence (which would otherwise reset paid_at/amounts).
    if (claim.status !== ClaimStatus.PROCESSING) {
      return res.status(409).json({ error: `Only a claim in Processing can be marked Ready for Claim (this one is "${claim.status}").` });
    }

    if (!claim.release_code) {
      claim.release_code = generateReleaseCode();
      resetReleaseCodeSecurity(claim);
    }

    const { payment_method } = req.body;
    const isReimbursement = claim.claim_type === 'Reimbursement' || claim.claim_type === 'Transport Reimbursement';
    if (isReimbursement && payment_method !== 'Cash') {
      return res.status(400).json({ error: 'Reimbursements are released in cash only.' });
    }
    if (!isReimbursement && (!payment_method || !systemSettings.paymentMethods.includes(payment_method))) {
      return res.status(400).json({ error: `Payment method must be one of: ${systemSettings.paymentMethods.join(', ')}` });
    }
    claim.payment_method = payment_method;
    claim.processed_by = user.id;

    const oldStatus = claim.status;
    claim.status = ClaimStatus.READY_FOR_CLAIM;
    claim.processing_date = new Date().toISOString();
    claim.paid_at = claim.processing_date;
    claim.paid_amount = claim.approved_amount ?? claim.total_amount;
    claim.updated_at = new Date().toISOString();
    

    addHistory(claim.id, oldStatus, ClaimStatus.READY_FOR_CLAIM, user.id);

    // Email Notification 4: Ready for Claim (Recipient: Requestor)
    const requestor = users.find(u => u.id === claim.requestor_id);
    const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0,6)}`;

    const emailSubject = `Reimbursement - For Release`;
    const emailBody = `This request ${claimNumber} by ${requestor?.name || 'Requestor'} has been approved and ready for release.

Enter code ${claim.release_code} for releasing of cash.
_________________________________________
This is an automatically generated email, please do not reply.
${requestor?.name || 'Requestor'}
BSM Assistant | BSD - IT Security Business`;

    sendEmail(claim.requestor_id, emailSubject, emailBody, undefined, {
      plain: true,
      fromLabel: "SharePoint Online <no-reply@sharepointonline.com>",
      eventKey: 'ready',
    });

    try {
      await persistClaim(claim);
    } catch (err) {
      console.error('[db] Could not persist ready-for-claim to Postgres:', err);
    }
    res.json(claim);
  });

  // Complete Claim - Requestor confirming they received payment
  app.post('/api/claims/:id/claim', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const claim = claims.find(c => c.id === req.params.id && c.requestor_id === user.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    if (claim.status !== ClaimStatus.READY_FOR_CLAIM) {
      return res.status(400).json({ error: 'Claim is not ready for claiming.' });
    }

    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Incorrect Claim Code' });
    }

    if (claim.release_code_locked_until && new Date(claim.release_code_locked_until) > new Date()) {
      const minutesLeft = Math.max(1, Math.ceil((new Date(claim.release_code_locked_until).getTime() - Date.now()) / 60000));
      return res.status(429).json({ error: `Too many incorrect attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}, or ask your custodian to regenerate the code.` });
    }

    if (claim.release_code_expires_at && new Date(claim.release_code_expires_at) < new Date()) {
      return res.status(400).json({ error: 'This claim code has expired. Ask your custodian to regenerate it.' });
    }

    if (!claim.release_code || !timingSafeCodeEquals(code, claim.release_code)) {
      claim.release_code_attempts = (claim.release_code_attempts || 0) + 1;
      if (claim.release_code_attempts >= RELEASE_CODE_MAX_ATTEMPTS) {
        claim.release_code_locked_until = new Date(Date.now() + RELEASE_CODE_LOCKOUT_MINUTES * 60 * 1000).toISOString();
      }
      try {
        await persistClaim(claim);
      } catch (err) {
        console.error('[db] Could not persist release-code attempt to Postgres:', err);
      }
      return res.status(400).json({ error: 'Incorrect Claim Code' });
    }

    claim.release_code_attempts = 0;
    claim.release_code_locked_until = undefined;

    const oldStatus = claim.status;
    claim.status = ClaimStatus.COMPLETED;
    claim.updated_at = new Date().toISOString();
    

    addHistory(claim.id, oldStatus, ClaimStatus.COMPLETED, user.id);

    if (claim.sourceLiquidationId) {
      addLiqHistory(claim.sourceLiquidationId, LiquidationStatus.CLOSED, LiquidationStatus.CLOSED, user.id, 'Reimbursement Processed');
    }

    // Notify the custodian who processed the payout that the requestor has now
    // confirmed receipt and the claim is closed — previously this final step
    // produced no notification at all, so Finance never saw it complete.
    const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0, 6)}`;
    if (claim.processed_by) {
      sendEmail(
        claim.processed_by,
        `Reimbursement Completed - ${claimNumber}`,
        `${user.name} has confirmed receipt of the payout for ${claimNumber} (PHP ${claim.total_amount}). The claim is now complete — no further action is required.`
      );
    }
    // Confirmation copy to the requestor, matching every other step's pattern.
    sendEmail(
      claim.requestor_id,
      `Reimbursement Completed - ${claimNumber}`,
      `You've confirmed receipt of your reimbursement ${claimNumber} (PHP ${claim.total_amount}). This claim is now complete.`
    );

    try {
      await persistClaim(claim);
    } catch (err) {
      console.error('[db] Could not persist claim completion to Postgres:', err);
    }
    res.json(claim);
  });

  // Outbox API
  app.get('/api/outbox', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const base = user.role === UserRole.ADMIN
      ? [...emails, ...teamsMessages]
      : [...emails, ...teamsMessages].filter(e => e.recipient_id === user.id);
    const sorted = [...base].sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const { page, pageSize, search } = req.query;

    let filtered = sorted;
    if (typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(e => {
        const recipient = users.find(u => u.id === e.recipient_id);
        return (
          e.subject.toLowerCase().includes(q) ||
          e.body.toLowerCase().includes(q) ||
          (recipient?.name || '').toLowerCase().includes(q) ||
          (recipient?.email || e.to || '').toLowerCase().includes(q)
        );
      });
    }

    // Same opt-in shape as /api/history: no page/pageSize means the plain
    // sorted array, exactly as loadWorkspace has always consumed it.
    if (page && pageSize) {
      const p = Math.max(1, parseInt(page as string, 10) || 1);
      const ps = Math.max(1, parseInt(pageSize as string, 10) || 25);
      const total = filtered.length;
      const items = filtered.slice((p - 1) * ps, p * ps);
      const unreadTotal = base.filter(e => !e.read).length;
      return res.json({ items, total, page: p, pageSize: ps, unreadTotal });
    }

    res.json(filtered);
  });

  app.put('/api/outbox/read', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    const { ids } = req.body;
    if (Array.isArray(ids)) {
      [...emails, ...teamsMessages].forEach(e => {
        if (ids.includes(e.id) && (e.recipient_id === user.id || user.role === UserRole.ADMIN)) {
          e.read = true;
        }
      });
    }
    res.json({ success: true });
  });

  // Activity Status & Seen endpoints
  app.get('/api/activity/status', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // calendar: count of upcoming active (pending-confirmation or confirmed) review meetings
    const activeMeetingStatuses = [ReviewMeetingStatus.PENDING_CONFIRMATION, ReviewMeetingStatus.CONFIRMED, ReviewMeetingStatus.DECLINE_REQUESTED];
    let calendarCount = 0;
    if (user.role === UserRole.REQUESTOR) {
      calendarCount = reviewMeetings.filter(rm => rm.requestor_id === user.id && activeMeetingStatuses.includes(rm.status)).length;
    } else if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      calendarCount = reviewMeetings.filter(rm => (rm.requestor_id === user.id || rm.approver_id === user.id || reporteeIds.includes(rm.requestor_id)) && activeMeetingStatuses.includes(rm.status)).length;
    }

    // Keep the legacy response property name while counting every notification
    // channel. Internal workflow notices are delivered through Teams.
    const emailsCount = [...emails, ...teamsMessages].filter(e => e.recipient_id === user.id && !e.read).length;

    // inbox: (Approver only) count of pending-approval claims assigned to them,
    // their own returned claims, and Review Meetings awaiting their confirmation
    let inboxCount = 0;
    if (user.role === UserRole.APPROVER) {
      const pendingClaims = claims.filter(c => c.status === ClaimStatus.PENDING_APPROVAL && c.current_approver_id === user.id);
      const returnedClaims = claims.filter(c => c.status === ClaimStatus.RETURNED && c.requestor_id === user.id);
      const pendingMeetingConfirmations = reviewMeetings.filter(rm => rm.approver_id === user.id && rm.status === ReviewMeetingStatus.PENDING_CONFIRMATION);
      inboxCount = pendingClaims.length + returnedClaims.length + pendingMeetingConfirmations.length;
    }

    // processing: (Custodian only) count of claims currently in PROCESSING status
    let processingCount = 0;
    if (user.role === UserRole.CUSTODIAN) {
      processingCount = claims.filter(c => c.status === ClaimStatus.PROCESSING).length;
    }

    // dashboard: (Requestor only) count of the requestor's own claims currently in RETURNED status needing their action
    let dashboardCount = 0;
    if (user.role === UserRole.REQUESTOR) {
      dashboardCount = claims.filter(c => c.requestor_id === user.id && c.status === ClaimStatus.RETURNED).length;
    }

    // readyToClaim: (Requestor only) count of their own claims in READY_FOR_CLAIM status
    let readyToClaimCount = 0;
    if (user.role === UserRole.REQUESTOR) {
      readyToClaimCount = claims.filter(c => c.requestor_id === user.id && c.status === ClaimStatus.READY_FOR_CLAIM).length;
    }

    res.json({
      calendar: calendarCount,
      emails: emailsCount,
      inbox: inboxCount,
      processing: processingCount,
      dashboard: dashboardCount,
      readyToClaim: readyToClaimCount
    });
  });

  app.post('/api/activity/seen', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { section } = req.body;
    if (!section) return res.status(400).json({ error: 'Section is required' });

    if (!lastSeenStore[user.id]) {
      lastSeenStore[user.id] = {};
    }
    lastSeenStore[user.id][section] = new Date().toISOString();

    res.json({ success: true, timestamp: lastSeenStore[user.id][section] });
  });
  
  // All history for admin
  app.get('/api/history', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const enriched = statusHistories.map(h => {
      const claim = claims.find(c => c.id === h.claim_id);
      const changedBy = users.find(u => u.id === h.changed_by);
      const targetUser = h.user_id ? users.find(u => u.id === h.user_id) : undefined;
      return { ...h, claim, changedBy, targetUser };
    }).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const { page, pageSize, search, limit, role, status, dateFrom, dateTo } = req.query;

    let filtered = enriched;
    if (typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(e =>
        [e.changedBy?.name, e.claim?.claim_number, e.new_status, e.old_status, e.reason, e.targetUser?.name, (e as any).master_data_key]
          .some(v => (v || '').toString().toLowerCase().includes(q))
      );
    }
    if (typeof role === 'string' && role.trim()) {
      const normalizedRole = role.trim().toLowerCase();
      filtered = filtered.filter(e => (e.changedBy?.role || '').toLowerCase() === normalizedRole);
    }
    if (typeof status === 'string' && status.trim()) {
      const normalizedStatus = status.trim().toLowerCase();
      filtered = filtered.filter(e => (e.new_status || '').toLowerCase() === normalizedStatus);
    }
    if (typeof dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      const start = new Date(`${dateFrom}T00:00:00`).getTime();
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= start);
    }
    if (typeof dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      const end = new Date(`${dateTo}T23:59:59.999`).getTime();
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= end);
    }

    // Paginated shape only kicks in when the caller opts in — everything else
    // (AdminDashboard's "recent activity" call) keeps getting the plain array
    // it always has, so this stays backward compatible.
    if (page && pageSize) {
      const p = Math.max(1, parseInt(page as string, 10) || 1);
      const ps = Math.max(1, parseInt(pageSize as string, 10) || 25);
      const total = filtered.length;
      const items = filtered.slice((p - 1) * ps, p * ps);
      return res.json({ items, total, page: p, pageSize: ps });
    }

    if (limit) {
      const n = Math.max(1, parseInt(limit as string, 10) || 5);
      return res.json(filtered.slice(0, n));
    }

    res.json(filtered);
  });

  // Unified admin activity feed: user actions, automated system events, and
  // outbound notifications share one chronological stream.
  app.get('/api/system-activity', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    type UnifiedActivity = {
      id: string;
      source: 'audit' | 'notification';
      activityType: 'client' | 'system';
      timestamp: string;
      actor?: { name: string; role: UserRole };
      recipient?: { id: string; name: string; email: string };
      subject: string;
      oldStatus?: string;
      newStatus?: string;
      action: string;
      details: string;
      notification?: {
        id: string;
        recipient_id: string;
        from: string;
        to: string;
        subject: string;
        body: string;
        read: boolean;
        timestamp: string;
        channel: 'Email' | 'Teams';
      };
    };

    const auditItems: UnifiedActivity[] = statusHistories.map(history => {
      const claim = claims.find(c => c.id === history.claim_id);
      const changedBy = users.find(u => u.id === history.changed_by);
      const targetUser = history.user_id ? users.find(u => u.id === history.user_id) : undefined;
      const subject = claim?.claim_number || targetUser?.name || (history as any).master_data_key || 'System';
      return {
        id: `audit-${history.id}`,
        source: 'audit',
        activityType: changedBy ? 'client' : 'system',
        timestamp: history.timestamp,
        actor: changedBy ? { name: changedBy.name, role: changedBy.role } : undefined,
        subject,
        oldStatus: history.old_status,
        newStatus: history.new_status,
        action: history.old_status && history.old_status !== history.new_status
          ? `${history.old_status} → ${history.new_status}`
          : history.new_status,
        details: history.reason || 'Recorded by the system.',
      };
    });

    const notificationItems: UnifiedActivity[] = [...emails, ...teamsMessages].map(message => {
      const recipient = users.find(u => u.id === message.recipient_id);
      const channel: 'Email' | 'Teams' = message.channel === 'Teams' ? 'Teams' : 'Email';
      return {
        id: `notification-${message.id}`,
        source: 'notification',
        activityType: 'system',
        timestamp: message.timestamp,
        recipient: {
          id: message.recipient_id,
          name: recipient?.name || message.to || 'Unknown recipient',
          email: recipient?.email || message.to || '',
        },
        subject: message.subject,
        action: `${channel} notification sent`,
        details: message.body,
        notification: {
          id: message.id,
          recipient_id: message.recipient_id,
          from: message.from,
          to: message.to,
          subject: message.subject,
          body: message.body,
          read: message.read,
          timestamp: message.timestamp,
          channel,
        },
      };
    });

    let filtered = [...auditItems, ...notificationItems]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const { page, pageSize, search, activityType, source, role, status, dateFrom, dateTo } = req.query;

    if (typeof search === 'string' && search.trim()) {
      const query = search.trim().toLowerCase();
      filtered = filtered.filter(item =>
        [
          item.actor?.name,
          item.actor?.role,
          item.recipient?.name,
          item.recipient?.email,
          item.subject,
          item.action,
          item.details,
          item.newStatus,
        ].some(value => (value || '').toLowerCase().includes(query))
      );
    }
    if (activityType === 'client' || activityType === 'system') {
      filtered = filtered.filter(item => item.activityType === activityType);
    }
    if (source === 'audit' || source === 'notification') {
      filtered = filtered.filter(item => item.source === source);
    }
    if (typeof role === 'string' && role.trim()) {
      const normalizedRole = role.trim().toLowerCase();
      filtered = filtered.filter(item => (item.actor?.role || '').toLowerCase() === normalizedRole);
    }
    if (typeof status === 'string' && status.trim()) {
      const normalizedStatus = status.trim().toLowerCase();
      filtered = filtered.filter(item => (item.newStatus || '').toLowerCase() === normalizedStatus);
    }
    if (typeof dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
      const start = new Date(`${dateFrom}T00:00:00`).getTime();
      filtered = filtered.filter(item => new Date(item.timestamp).getTime() >= start);
    }
    if (typeof dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      const end = new Date(`${dateTo}T23:59:59.999`).getTime();
      filtered = filtered.filter(item => new Date(item.timestamp).getTime() <= end);
    }

    const p = Math.max(1, parseInt(page as string, 10) || 1);
    const ps = Math.max(1, parseInt(pageSize as string, 10) || 25);
    const total = filtered.length;
    res.json({ items: filtered.slice((p - 1) * ps, p * ps), total, page: p, pageSize: ps });
  });

  // --- CASH ADVANCE & LIQUIDATION ENDPOINTS ---

  const recalculateLiquidation = async (liquidationId: string) => {
    const liq = liquidations.find(l => l.id === liquidationId);
    if (!liq) return;
    const ca = cashAdvances.find(c => c.id === liq.cashAdvanceId);
    if (!ca) return;

    const items = liquidationLineItems.filter(item => item.liquidationId === liquidationId);
    const totalSpent = items.reduce((sum, item) => sum + item.amount, 0);
    const varianceAmount = totalSpent - ca.amount;

    liq.totalSpent = totalSpent;
    liq.varianceAmount = varianceAmount;
    if (varianceAmount === 0) {
      liq.varianceType = LiquidationVarianceType.SETTLED;
    } else if (varianceAmount < 0) {
      liq.varianceType = LiquidationVarianceType.REFUND_DUE;
    } else {
      liq.varianceType = LiquidationVarianceType.REIMBURSEMENT_DUE;
    }

    // Every call site is a line-item add/edit/delete or a submit — persist
    // both the recalculated totals and the current full line-item set here
    // once, rather than duplicating it at each of the five call sites.
    try {
      await persistLiquidation(liq);
      await persistLiquidationLineItems(liquidationId, items);
    } catch (err) {
      console.error('[db] Could not persist recalculated liquidation to Postgres:', err);
    }
  };

  // 1. Get all cash advances
  app.get('/api/cash-advances', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    let filtered: CashAdvance[] = [];
    if (user.role === UserRole.REQUESTOR) {
      filtered = cashAdvances.filter(ca => ca.requestorId === user.id);
    } else if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      filtered = cashAdvances.filter(ca => ca.approverId === user.id || ca.requestorId === user.id || reporteeIds.includes(ca.requestorId) || isActiveDelegateFor(user.id, ca.approverId));
    } else if (user.role === UserRole.FINANCE) {
      filtered = cashAdvances.filter(ca => isFinanceVisibleFinancialRecord('Cash Advance', ca.status));
    } else {
      filtered = cashAdvances; // Custodian and Admin see all
    }

    const enriched = filtered.map(ca => {
      const requestor = users.find(u => u.id === ca.requestorId);
      const approver = users.find(u => u.id === ca.approverId);
      const mom = ca.momId ? moms.find(m => m.id === ca.momId) : undefined;
      const history = statusHistories
        .filter(h => h.cash_advance_id === ca.id)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return { ...ca, requestor, approver, mom, history };
    });
    res.json(enriched);
  });

  // 2. Get single cash advance
  app.get('/api/cash-advances/:id', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ca = cashAdvances.find(c => c.id === req.params.id);
    if (!ca) return res.status(404).json({ error: 'Cash Advance not found' });

    // Mirror the scoping already applied by GET /api/cash-advances - the list
    // endpoint was correctly scoped but this single-record lookup was not.
    let hasAccess = false;
    if (user.role === UserRole.REQUESTOR) {
      hasAccess = ca.requestorId === user.id;
    } else if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      hasAccess = ca.approverId === user.id || ca.requestorId === user.id || reporteeIds.includes(ca.requestorId) || isActiveDelegateFor(user.id, ca.approverId);
    } else if (user.role === UserRole.FINANCE) {
      hasAccess = isFinanceVisibleFinancialRecord('Cash Advance', ca.status);
    } else {
      hasAccess = true; // Custodian and Admin see all
    }
    if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

    const requestor = users.find(u => u.id === ca.requestorId);
    const approver = users.find(u => u.id === ca.approverId);
    const mom = ca.momId ? moms.find(m => m.id === ca.momId) : undefined;

    const history = statusHistories
      .filter(h => h.cash_advance_id === ca.id)
      .map(h => ({
        ...h,
        changedBy: users.find(u => u.id === h.changed_by)
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ ...ca, requestor, approver, mom, history });
  });

  // 3. Create a cash advance request
  app.post('/api/cash-advances', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    // Soft-launch gate — mirrors the UI, but enforced here so a crafted
    // request can't create a gated type either. See src/lib/featureFlags.ts.
    if (!isClaimTypeEnabled('Cash Advance')) return res.status(403).json({ error: COMING_SOON_MESSAGE });
    if (!user.reports_to) return res.status(403).json({ error: 'Forbidden: You must have a designated manager (reports_to) to submit.' });

    // Rule 4: A Requestor may only have ONE active (unliquidated) CashAdvance at a time — block creation of a new one with a friendly message if one is already open.
    const hasActive = cashAdvances.some(ca => ca.requestorId === user.id && ca.status !== CashAdvanceStatus.LIQUIDATED && ca.status !== CashAdvanceStatus.REJECTED);
    if (hasActive) {
      return res.status(400).json({ error: 'A requestor may only have one active (unliquidated) Cash Advance at a time. Please liquidate or resolve your current open Cash Advance before requesting a new one.' });
    }

    const { amount, purpose, momId } = req.body;
    if (amount === undefined || amount === null || amount === '') {
      return res.status(400).json({ error: 'Amount is required.' });
    }
    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a valid positive number.' });
    }
    if (!purpose) {
      return res.status(400).json({ error: 'Purpose is required.' });
    }

    if (momId) {
      const mom = moms.find(m => m.id === momId);
      if (!mom) return res.status(400).json({ error: 'Minutes of Meeting (MOM) not found.' });
      if (mom.status !== MomStatus.COMPLETED) {
        return res.status(400).json({ error: 'Cannot attach an incomplete or draft Minutes of Meeting.' });
      }
    }

    const caId = uuidv4();
    const cashAdvance: CashAdvance = {
      id: caId,
      requestorId: user.id,
      amount: numericAmount,
      purpose,
      momId,
      approverId: user.reports_to,
      status: CashAdvanceStatus.DRAFT,
      createdAt: new Date().toISOString()
    };

    cashAdvances.push(cashAdvance);
    // Persist before logging history: addCaHistory's insert is fire-and-forget
    // and would otherwise race ahead of this row, FK-violating against a
    // cash_advance_id that doesn't exist in Postgres yet.
    try {
      await persistCashAdvance(cashAdvance);
    } catch (err) {
      console.error('[db] Could not persist new cash advance to Postgres:', err);
    }
    addCaHistory(caId, '', CashAdvanceStatus.DRAFT, user.id, 'Cash Advance Draft Created');
    res.json(cashAdvance);
  });

  // 4. Update cash advance in Draft or Rejected status
  app.put('/api/cash-advances/:id', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ca = cashAdvances.find(c => c.id === req.params.id);
    if (!ca) return res.status(404).json({ error: 'Cash Advance not found' });

    const { amount, purpose, momId } = req.body;

    // Rule 3: Once a CashAdvance reaches Released: amount, purpose, and linked MOM become locked. Only Admin can override.
    if ([CashAdvanceStatus.RELEASED, CashAdvanceStatus.LIQUIDATED].includes(ca.status)) {
      if (user.role !== UserRole.ADMIN) {
        return res.status(403).json({ error: 'This Cash Advance has already been released/liquidated. Its amount, purpose, and MOM are locked and can only be modified by an Admin.' });
      }
    }

    if (amount !== undefined) {
      const numericAmount = Number(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be a valid positive number.' });
      }
      ca.amount = numericAmount;
    }

    if (purpose !== undefined) {
      if (!purpose) return res.status(400).json({ error: 'Purpose cannot be empty.' });
      ca.purpose = purpose;
    }

    if (momId !== undefined) {
      if (momId) {
        const mom = moms.find(m => m.id === momId);
        if (!mom) return res.status(400).json({ error: 'Minutes of Meeting (MOM) not found.' });
        if (mom.status !== MomStatus.COMPLETED) {
          return res.status(400).json({ error: 'Cannot attach an incomplete or draft Minutes of Meeting.' });
        }
      }
      ca.momId = momId || undefined;
    }

    try {
      await persistCashAdvance(ca);
    } catch (err) {
      console.error('[db] Could not persist cash advance changes to Postgres:', err);
    }
    res.json(ca);
  });

  // 5. Submit Cash Advance
  app.post('/api/cash-advances/:id/submit', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const ca = cashAdvances.find(c => c.id === req.params.id && c.requestorId === user.id);
    if (!ca) return res.status(404).json({ error: 'Cash Advance not found' });

    if (ca.status !== CashAdvanceStatus.DRAFT && ca.status !== CashAdvanceStatus.REJECTED) {
      return res.status(400).json({ error: 'Only Cash Advances in Draft or Rejected status can be submitted.' });
    }

    const oldStatus = ca.status;
    ca.status = CashAdvanceStatus.SUBMITTED;
    addCaHistory(ca.id, oldStatus, CashAdvanceStatus.SUBMITTED, user.id, 'Cash Advance Submitted for Approval');
    
    // Delegation logic matching claims
    if (user.reports_to) {
      const activeDelegation = getActiveDelegation(user.reports_to);
      ca.approverId = activeDelegation ? activeDelegation.delegate_id : user.reports_to;
    }

    const approver = users.find(u => u.id === ca.approverId);
    if (approver) {
      sendEmail(
        ca.approverId,
        `Cash Advance Request Submitted - CADV-${ca.id.substring(0,6)}`,
        `A Cash Advance request for PHP ${ca.amount} has been submitted by ${user.name} for your approval.\n\nPurpose: ${ca.purpose}`
      );
    }

    sendEmail(
      user.id,
      `Cash Advance Request Submitted - CADV-${ca.id.substring(0,6)}`,
      `Your Cash Advance request for PHP ${ca.amount} has been successfully submitted${approver ? ` and routed to ${approver.name} for approval` : ''}.

Purpose: ${ca.purpose}

You'll receive another email as soon as a decision is made.`
    );

    try {
      await persistCashAdvance(ca);
    } catch (err) {
      console.error('[db] Could not persist cash advance submission to Postgres:', err);
    }
    res.json(ca);
  });

  // 6. Approve or Reject Cash Advance
  app.post('/api/cash-advances/:id/approve', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.APPROVER) return res.status(403).json({ error: 'Forbidden' });

    const ca = cashAdvances.find(c => c.id === req.params.id);
    if (!ca) return res.status(404).json({ error: 'Cash Advance not found' });

    if (ca.approverId !== user.id && !isActiveDelegateFor(user.id, ca.approverId)) {
      return res.status(403).json({ error: 'You are not the designated approver for this Cash Advance.' });
    }

    if (ca.status !== CashAdvanceStatus.SUBMITTED) {
      return res.status(400).json({ error: 'Only Submitted Cash Advances can be approved or rejected.' });
    }

    const { decision, comment } = req.body;
    if (!['Approved', 'Rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision. Must be Approved or Rejected.' });
    }

    if (decision === 'Rejected' && !comment) {
      return res.status(400).json({ error: 'A comment is required when rejecting a Cash Advance.' });
    }

    const oldStatus = ca.status;
    const newStatus = decision === 'Approved' ? CashAdvanceStatus.APPROVED : CashAdvanceStatus.REJECTED;
    ca.status = newStatus;
    if (decision === 'Approved') {
      ca.approvedAt = new Date().toISOString();
    } else {
      ca.approvedAt = undefined;
      ca.paidAmount = undefined;
    }
    addCaHistory(ca.id, oldStatus, newStatus, user.id, comment || `Cash Advance ${decision}`);

    sendEmail(
      ca.requestorId,
      `Cash Advance Request ${decision} - CADV-${ca.id.substring(0,6)}`,
      `Your Cash Advance request for PHP ${ca.amount} has been ${decision} by ${user.name}.${comment ? `\n\nComment: ${comment}` : ''}`
    );

    try {
      await persistCashAdvance(ca);
    } catch (err) {
      console.error('[db] Could not persist cash advance decision to Postgres:', err);
    }
    res.json(ca);
  });

  // 7. Release Cash Advance (Custodian only)
  app.post('/api/cash-advances/:id/release', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.CUSTODIAN) return res.status(403).json({ error: 'Forbidden: Only Custodians can release Cash Advances.' });

    const ca = cashAdvances.find(c => c.id === req.params.id);
    if (!ca) return res.status(404).json({ error: 'Cash Advance not found' });

    if (ca.status !== CashAdvanceStatus.APPROVED) {
      return res.status(400).json({ error: 'Only Approved Cash Advances can be released.' });
    }

    const { releaseReference, releaseMethod } = req.body;
    if (!releaseReference) {
      return res.status(400).json({ error: 'Release Reference/Voucher is required.' });
    }
    if (!releaseMethod || !systemSettings.paymentMethods.includes(releaseMethod)) {
      return res.status(400).json({ error: `Release method must be one of: ${systemSettings.paymentMethods.join(', ')}` });
    }

    const oldStatus = ca.status;
    ca.status = CashAdvanceStatus.RELEASED;
    ca.releasedBy = user.id;
    ca.releaseDate = new Date().toISOString();
    ca.paidAmount = ca.amount;
    ca.releaseReference = releaseReference;
    ca.releaseMethod = releaseMethod;
    addCaHistory(ca.id, oldStatus, CashAdvanceStatus.RELEASED, user.id, `Released via ${releaseMethod} with Voucher Reference: ${releaseReference}`);

    sendEmail(
      ca.requestorId,
      `Cash Advance Released - CADV-${ca.id.substring(0,6)}`,
      `Your Cash Advance for PHP ${ca.amount} has been released by ${user.name}.\n\nRelease Reference: ${releaseReference}\n\nPlease file your liquidation within ${LIQUIDATION_DEADLINE_DAYS} days.`
    );

    try {
      await persistCashAdvance(ca);
    } catch (err) {
      console.error('[db] Could not persist cash advance release to Postgres:', err);
    }
    res.json(ca);
  });

  // 8. Get all liquidations
  app.get('/api/liquidations', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    let filtered: Liquidation[] = [];
    if (user.role === UserRole.REQUESTOR) {
      filtered = liquidations.filter(l => l.requestorId === user.id);
    } else if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      filtered = liquidations.filter(l => {
        const ca = cashAdvances.find(ca => ca.id === l.cashAdvanceId);
        const approverId = ca?.approverId;
        return l.requestorId === user.id || approverId === user.id || reporteeIds.includes(l.requestorId) || isActiveDelegateFor(user.id, approverId);
      });
    } else if (user.role === UserRole.FINANCE) {
      filtered = liquidations.filter(l => isFinanceVisibleFinancialRecord('Liquidation', l.status));
    } else {
      filtered = liquidations; // Custodian and Admin see all
    }

    const enriched = filtered.map(l => {
      const requestor = users.find(u => u.id === l.requestorId);
      const cashAdvance = cashAdvances.find(c => c.id === l.cashAdvanceId);
      const items = liquidationLineItems.filter(item => item.liquidationId === l.id);
      const mom = cashAdvance?.momId ? moms.find(m => m.id === cashAdvance.momId) : undefined;
      const history = statusHistories
        .filter(h => h.liquidation_id === l.id)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return { ...l, requestor, cashAdvance, mom, lineItems: items, history };
    });
    res.json(enriched);
  });

  // 9. Get single liquidation
  app.get('/api/liquidations/:id', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const l = liquidations.find(liq => liq.id === req.params.id);
    if (!l) return res.status(404).json({ error: 'Liquidation not found' });

    // Mirror the scoping already applied by GET /api/liquidations - the list
    // endpoint was correctly scoped but this single-record lookup was not.
    if (!canAccessLiquidation(user, l)) return res.status(403).json({ error: 'Forbidden' });

    const requestor = users.find(u => u.id === l.requestorId);
    const cashAdvance = cashAdvances.find(c => c.id === l.cashAdvanceId);
    const items = liquidationLineItems.filter(item => item.liquidationId === l.id);
    const mom = cashAdvance?.momId ? moms.find(m => m.id === cashAdvance.momId) : undefined;

    const history = statusHistories
      .filter(h => h.liquidation_id === l.id)
      .map(h => ({
        ...h,
        changedBy: users.find(u => u.id === h.changed_by)
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ ...l, requestor, cashAdvance, mom, lineItems: items, history });
  });

  // 10. Initiate liquidation for a Released Cash Advance
  app.post('/api/liquidations', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!isClaimTypeEnabled('Liquidation')) return res.status(403).json({ error: COMING_SOON_MESSAGE });

    const { cashAdvanceId } = req.body;
    if (!cashAdvanceId) return res.status(400).json({ error: 'Cash Advance ID is required.' });

    const ca = cashAdvances.find(c => c.id === cashAdvanceId);
    if (!ca) return res.status(404).json({ error: 'Cash Advance not found' });

    if (ca.requestorId !== user.id) {
      return res.status(403).json({ error: 'You can only liquidate your own Cash Advances.' });
    }

    if (ca.status !== CashAdvanceStatus.RELEASED) {
      return res.status(400).json({ error: 'You can only liquidate Cash Advances that have been Released.' });
    }

    const existing = liquidations.find(l => l.cashAdvanceId === cashAdvanceId);
    if (existing) {
      return res.status(400).json({ error: 'A Liquidation already exists for this Cash Advance.' });
    }

    const liquidationId = uuidv4();
    const liquidation: Liquidation = {
      id: liquidationId,
      cashAdvanceId,
      requestorId: user.id,
      totalSpent: 0,
      varianceAmount: -ca.amount,
      varianceType: LiquidationVarianceType.REFUND_DUE,
      status: LiquidationStatus.DRAFT,
      createdAt: new Date().toISOString()
    };

    liquidations.push(liquidation);
    // Persist before logging history: addLiqHistory's insert is
    // fire-and-forget and would otherwise race ahead of this row, FK-violating
    // against a liquidation_id that doesn't exist in Postgres yet. `ca`
    // already exists in DB from its own earlier lifecycle, so addCaHistory
    // here is safe either way.
    try {
      await persistLiquidation(liquidation);
    } catch (err) {
      console.error('[db] Could not persist new liquidation to Postgres:', err);
    }
    addLiqHistory(liquidationId, '', LiquidationStatus.DRAFT, user.id, 'Liquidation Draft Started');
    addCaHistory(ca.id, ca.status, ca.status, user.id, 'Liquidation Started');
    res.json(liquidation);
  });

  // 11. Add a line item to a Liquidation (editable only in Draft or ReturnedForRevision)
  app.post('/api/liquidations/:id/line-items', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const l = liquidations.find(liq => liq.id === req.params.id);
    if (!l) return res.status(404).json({ error: 'Liquidation not found' });

    if (l.requestorId !== user.id) {
      return res.status(403).json({ error: 'You do not have permission to modify this Liquidation.' });
    }

    // Rule 2: Editable only in Draft or ReturnedForRevision; read-only otherwise
    if (l.status !== LiquidationStatus.DRAFT && l.status !== LiquidationStatus.RETURNED_FOR_REVISION) {
      return res.status(400).json({ error: 'This Liquidation is read-only because it has been submitted.' });
    }

    const { expense_date, vendor, category, amount, payment_method, business_purpose, receipt_url, attachment_type, or_number } = req.body;
    if (!expense_date || !vendor || !category || amount === undefined || !payment_method || !business_purpose || !receipt_url) {
      return res.status(400).json({ error: 'Missing required expense fields.' });
    }

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Amount must be a valid number greater than zero.' });
    }

    const itemId = uuidv4();
    const newItem: LiquidationLineItem = {
      id: itemId,
      liquidationId: l.id,
      expense_date,
      vendor,
      category: normalizeExpenseCategory(category),
      amount: numericAmount,
      payment_method,
      business_purpose,
      receipt_url,
      attachment_type: attachment_type || 'Official Receipt',
      or_number: or_number || undefined
    };

    liquidationLineItems.push(newItem);
    await recalculateLiquidation(l.id);

    res.json(newItem);
  });

  // 12. Update a line item in a Liquidation
  app.put('/api/liquidations/:id/line-items/:itemId', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const l = liquidations.find(liq => liq.id === req.params.id);
    if (!l) return res.status(404).json({ error: 'Liquidation not found' });

    if (l.requestorId !== user.id) {
      return res.status(403).json({ error: 'You do not have permission to modify this Liquidation.' });
    }

    // Rule 2: Editable only in Draft or ReturnedForRevision; read-only otherwise
    if (l.status !== LiquidationStatus.DRAFT && l.status !== LiquidationStatus.RETURNED_FOR_REVISION) {
      return res.status(400).json({ error: 'This Liquidation is read-only because it has been submitted.' });
    }

    const item = liquidationLineItems.find(i => i.id === req.params.itemId && i.liquidationId === l.id);
    if (!item) return res.status(404).json({ error: 'Line item not found' });

    const { expense_date, vendor, category, amount, payment_method, business_purpose, receipt_url, attachment_type, or_number } = req.body;

    if (expense_date !== undefined) item.expense_date = expense_date;
    if (vendor !== undefined) item.vendor = vendor;
    if (category !== undefined) item.category = normalizeExpenseCategory(category);
    if (amount !== undefined) {
      const numericAmount = Number(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be a valid number greater than zero.' });
      }
      item.amount = numericAmount;
    }
    if (payment_method !== undefined) item.payment_method = payment_method;
    if (business_purpose !== undefined) item.business_purpose = business_purpose;
    if (receipt_url !== undefined) item.receipt_url = receipt_url;
    if (attachment_type !== undefined) item.attachment_type = attachment_type;
    if (or_number !== undefined) item.or_number = or_number;

    await recalculateLiquidation(l.id);
    res.json(item);
  });

  // 13. Delete a line item from a Liquidation
  app.delete('/api/liquidations/:id/line-items/:itemId', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const l = liquidations.find(liq => liq.id === req.params.id);
    if (!l) return res.status(404).json({ error: 'Liquidation not found' });

    if (l.requestorId !== user.id) {
      return res.status(403).json({ error: 'You do not have permission to modify this Liquidation.' });
    }

    // Rule 2: Editable only in Draft or ReturnedForRevision; read-only otherwise
    if (l.status !== LiquidationStatus.DRAFT && l.status !== LiquidationStatus.RETURNED_FOR_REVISION) {
      return res.status(400).json({ error: 'This Liquidation is read-only because it has been submitted.' });
    }

    const index = liquidationLineItems.findIndex(i => i.id === req.params.itemId && i.liquidationId === l.id);
    if (index === -1) return res.status(404).json({ error: 'Line item not found' });

    liquidationLineItems.splice(index, 1);
    await recalculateLiquidation(l.id);

    res.json({ success: true });
  });

  // 14. Submit a Liquidation report
  app.post('/api/liquidations/:id/submit', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const l = liquidations.find(liq => liq.id === req.params.id && liq.requestorId === user.id);
    if (!l) return res.status(404).json({ error: 'Liquidation not found' });

    if (l.status !== LiquidationStatus.DRAFT && l.status !== LiquidationStatus.RETURNED_FOR_REVISION) {
      return res.status(400).json({ error: 'Only Liquidations in Draft or ReturnedForRevision status can be submitted.' });
    }

    // Company spending policy — enforce per-category caps across all lines.
    const liqPolicyError = checkCategoryLimits(liquidationLineItems.filter(i => i.liquidationId === l.id));
    if (liqPolicyError) return res.status(400).json({ error: liqPolicyError });

    await recalculateLiquidation(l.id);

    // The requestor can declare how they'll return an over-advance up front;
    // the custodian confirms/records the actual method later when collecting.
    // Only meaningful for a refund-due variance.
    const { refundMethod } = req.body || {};
    if (refundMethod && l.varianceType === LiquidationVarianceType.REFUND_DUE) {
      l.refundMethod = refundMethod;
    }

    const oldStatus = l.status;
    l.status = LiquidationStatus.SUBMITTED;
    addLiqHistory(l.id, oldStatus, LiquidationStatus.SUBMITTED, user.id, 'Liquidation Submitted for Review');

    const ca = cashAdvances.find(c => c.id === l.cashAdvanceId);
    if (ca) {
      addCaHistory(ca.id, ca.status, ca.status, user.id, 'Liquidation Submitted');
      sendEmail(
        ca.approverId,
        `Liquidation Submitted - LIQ-${l.id.substring(0,6)}`,
        `A Liquidation report has been submitted by ${user.name} for Cash Advance CADV-${ca.id.substring(0,6)}.\n\nTotal Spent: PHP ${l.totalSpent}\nVariance: PHP ${l.varianceAmount} (${l.varianceType})`
      );
    }

    try {
      await persistLiquidation(l);
    } catch (err) {
      console.error('[db] Could not persist liquidation submission to Postgres:', err);
    }
    res.json(l);
  });

  // 15. Approve/Reviewed or Return a Liquidation report (Approver only)
  app.post('/api/liquidations/:id/review', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.APPROVER) return res.status(403).json({ error: 'Forbidden' });

    const l = liquidations.find(liq => liq.id === req.params.id);
    if (!l) return res.status(404).json({ error: 'Liquidation not found' });

    const ca = cashAdvances.find(c => c.id === l.cashAdvanceId);
    if (!ca || (ca.approverId !== user.id && !isActiveDelegateFor(user.id, ca.approverId))) {
      return res.status(403).json({ error: 'You are not the designated approver/reviewer for this Liquidation.' });
    }

    if (l.status !== LiquidationStatus.SUBMITTED) {
      return res.status(400).json({ error: 'Only Submitted Liquidations can be reviewed.' });
    }

    const { decision, comment } = req.body;
    if (!['Approved', 'Returned'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision. Must be Approved or Returned.' });
    }

    if (decision === 'Returned' && !comment) {
      return res.status(400).json({ error: 'A comment is required when returning a Liquidation for revision.' });
    }

    // Set only by the REIMBURSEMENT_DUE branch below; persisted alongside
    // the liquidation/cash-advance at the end regardless of which branch ran.
    let shortFallClaim: Claim | undefined;

    if (decision === 'Returned') {
      const oldStatus = l.status;
      l.status = LiquidationStatus.RETURNED_FOR_REVISION;
      addLiqHistory(l.id, oldStatus, LiquidationStatus.RETURNED_FOR_REVISION, user.id, comment || 'Returned for revision');
      addCaHistory(ca.id, ca.status, ca.status, user.id, `Liquidation Returned for Revision: ${comment}`);
      sendEmail(
        l.requestorId,
        `Liquidation Returned - LIQ-${l.id.substring(0,6)}`,
        `Your Liquidation report has been returned for revision by ${user.name}.\n\nReason: ${comment}`
      );
    } else {
      await recalculateLiquidation(l.id);

      if (l.varianceType === LiquidationVarianceType.SETTLED) {
        const oldStatus = l.status;
        const oldCaStatus = ca.status;
        l.status = LiquidationStatus.CLOSED;
        ca.status = CashAdvanceStatus.LIQUIDATED;
        addLiqHistory(l.id, oldStatus, LiquidationStatus.CLOSED, user.id, 'Liquidation Approved & Closed (Settled with zero variance)');
        addCaHistory(ca.id, oldCaStatus, CashAdvanceStatus.LIQUIDATED, user.id, 'Liquidation Closed');

        sendEmail(
          l.requestorId,
          `Liquidation Approved & Closed - LIQ-${l.id.substring(0,6)}`,
          `Your Liquidation report has been approved and closed by ${user.name}. Since it is settled with zero variance, no further action is required.`
        );
      } else if (l.varianceType === LiquidationVarianceType.REIMBURSEMENT_DUE) {
        const oldStatus = l.status;
        const oldCaStatus = ca.status;
        l.status = LiquidationStatus.CLOSED;
        ca.status = CashAdvanceStatus.LIQUIDATED;

        const claimId = uuidv4();
        const claimNumber = await generateClaimNumber();

        shortFallClaim = {
          id: claimId,
          claim_number: claimNumber,
          requestor_id: l.requestorId,
          current_approver_id: ca.approverId,
          mom_id: ca.momId || '',
          status: ClaimStatus.PROCESSING,
          total_amount: l.varianceAmount,
          // Every other approval path caps the payout at REIMBURSEMENT_CAP
          // (see POST /api/claims/:id/approve) — this auto-generated shortfall
          // claim skipped that route entirely and paid the raw variance
          // uncapped. Same fix as line ~3108: total_amount stays the full
          // amount owed, only approved_amount (what actually gets paid) caps.
          approved_amount: Math.min(l.varianceAmount, REIMBURSEMENT_CAP),
          approved_at: new Date().toISOString(),
          expense_category: 'Cash Advance Shortfall',
          receipt_url: liquidationLineItems.find(item => item.liquidationId === l.id)?.receipt_url || '',
          remarks: `Automatic shortfall reimbursement from Liquidation of CADV-${ca.id.substring(0,6)}`,
          sourceLiquidationId: l.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          flagged_high_value: l.varianceAmount > systemSettings.highValueThreshold
        };

        claims.push(shortFallClaim);

        expenses.push({
          id: uuidv4(),
          claim_id: claimId,
          expense_date: new Date().toISOString().split('T')[0],
          vendor: 'Shortfall Payout',
          category: 'Cash Advance Shortfall',
          amount: l.varianceAmount,
          payment_method: 'Cash',
          business_purpose: `Shortfall payout for CADV-${ca.id.substring(0,6)} liquidation`,
          receipt_url: shortFallClaim.receipt_url
        });

        // Persist before logging history: addHistory's insert is
        // fire-and-forget and would otherwise race ahead of this brand-new
        // claim row, FK-violating against a claim_id that doesn't exist in
        // Postgres yet. Claim + its one expense line go through a single
        // transaction so a failure can't commit one without the other.
        try {
          await persistClaimWithLineItems(shortFallClaim, expenses.filter(e => e.claim_id === claimId));
        } catch (err) {
          console.error('[db] Could not persist shortfall claim to Postgres:', err);
        }

        addHistory(claimId, ClaimStatus.DRAFT, ClaimStatus.PROCESSING, user.id, 'Automatic creation from Cash Advance Liquidation Shortfall');
        addLiqHistory(l.id, oldStatus, LiquidationStatus.CLOSED, user.id, `Liquidation Approved & Closed. Shortfall reimbursement claim created: ${claimNumber}`);
        addCaHistory(ca.id, oldCaStatus, CashAdvanceStatus.LIQUIDATED, user.id, 'Liquidation Closed (Reimbursement Payout Queued)');

        sendEmail(
          l.requestorId,
          `Liquidation Approved & Reimbursement Payout Queued - LIQ-${l.id.substring(0,6)}`,
          `Your Liquidation has been approved. A shortfall reimbursement claim ${claimNumber} for PHP ${l.varianceAmount} has been automatically created and routed directly to the Custodian's disbursement preparation queue.`
        );
      } else {
        const oldStatus = l.status;
        l.status = LiquidationStatus.REVIEWED;
        addLiqHistory(l.id, oldStatus, LiquidationStatus.REVIEWED, user.id, `Liquidation Approved & Reviewed. Pending refund of PHP ${Math.abs(l.varianceAmount)}`);
        addCaHistory(ca.id, ca.status, ca.status, user.id, 'Liquidation Reviewed (Pending Refund)');

        sendEmail(
          l.requestorId,
          `Liquidation Reviewed & Approved - LIQ-${l.id.substring(0,6)}`,
          `Your Liquidation has been approved and is awaiting Custodian refund collection of PHP ${Math.abs(l.varianceAmount)}.`
        );
      }
    }

    try {
      await persistLiquidation(l);
      await persistCashAdvance(ca);
      if (shortFallClaim) {
        await persistClaim(shortFallClaim);
        await persistExpenseLineItems(shortFallClaim.id, expenses.filter(e => e.claim_id === shortFallClaim!.id));
      }
    } catch (err) {
      console.error('[db] Could not persist liquidation review to Postgres:', err);
    }
    res.json(l);
  });

  // 16. Collect refund and close Liquidation (Custodian only)
  app.post('/api/liquidations/:id/collect-refund', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.CUSTODIAN) return res.status(403).json({ error: 'Forbidden: Only Custodians can collect refunds.' });

    const l = liquidations.find(liq => liq.id === req.params.id);
    if (!l) return res.status(404).json({ error: 'Liquidation not found' });

    if (l.status !== LiquidationStatus.REVIEWED) {
      return res.status(400).json({ error: 'Only Reviewed Liquidations with pending refunds can be marked collected.' });
    }

    if (l.varianceType !== LiquidationVarianceType.REFUND_DUE) {
      return res.status(400).json({ error: 'No refund is due for this Liquidation.' });
    }

    const { referenceNote, refundMethod } = req.body;
    if (!refundMethod || !systemSettings.paymentMethods.includes(refundMethod)) {
      return res.status(400).json({ error: `Refund method must be one of: ${systemSettings.paymentMethods.join(', ')}` });
    }

    const oldStatus = l.status;
    l.status = LiquidationStatus.CLOSED;

    const ca = cashAdvances.find(c => c.id === l.cashAdvanceId);
    let oldCaStatus = '';
    if (ca) {
      oldCaStatus = ca.status;
      ca.status = CashAdvanceStatus.LIQUIDATED;
    }

    addLiqHistory(l.id, oldStatus, LiquidationStatus.CLOSED, user.id, `Closed (Refund Collected via ${refundMethod}). Note: ${referenceNote || 'Collected by Custodian'}`);
    if (ca) {
      addCaHistory(ca.id, oldCaStatus, CashAdvanceStatus.LIQUIDATED, user.id, 'Closed (Refund Collected)');
    }

    (l as any).refundReference = referenceNote || 'Collected by Custodian';
    (l as any).refundMethod = refundMethod;
    (l as any).refundCollectedAt = new Date().toISOString();

    sendEmail(
      l.requestorId,
      `Liquidation Closed (Refund Collected) - LIQ-${l.id.substring(0,6)}`,
      `Your Liquidation has been marked as Closed. Custodian ${user.name} has verified collection of your refund of PHP ${Math.abs(l.varianceAmount)}.${referenceNote ? `\n\nReference: ${referenceNote}` : ''}`
    );

    // refundReference/refundCollectedAt above are ad-hoc (any-cast) fields
    // with no schema column — not persisted. The same information (who,
    // when, via what method) is already captured durably in the addLiqHistory
    // reason text a few lines up, so nothing is actually lost.
    try {
      await persistLiquidation(l);
      if (ca) await persistCashAdvance(ca);
    } catch (err) {
      console.error('[db] Could not persist refund collection to Postgres:', err);
    }
    res.json(l);
  });

  // Delegation: list delegations relevant to the current user, either as the
  // Approver who requested them or as the delegate being asked to cover -
  // powers both "my delegation status/history" and "pending requests
  // waiting on my response" in Settings.
  app.get('/api/delegations', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    syncDelegationStatuses();
    const relevant = delegations.filter(d => d.approver_id === user.id || d.delegate_id === user.id);
    const enriched = relevant.map(d => ({
      ...d,
      approver: users.find(u => u.id === d.approver_id),
      delegate: users.find(u => u.id === d.delegate_id)
    })).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(enriched);
  });

  // Approver requests a delegation. Starts Pending - routing does not change
  // until the delegate explicitly accepts (see /accept below).
  app.post('/api/delegations', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.APPROVER) return res.status(403).json({ error: 'Forbidden' });

    const { delegate_id, start_date, end_date } = req.body;
    if (!delegate_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'Delegate, start date, and end date are all required.' });
    }
    if (delegate_id === user.id) {
      return res.status(400).json({ error: 'You cannot delegate to yourself.' });
    }
    const delegate = users.find(u => u.id === delegate_id);
    if (!delegate || delegate.role !== UserRole.APPROVER) {
      return res.status(400).json({ error: 'You can only delegate to another Approver.' });
    }
    if (new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({ error: 'The start date cannot be after the end date.' });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const delegation: ApproverDelegation = {
      id,
      approver_id: user.id,
      delegate_id,
      start_date,
      end_date,
      status: DelegationStatus.PENDING,
      created_by: user.id,
      created_at: now,
      updated_at: now
    };
    delegations.push(delegation);
    // Persist before logging history: addDelegationHistory's insert is
    // fire-and-forget and would otherwise race ahead of this row, FK-violating
    // against a delegation_id that doesn't exist in Postgres yet.
    try {
      await persistDelegation(delegation);
    } catch (err) {
      console.error('[db] Could not persist new delegation to Postgres:', err);
    }
    addDelegationHistory(id, '', DelegationStatus.PENDING, user.id, `Delegation requested to ${delegate.name}`);

    sendEmail(
      delegate_id,
      `Delegation Request from ${user.name}`,
      `${user.name} has asked you to cover their approval duties from ${start_date} to ${end_date}.\n\nPlease log in and Accept or Decline this request from Settings > Approval Delegation. Your decision does not take effect until you respond - claims will keep routing to ${user.name} until then.`,
      undefined,
      { eventKey: 'delegation' }
    );

    res.json(delegation);
  });

  // Delegate accepts a Pending request - only now does routing actually change.
  app.post('/api/delegations/:id/accept', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    syncDelegationStatuses();

    const delegation = delegations.find(d => d.id === req.params.id);
    if (!delegation) return res.status(404).json({ error: 'Delegation not found' });
    if (delegation.delegate_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
    if (delegation.status !== DelegationStatus.PENDING) {
      return res.status(400).json({ error: `This request is ${delegation.status.toLowerCase()} and can no longer be accepted.` });
    }

    const oldStatus = delegation.status;
    delegation.status = DelegationStatus.ACTIVE;
    delegation.updated_at = new Date().toISOString();
    addDelegationHistory(delegation.id, oldStatus, DelegationStatus.ACTIVE, user.id, 'Delegation accepted');

    sendEmail(
      delegation.approver_id,
      `${user.name} accepted your delegation request`,
      `${user.name} has accepted your request to cover approvals from ${delegation.start_date} to ${delegation.end_date}. Claims from your direct reports will now route to them for that period.`,
      undefined,
      { eventKey: 'delegation' }
    );

    try {
      await persistDelegation(delegation);
    } catch (err) {
      console.error('[db] Could not persist delegation acceptance to Postgres:', err);
    }
    res.json(delegation);
  });

  // Delegate declines - request never takes effect, approver has to pick someone else.
  app.post('/api/delegations/:id/decline', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const delegation = delegations.find(d => d.id === req.params.id);
    if (!delegation) return res.status(404).json({ error: 'Delegation not found' });
    if (delegation.delegate_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
    if (delegation.status !== DelegationStatus.PENDING) {
      return res.status(400).json({ error: `This request is ${delegation.status.toLowerCase()} and can no longer be declined.` });
    }

    const { reason } = req.body;
    const oldStatus = delegation.status;
    delegation.status = DelegationStatus.DECLINED;
    delegation.decline_reason = reason || undefined;
    delegation.updated_at = new Date().toISOString();
    addDelegationHistory(delegation.id, oldStatus, DelegationStatus.DECLINED, user.id, reason || 'Delegation declined');

    sendEmail(
      delegation.approver_id,
      `${user.name} declined your delegation request`,
      `${user.name} has declined your request to cover approvals from ${delegation.start_date} to ${delegation.end_date}.${reason ? `\n\nReason: ${reason}` : ''}\n\nPlease choose a different delegate if you still need coverage for this period.`,
      undefined,
      { eventKey: 'delegation' }
    );

    try {
      await persistDelegation(delegation);
    } catch (err) {
      console.error('[db] Could not persist delegation decline to Postgres:', err);
    }
    res.json(delegation);
  });

  // Approver cancels their own delegation early, whether it's still Pending
  // or already Active.
  app.post('/api/delegations/:id/cancel', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const delegation = delegations.find(d => d.id === req.params.id);
    if (!delegation) return res.status(404).json({ error: 'Delegation not found' });
    if (delegation.approver_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
    if (delegation.status !== DelegationStatus.PENDING && delegation.status !== DelegationStatus.ACTIVE) {
      return res.status(400).json({ error: `This delegation is already ${delegation.status.toLowerCase()}.` });
    }

    const oldStatus = delegation.status;
    delegation.status = DelegationStatus.CANCELLED;
    delegation.updated_at = new Date().toISOString();
    addDelegationHistory(delegation.id, oldStatus, DelegationStatus.CANCELLED, user.id, 'Delegation cancelled by approver');

    sendEmail(
      delegation.delegate_id,
      `${user.name} cancelled their delegation request`,
      `${user.name} has cancelled the delegation ${oldStatus === DelegationStatus.ACTIVE ? 'that was active' : 'request'} covering ${delegation.start_date} to ${delegation.end_date}. ${oldStatus === DelegationStatus.ACTIVE ? 'You no longer need to act on their behalf.' : 'No action is needed.'}`,
      undefined,
      { eventKey: 'delegation' }
    );

    try {
      await persistDelegation(delegation);
    } catch (err) {
      console.error('[db] Could not persist delegation cancellation to Postgres:', err);
    }
    res.json(delegation);
  });

  // Admin: Reassign Approver
  app.put('/api/claims/:id/reassign', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });
    
    const { new_approver_id, reason } = req.body;
    if (!new_approver_id || !reason) return res.status(400).json({ error: 'Missing required fields' });

    const newApprover = users.find(u => u.id === new_approver_id);
    if (!newApprover) return res.status(400).json({ error: 'New approver not found.' });
    if (newApprover.role !== UserRole.APPROVER) return res.status(400).json({ error: 'New approver must have the Approver role.' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const oldApproverId = claim.current_approver_id;
    const oldApproverName = users.find(u => u.id === oldApproverId)?.name || oldApproverId;
    const newApproverName = users.find(u => u.id === new_approver_id)?.name || new_approver_id;
    
    claim.current_approver_id = new_approver_id;
    // An admin reassign resolves whatever org-change staleness prompted it,
    // same as a peer-to-peer transfer does — otherwise the claim keeps
    // showing up in the stale/fallback list with a now-outdated reason.
    claim.approver_stale_since = null;
    claim.pending_transfer_to = null;
    claim.approver_stale_reason = undefined;
    claim.escalated_to_admin = false;
    claim.updated_at = new Date().toISOString();

    addHistory(claim.id, claim.status, claim.status, user.id,
      `Admin reassigned from ${oldApproverName} to ${newApproverName}. Reason: ${reason}`);

    try {
      await persistClaim(claim);
    } catch (err) {
      console.error('[db] Could not persist admin reassignment to Postgres:', err);
    }
    res.json(claim);
  });

  // Admin: Seed Data
  app.post('/api/admin/seed', async (req, res) => {
    if (!demoModeEnabled) return res.status(404).json({ error: 'Demo data tools are disabled.' });
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    try {
      suppressHistoryPersistence = true;
      try {
        await seedYearOfData({
          demoClaims: true,
          demoCashAdvances: true,
          delegations: true,
          historicalBackfill: false,
          reviewMeetings: false,
          supportRequests: false,
        });
      } finally {
        suppressHistoryPersistence = false;
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('Failed to seed mock data:', err);
      res.status(500).json({ error: err.message });
    }
  });

  interface SeedDataOptions {
    demoClaims: boolean;
    demoCashAdvances: boolean;
    delegations: boolean;
    historicalBackfill: boolean;
    reviewMeetings: boolean;
    supportRequests: boolean;
  }

  const FULL_SEED_OPTIONS: SeedDataOptions = {
    demoClaims: true,
    demoCashAdvances: true,
    delegations: true,
    historicalBackfill: true,
    reviewMeetings: true,
    supportRequests: true,
  };

  // resetUsers=false lets the boot-time auto-seed call (below) reseed the
  // not-yet-DB-backed domains (claims, moms, etc.) on every restart, exactly
  // as before persistence existed, without clobbering real users that were
  // just loaded from Postgres. Explicit admin seed/reset routes always pass
  // the default (true) — an admin choosing to reseed means reseed everything.
  async function seedYearOfData(options: SeedDataOptions = FULL_SEED_OPTIONS, resetUsers = true) {
    // Every call site already checks demoModeEnabled before calling this
    // (route handlers return 404 first for a clean response; the boot-time
    // auto-seed only calls in if demoModeEnabled) — this is the backstop so
    // a real deploy can never regenerate demo data even if a future call
    // site forgets that check. One switch, enforced here, not by convention
    // at every caller (punchlist #10).
    if (!demoModeEnabled) {
      throw new Error('Refusing to seed demo data: DEMO_MODE is disabled.');
    }
    moms = [];
    claims = [];
    expenses = [];
    approvals = [];
    statusHistories = [];
    emails = [];
    teamsMessages = [];
    lastSeenStore = {};
    cashAdvances = [];
    liquidations = [];
    liquidationLineItems = [];
    reviewMeetings = [];
    delegations = [];
    supportRequests = [];
    supportMessages = [];
    companies = buildInitialCompanies();
    departments = buildInitialDepartments();
    costCenters = buildInitialCostCenters();
    businessUnits = buildInitialBusinessUnits();
    branches = buildInitialBranches();
    projectCodes = buildInitialProjectCodes();
    vendors = buildInitialVendors();
    fieldDefinitions = buildInitialFieldDefinitions();

    if (resetUsers) {
      users.length = 0;
      users.push(...buildDefaultUsers());
      applyHierarchySyncDefaults(users);

      // Reseeding always produces the same fixed demo user set — clear the
      // table first (not just upsert) so any previously-persisted user that
      // isn't part of that set doesn't linger as an orphan.
      try {
        await clearUsersInDb();
        await syncUsersToDb(users);
      } catch (err) {
        console.error('[db] Could not persist reseeded users to Postgres:', err);
      }
    }

    const rDate = (daysAgo: number) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString();
    };

    // Seeds a delegation already in the Active state (pre-accepted), so demo
    // data doesn't require someone to manually click Accept after every
    // reset. Looked up by id, not array position - buildDefaultUsers() has
    // been reordered before and a positional index silently pointed at the
    // wrong user (Noah) the last time this drifted.
    const seedAcceptedDelegation = (approverId: string, delegateId: string, startDate: string, endDate: string) => {
      const approver = users.find(u => u.id === approverId);
      const delegate = users.find(u => u.id === delegateId);
      if (!approver || !delegate) return;
      const id = uuidv4();
      const createdAt = rDate(15);
      delegations.push({
        id,
        approver_id: approverId,
        delegate_id: delegateId,
        start_date: startDate,
        end_date: endDate,
        status: DelegationStatus.ACTIVE,
        created_by: approverId,
        created_at: createdAt,
        updated_at: createdAt
      });
      addDelegationHistory(id, '', DelegationStatus.PENDING, approverId, `Delegation requested to ${delegate.name}`);
      addDelegationHistory(id, DelegationStatus.PENDING, DelegationStatus.ACTIVE, delegateId, 'Delegation accepted');
    };

    if (options.delegations) {
      // Bob has an active delegation to Grace (covers "today", so auto-routing is demoable live).
      const activeDelegationStart = rDate(2).split('T')[0];
      const activeDelegationEnd = rDate(-5).split('T')[0];
      seedAcceptedDelegation('u2', 'u7', activeDelegationStart, activeDelegationEnd);

      // Henry has a delegation to Bob that already ended 2 days ago - demonstrates
      // the lazy Active -> Expired transition the first time delegations are read.
      const expiredStart = rDate(10).split('T')[0];
      const expiredEnd = rDate(2).split('T')[0];
      seedAcceptedDelegation('u8', 'u2', expiredStart, expiredEnd);
    }

    let seedCounter = 123;
    const nextClaimNumber = () => `REIM-${new Date().getFullYear()}-${String(seedCounter++).padStart(6, '0')}`;

    // Rotation pools so no two MOMs read as copy-pasted from one another.
    const CONTACTS = ['Maria Santos', 'Carlos Dela Cruz', 'Angela Reyes', 'Ramon Villanueva', 'Patricia Lim'];
    const PURPOSES = ['Sales and Partnership Discussion', 'Contract Renewal Discussion', 'Pilot Program Scoping', 'Marketing Collaboration Discussion', 'Accounts Receivable Follow-up'];
    const DISCUSSIONS = [
      (c: string) => `Reviewed Q3 procurement goals with ${c}. Presented our updated product catalog and volume-based discount tiers.`,
      (c: string) => `Discussed renewal terms for ${c}'s existing service contract and walked through proposed SLA improvements.`,
      (c: string) => `Conducted a needs-assessment session with ${c} to scope a potential pilot rollout across their Metro Manila branches.`,
      (c: string) => `Presented Q4 marketing collaboration opportunities to ${c} and gathered feedback on co-branded campaign concepts.`,
      (c: string) => `Followed up with ${c} on outstanding invoices and negotiated a revised payment schedule for the current quarter.`,
    ];
    const AGREEMENTS = [
      'Client agreed to a trial order of 100 units; we agreed to draft a custom pricing proposal within the week.',
      'Both parties agreed to a 6-month contract extension at current rates, pending legal review.',
      'Client approved a 2-branch pilot starting next month; we agreed to provide onsite training support.',
      'Client agreed to feature our product in their Q4 campaign in exchange for co-marketing budget support.',
      'Client committed to settling 50% of the balance by month-end, with the remainder due in 30 days.',
    ];
    const ACTION_ITEMS = [
      '1. Send pricing proposal\n2. Send trial contract guidelines',
      '1. Draft renewal contract addendum\n2. Schedule legal review',
      '1. Confirm pilot branch list\n2. Schedule onsite training dates',
      '1. Share co-marketing budget breakdown\n2. Draft campaign brief',
      '1. Send revised payment schedule\n2. Confirm receipt of partial payment',
    ];
    const LOCATIONS = ['Quezon City, Philippines', 'Makati City, Philippines', 'BGC, Taguig, Philippines', 'Cebu City, Philippines', 'Pasig City, Philippines'];
    const TIMES = ['09:00', '10:30', '13:00', '14:00', '15:30'];
    // Rotation pools covering every optional field the UI (MomDetail, the
    // dynamic field renderer) can display, so seeded records exercise those
    // paths instead of always rendering '-' / 'None listed'.
    const MEETING_TYPES = ['External', 'Internal', 'External', 'External', 'Internal'];
    const ACCOUNT_TYPES = ['Enterprise Client', 'SMB Client', 'Enterprise Client', 'Strategic Partner', 'SMB Client'];
    const CATEGORIES = ['Business Review', 'Pilot Discussion', 'Contract Renewal', 'Marketing Collaboration', 'Collections'];
    const INTERNAL_PARTICIPANT_POOL = ['Alice Reyes', 'Bob Santos', 'Ivy Salazar', 'Grace Navarro', 'Henry Castillo'];

    let momCursor = 0;
    const mkMom = (requestorId: string, client: string, status: MomStatus, daysAgo: number): Mom => {
      const idx = momCursor % 5;
      momCursor++;
      const actualClient = client && client.trim() !== '' ? client : 'SM Prime Holdings';
      const reqUser = users.find(u => u.id === requestorId);
      const contact = CONTACTS[idx];
      const [first, ...rest] = contact.split(' ');
      const last = rest[rest.length - 1] || first;
      const momDate = rDate(daysAgo);
      // Roughly 1 in 4 records are Letters of Agreement rather than plain
      // meeting minutes, so the Minutes & Agreements tab shows both types.
      const isLOA = momCursor % 4 === 0;
      const internalParticipants = Array.from(new Set([reqUser?.name, INTERNAL_PARTICIPANT_POOL[idx]].filter((n): n is string => !!n))).join(', ');
      const mom: Mom = {
        id: uuidv4(),
        requestor_id: requestorId,
        document_type: isLOA ? 'LOA' : 'MoM',
        client: actualClient,
        contact_person: contact,
        contact_person_email: `${first.toLowerCase()}.${last.toLowerCase()}@${actualClient.replace(/[^a-zA-Z]/g, '').toLowerCase()}.com`,
        meeting_date: momDate.split('T')[0],
        meeting_time: TIMES[idx],
        location: LOCATIONS[idx],
        purpose: PURPOSES[idx],
        discussion: DISCUSSIONS[idx](actualClient),
        agreements: AGREEMENTS[idx],
        action_items: ACTION_ITEMS[idx],
        prepared_by: reqUser?.name || 'Requestor',
        status,
        created_at: momDate,
        minutes_source: MinutesSource.TEMPLATE,
        meeting_type: MEETING_TYPES[idx],
        participants_internal: internalParticipants,
        participants_external: `${contact}${idx % 2 === 0 ? ', ' + CONTACTS[(idx + 1) % 5] : ''}`,
        custom_fields: { type_of_account: ACCOUNT_TYPES[idx], category: CATEGORIES[idx] },
      };
      getOrCreateCompanyInMemory(actualClient);
      moms.push(mom);
      return mom;
    };

    interface SeedClaimOpts {
      requestorId: string;
      approverId: string;
      mom: Mom;
      status: ClaimStatus;
      category: string;
      amount: number;
      createdDaysAgo: number;
      approvedDaysAgo?: number;
      processedDaysAgo?: number;
      releaseCode?: string;
      paymentMethod?: string;
      decisionOverride?: 'Approved' | 'Rejected' | 'Returned';
      approvalComment?: string;
      lineItems?: { vendor: string; category: string; amount: number; businessPurpose: string }[];
    }

    const mkClaim = (opts: SeedClaimOpts): Claim => {
      const claimId = uuidv4();
      const claimNumber = nextClaimNumber();
      const createdAt = rDate(opts.createdDaysAgo);

      opts.mom.claim_id = claimId;

      const items = opts.lineItems && opts.lineItems.length > 0
        ? opts.lineItems
        : [{ vendor: 'Max Restaurant', category: opts.category, amount: opts.amount, businessPurpose: `Reimbursement for client meeting with ${opts.mom.client}` }];

      items.forEach(item => {
        expenses.push({
          id: uuidv4(),
          claim_id: claimId,
          expense_date: opts.mom.meeting_date,
          vendor: item.vendor,
          category: item.category,
          amount: item.amount,
          payment_method: 'Cash',
          business_purpose: item.businessPurpose,
          receipt_url: '/receipt_placeholder.png',
          or_number: 'OR-' + Math.floor(10000 + Math.random() * 90000)
        });
      });

      const decision: 'Approved' | 'Rejected' | 'Returned' | undefined = opts.decisionOverride
        || ([ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED].includes(opts.status) ? 'Approved'
          : opts.status === ClaimStatus.REJECTED ? 'Rejected'
          : opts.status === ClaimStatus.RETURNED ? 'Returned'
          : undefined);

      const approvedAt = opts.approvedDaysAgo !== undefined ? rDate(opts.approvedDaysAgo) : createdAt;

      let currentApproverId = opts.approverId;
      const activeDelegationAtCreation = getActiveDelegation(opts.approverId, new Date(createdAt));
      if (activeDelegationAtCreation) {
        currentApproverId = activeDelegationAtCreation.delegate_id;
      }

      if (decision) {
        approvals.push({
          id: uuidv4(),
          claim_id: claimId,
          approver_id: currentApproverId,
          decision,
          comment: opts.approvalComment || (
            decision === 'Approved' ? 'Approved. Valid receipt attached and MOM summary completed.'
            : decision === 'Rejected' ? 'Rejected: Out-of-policy amount exceeded without pre-approval.'
            : 'Returned for Revision: Please upload a clearer receipt image showing the tax breakdown.'
          ),
          timestamp: approvedAt
        });
      }

      const isReleaseStage = [ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED].includes(opts.status);
      const processedAt = opts.processedDaysAgo !== undefined ? rDate(opts.processedDaysAgo) : approvedAt;
      const updatedAt = isReleaseStage ? processedAt : (decision ? approvedAt : createdAt);

      const claim: Claim = {
        id: claimId,
        claim_number: claimNumber,
        claim_type: 'Reimbursement',
        requestor_id: opts.requestorId,
        current_approver_id: currentApproverId,
        original_approver_id: opts.approverId,
        mom_id: opts.mom.id,
        status: opts.status,
        total_amount: opts.amount,
        approved_amount: decision === 'Approved' ? Math.min(opts.amount, REIMBURSEMENT_CAP) : undefined,
        paid_amount: isReleaseStage ? Math.min(opts.amount, REIMBURSEMENT_CAP) : undefined,
        expense_category: opts.category,
        receipt_url: '/receipt_placeholder.png',
        remarks: `Reimbursement for sales meeting with ${opts.mom.client} team.`,
        supporting_documents: 'Proposal_Draft_v1.pdf',
        release_code: isReleaseStage ? (opts.releaseCode || Math.random().toString(36).substring(2, 8).toUpperCase()) : undefined,
        // Only a still-outstanding (Ready for Claim) code needs an expiry —
        // give it one relative to processedAt so demo data never seeds an
        // already-expired code (see RELEASE_CODE_VALIDITY_DAYS).
        release_code_expires_at: opts.status === ClaimStatus.READY_FOR_CLAIM ? releaseCodeExpiryFrom(new Date(processedAt)) : undefined,
        payment_method: isReleaseStage ? 'Cash' : undefined,
        processed_by: isReleaseStage ? 'u3' : undefined,
        processing_date: isReleaseStage ? processedAt : undefined,
        approved_at: decision === 'Approved' ? approvedAt : undefined,
        created_at: createdAt,
        updated_at: updatedAt
      };

      claims.push(claim);

      const requestor = users.find(u => u.id === opts.requestorId);
      const approver = users.find(u => u.id === currentApproverId);
      const requestorName = requestor?.name || 'Requestor';
      const approverName = approver?.name || 'Approver';

      const comment = opts.approvalComment || (
        decision === 'Approved' ? 'Approved. Valid receipt attached and MOM summary completed.'
        : decision === 'Rejected' ? 'Rejected: Out-of-policy amount exceeded without pre-approval.'
        : 'Returned for Revision: Please upload a clearer receipt image showing the tax breakdown.'
      );

      // Status history chain
      statusHistories.push({
        id: uuidv4(),
        claim_id: claimId,
        old_status: '',
        new_status: ClaimStatus.DRAFT,
        changed_by: opts.requestorId,
        timestamp: createdAt
      });

      statusHistories.push({
        id: uuidv4(),
        claim_id: claimId,
        old_status: ClaimStatus.DRAFT,
        new_status: ClaimStatus.PENDING_APPROVAL,
        changed_by: opts.requestorId,
        timestamp: createdAt
      });

      // Submit Email
      sendEmail(
        currentApproverId,
        `Reimbursement Claim Submitted - ${claimNumber}`,
        `A reimbursement claim for PHP ${opts.amount} has been submitted by ${requestorName} for your approval.\n\nDescription: Reimbursement for sales meeting with ${opts.mom.client} team.`,
        undefined,
        { timestamp: createdAt }
      );

      if (opts.status !== ClaimStatus.PENDING_APPROVAL) {
        if (opts.status === ClaimStatus.RETURNED) {
          statusHistories.push({
            id: uuidv4(),
            claim_id: claimId,
            old_status: ClaimStatus.PENDING_APPROVAL,
            new_status: ClaimStatus.RETURNED,
            changed_by: currentApproverId,
            reason: comment,
            timestamp: approvedAt
          });
          sendEmail(
            opts.requestorId,
            `Reimbursement Claim Returned - ${claimNumber}`,
            `Your reimbursement claim has been returned by ${approverName} for revision.\n\nComment: ${comment}`,
            undefined,
            { timestamp: approvedAt }
          );
        } else if (opts.status === ClaimStatus.REJECTED) {
          statusHistories.push({
            id: uuidv4(),
            claim_id: claimId,
            old_status: ClaimStatus.PENDING_APPROVAL,
            new_status: ClaimStatus.REJECTED,
            changed_by: currentApproverId,
            reason: comment,
            timestamp: approvedAt
          });
          sendEmail(
            opts.requestorId,
            `Reimbursement Claim Rejected - ${claimNumber}`,
            `Your reimbursement claim has been rejected by ${approverName}.\n\nComment: ${comment}`,
            undefined,
            { timestamp: approvedAt }
          );
        } else {
          // APPROVED, PROCESSING, READY_FOR_CLAIM, COMPLETED
          statusHistories.push({
            id: uuidv4(),
            claim_id: claimId,
            old_status: ClaimStatus.PENDING_APPROVAL,
            new_status: ClaimStatus.APPROVED,
            changed_by: currentApproverId,
            reason: comment,
            timestamp: approvedAt
          });
          sendEmail(
            opts.requestorId,
            `Reimbursement Claim Approved - ${claimNumber}`,
            `Your reimbursement claim of PHP ${opts.amount} has been Approved by ${approverName} and routed to Finance.`,
            undefined,
            { timestamp: approvedAt }
          );

          // Mirrors the live /decide route: every custodian gets notified
          // once a claim is approved and lands in their processing queue.
          users.filter(u => u.role === UserRole.CUSTODIAN).forEach(custodian => {
            sendEmail(
              custodian.id,
              `Reimbursement Processing Required - ${claimNumber}`,
              `Reimbursement request ${claimNumber} submitted by ${requestorName} and approved by ${approverName} is now in your processing queue.\n\nRequired Action:\nPlease generate the Claim Code, release the payment, and mark it as Ready for Claim.`,
              undefined,
              { timestamp: approvedAt }
            );
          });

          if (opts.status !== ClaimStatus.APPROVED) {
            statusHistories.push({
              id: uuidv4(),
              claim_id: claimId,
              old_status: ClaimStatus.APPROVED,
              new_status: ClaimStatus.PROCESSING,
              changed_by: 'u3',
              timestamp: processedAt
            });
            sendEmail(
              opts.requestorId,
              `Reimbursement Processing Initiated - ${claimNumber}`,
              `Finance has begun preparing disbursement for your approved claim of PHP ${opts.amount}.`,
              undefined,
              { timestamp: processedAt }
            );

            if (opts.status !== ClaimStatus.PROCESSING) {
              if (opts.status === ClaimStatus.READY_FOR_CLAIM) {
                statusHistories.push({
                  id: uuidv4(),
                  claim_id: claimId,
                  old_status: ClaimStatus.PROCESSING,
                  new_status: ClaimStatus.READY_FOR_CLAIM,
                  changed_by: 'u3',
                  reason: 'Disbursement prepared; release code generated.',
                  timestamp: processedAt
                });
                sendEmail(
                  opts.requestorId,
                  `Reimbursement Ready to Claim - ${claimNumber}`,
                  `Your reimbursement of PHP ${opts.amount} is ready.\n\nEnter code ${claim.release_code} to confirm receipt and complete your claim.`,
                  undefined,
                  { timestamp: processedAt }
                );
              } else if (opts.status === ClaimStatus.COMPLETED) {
                statusHistories.push({
                  id: uuidv4(),
                  claim_id: claimId,
                  old_status: ClaimStatus.PROCESSING,
                  new_status: ClaimStatus.COMPLETED,
                  changed_by: 'u3',
                  reason: 'Funds successfully released to Requestor.',
                  timestamp: processedAt
                });
                sendEmail(
                  opts.requestorId,
                  `Reimbursement Completed - ${claimNumber}`,
                  `Your reimbursement of PHP ${opts.amount} has been successfully paid out via ${claim.payment_method || 'Cash'}.`,
                  undefined,
                  { timestamp: processedAt }
                );
              }
            }
          }
        }
      }

      return claim;
    };

    // Standard live-workflow seed records
    if (options.demoClaims) {
    // 1. Claim 1: Draft - Alice Reyes
    const mom1 = mkMom('u1', 'Ayala Land Inc', MomStatus.COMPLETED, 3);
    const claim1Id = uuidv4();
    const claim1Number = nextClaimNumber();
    mom1.claim_id = claim1Id;
    claims.push({
      id: claim1Id,
      claim_number: claim1Number,
      requestor_id: 'u1',
      current_approver_id: 'u2',
      original_approver_id: 'u2',
      mom_id: mom1.id,
      status: ClaimStatus.DRAFT,
      total_amount: 920.00,
      expense_category: 'Client Meals',
      receipt_url: '/receipt_placeholder.png',
      remarks: 'Dinner meeting with Ayala Land procurement team to discuss Q3 targets.',
      supporting_documents: 'Ayala_Agenda_v1.pdf',
      created_at: rDate(2),
      updated_at: rDate(2)
    });
    expenses.push({
      id: uuidv4(),
      claim_id: claim1Id,
      expense_date: mom1.meeting_date,
      vendor: 'Max Restaurant',
      category: 'Client Meals',
      amount: 920.00,
      payment_method: 'Cash',
      business_purpose: 'Group dinner with Ayala Land procurement staff.',
      receipt_url: '/receipt_placeholder.png'
    });
    statusHistories.push({
      id: uuidv4(),
      claim_id: claim1Id,
      old_status: '',
      new_status: ClaimStatus.DRAFT,
      changed_by: 'u1',
      timestamp: rDate(2)
    });

    // 2. Claim 2: Pending Approval - Alice Reyes
    const mom2 = mkMom('u1', 'SM Prime Holdings', MomStatus.COMPLETED, 4);
    mkClaim({
      requestorId: 'u1',
      approverId: 'u2',
      mom: mom2,
      status: ClaimStatus.PENDING_APPROVAL,
      category: 'Transportation',
      amount: 980.00,
      createdDaysAgo: 3
    });

    // 3. Claim 3: Returned for Revision - Eve Garcia
    const mom3 = mkMom('u5', 'JG Summit', MomStatus.COMPLETED, 6);
    mkClaim({
      requestorId: 'u5',
      approverId: 'u2',
      mom: mom3,
      status: ClaimStatus.RETURNED,
      category: 'Accommodation',
      amount: 1150.00,
      createdDaysAgo: 5,
      approvedDaysAgo: 4
    });

    // 4. Claim 4: Approved (Routed to Finance) - Eve Garcia
    const mom4 = mkMom('u5', 'Aboitiz Equity', MomStatus.COMPLETED, 5);
    mkClaim({
      requestorId: 'u5',
      approverId: 'u2',
      mom: mom4,
      status: ClaimStatus.APPROVED,
      category: 'Transportation',
      amount: 990.00,
      createdDaysAgo: 4,
      approvedDaysAgo: 3
    });

    // 5. Claim 5: Processing (In Finance Queue) - Frank Mendoza
    const mom5 = mkMom('u6', 'San Miguel Corp', MomStatus.COMPLETED, 7);
    mkClaim({
      requestorId: 'u6',
      approverId: 'u2',
      mom: mom5,
      status: ClaimStatus.PROCESSING,
      category: 'Client Meals',
      amount: 1250.00,
      createdDaysAgo: 6,
      approvedDaysAgo: 5,
      processedDaysAgo: 4
    });

    // 6. Claim 6: Ready for Claim (Awaiting Code Entry) - Frank Mendoza
    const mom6 = mkMom('u6', 'Megaworld Corp', MomStatus.COMPLETED, 8);
    mkClaim({
      requestorId: 'u6',
      approverId: 'u2',
      mom: mom6,
      status: ClaimStatus.READY_FOR_CLAIM,
      category: 'Client Meals',
      amount: 950.00,
      createdDaysAgo: 7,
      approvedDaysAgo: 6,
      processedDaysAgo: 5,
      releaseCode: 'CLAIM99'
    });

    // 7. Claim 7: Completed (Paid Out) - Frank Mendoza
    const mom7 = mkMom('u6', 'Robinsons Land', MomStatus.COMPLETED, 10);
    mkClaim({
      requestorId: 'u6',
      approverId: 'u2',
      mom: mom7,
      status: ClaimStatus.COMPLETED,
      category: 'Transportation',
      amount: 1450.00,
      createdDaysAgo: 9,
      approvedDaysAgo: 8,
      processedDaysAgo: 7,
      releaseCode: 'PAID777',
      paymentMethod: 'Cash'
    });

    // 8. Claim 8: Rejected - Alice Reyes
    const mom8 = mkMom('u1', 'BDO Unibank', MomStatus.COMPLETED, 12);
    mkClaim({
      requestorId: 'u1',
      approverId: 'u2',
      mom: mom8,
      status: ClaimStatus.REJECTED,
      category: 'Entertainment',
      amount: 1600.00,
      createdDaysAgo: 11,
      approvedDaysAgo: 10
    });

    // Standalone MOMs
    mkMom('u1', 'Ayala Land Inc', MomStatus.DRAFT, 2);
    mkMom('u5', 'Metrobank', MomStatus.COMPLETED, 1);
    }

    // Cash Advance & Liquidation Seed Records helpers
    const addCaHistoryWithTimestamp = (caId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string, timestamp?: string) => {
      statusHistories.push({
        id: uuidv4(),
        claim_id: '',
        cash_advance_id: caId,
        old_status: oldStatus,
        new_status: newStatus,
        changed_by: changedBy,
        reason,
        timestamp: timestamp || new Date().toISOString()
      });
    };

    const addLiqHistoryWithTimestamp = (liqId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string, timestamp?: string) => {
      statusHistories.push({
        id: uuidv4(),
        claim_id: '',
        liquidation_id: liqId,
        old_status: oldStatus,
        new_status: newStatus,
        changed_by: changedBy,
        reason,
        timestamp: timestamp || new Date().toISOString()
      });
    };

    if (options.demoCashAdvances) {
    // 1. Standalone Cash Advances
    const ca1Id = uuidv4();
    cashAdvances.push({
      id: ca1Id,
      requestorId: 'u1',
      amount: 3500.00,
      purpose: 'Client Lunch - Rockwell',
      approverId: 'u2',
      status: CashAdvanceStatus.DRAFT,
      createdAt: rDate(1),
    });
    addCaHistoryWithTimestamp(ca1Id, '', CashAdvanceStatus.DRAFT, 'u1', 'Draft created', rDate(1));

    const ca2Id = uuidv4();
    cashAdvances.push({
      id: ca2Id,
      requestorId: 'u5',
      amount: 5000.00,
      purpose: 'Business transportation to Cebu',
      approverId: 'u2',
      status: CashAdvanceStatus.SUBMITTED,
      createdAt: rDate(3),
    });
    addCaHistoryWithTimestamp(ca2Id, '', CashAdvanceStatus.DRAFT, 'u5', 'Draft created', rDate(3));
    addCaHistoryWithTimestamp(ca2Id, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, 'u5', 'Submitted for Approval', rDate(2));
    sendEmail(
      'u2',
      `Cash Advance Request Submitted - CADV-${ca2Id.substring(0,6)}`,
      `A Cash Advance request for PHP 5000 has been submitted by Eve Garcia for your approval.\n\nPurpose: Business transportation to Cebu`,
      undefined,
      { timestamp: rDate(2) }
    );

    const ca3Id = uuidv4();
    cashAdvances.push({
      id: ca3Id,
      requestorId: 'u6',
      amount: 7500.00,
      purpose: 'Client Entertainment - BGC',
      approverId: 'u2',
      status: CashAdvanceStatus.APPROVED,
      createdAt: rDate(4),
    });
    addCaHistoryWithTimestamp(ca3Id, '', CashAdvanceStatus.DRAFT, 'u6', 'Draft created', rDate(4));
    addCaHistoryWithTimestamp(ca3Id, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, 'u6', 'Submitted for Approval', rDate(3));
    sendEmail(
      'u2',
      `Cash Advance Request Submitted - CADV-${ca3Id.substring(0,6)}`,
      `A Cash Advance request for PHP 7500 has been submitted by Frank Mendoza for your approval.\n\nPurpose: Client Entertainment - BGC`,
      undefined,
      { timestamp: rDate(3) }
    );
    addCaHistoryWithTimestamp(ca3Id, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.APPROVED, 'u2', 'Approved', rDate(2));
    sendEmail(
      'u6',
      `Cash Advance Request Approved - CADV-${ca3Id.substring(0,6)}`,
      `Your Cash Advance request for PHP 7500 has been Approved by Bob Santos.`,
      undefined,
      { timestamp: rDate(2) }
    );

    const ca4Id = uuidv4();
    cashAdvances.push({
      id: ca4Id,
      requestorId: 'u11',
      amount: 12000.00,
      purpose: 'Team Building Advance',
      approverId: 'u10',
      status: CashAdvanceStatus.REJECTED,
      createdAt: rDate(5),
    });
    addCaHistoryWithTimestamp(ca4Id, '', CashAdvanceStatus.DRAFT, 'u11', 'Draft created', rDate(5));
    addCaHistoryWithTimestamp(ca4Id, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, 'u11', 'Submitted for Approval', rDate(4));
    sendEmail(
      'u10',
      `Cash Advance Request Submitted - CADV-${ca4Id.substring(0,6)}`,
      `A Cash Advance request for PHP 12000 has been submitted by Kyle Ocampo for your approval.\n\nPurpose: Team Building Advance`,
      undefined,
      { timestamp: rDate(4) }
    );
    addCaHistoryWithTimestamp(ca4Id, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.REJECTED, 'u10', 'Rejected due to budget constraints', rDate(3));
    sendEmail(
      'u11',
      `Cash Advance Request Rejected - CADV-${ca4Id.substring(0,6)}`,
      `Your Cash Advance request for PHP 12000 has been Rejected by Jack Herrera.\n\nComment: Rejected due to budget constraints`,
      undefined,
      { timestamp: rDate(3) }
    );

    const ca5Id = uuidv4();
    cashAdvances.push({
      id: ca5Id,
      requestorId: 'u12',
      amount: 6000.00,
      purpose: 'Field surveys',
      approverId: 'u10',
      status: CashAdvanceStatus.RELEASED,
      releasedBy: 'u3',
      releaseDate: rDate(2),
      releaseReference: 'REF-LIAM-CA',
      createdAt: rDate(5),
    });
    addCaHistoryWithTimestamp(ca5Id, '', CashAdvanceStatus.DRAFT, 'u12', 'Draft created', rDate(5));
    addCaHistoryWithTimestamp(ca5Id, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, 'u12', 'Submitted for Approval', rDate(4));
    sendEmail(
      'u10',
      `Cash Advance Request Submitted - CADV-${ca5Id.substring(0,6)}`,
      `A Cash Advance request for PHP 6000 has been submitted by Liam Villareal for your approval.\n\nPurpose: Field surveys`,
      undefined,
      { timestamp: rDate(4) }
    );
    addCaHistoryWithTimestamp(ca5Id, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.APPROVED, 'u10', 'Approved', rDate(3));
    sendEmail(
      'u12',
      `Cash Advance Request Approved - CADV-${ca5Id.substring(0,6)}`,
      `Your Cash Advance request for PHP 6000 has been Approved by Jack Herrera.`,
      undefined,
      { timestamp: rDate(3) }
    );
    addCaHistoryWithTimestamp(ca5Id, CashAdvanceStatus.APPROVED, CashAdvanceStatus.RELEASED, 'u3', 'Funds released', rDate(2));
    sendEmail(
      'u12',
      `Cash Advance Released - CADV-${ca5Id.substring(0,6)}`,
      `Your Cash Advance for PHP 6000 has been released by Carol Ramos.\n\nRelease Reference: REF-LIAM-CA\n\nPlease file your liquidation within 7 days.`,
      undefined,
      { timestamp: rDate(2) }
    );

    // 2. Cash Advances with Liquidations in different stages
    const ca6Id = uuidv4();
    cashAdvances.push({
      id: ca6Id,
      requestorId: 'u12',
      amount: 6000.00,
      purpose: 'Field survey Liam',
      approverId: 'u10',
      status: CashAdvanceStatus.RELEASED,
      releasedBy: 'u3',
      releaseDate: rDate(3),
      releaseReference: 'REF-LIAM-SURVEY',
      createdAt: rDate(6),
    });
    addCaHistoryWithTimestamp(ca6Id, '', CashAdvanceStatus.DRAFT, 'u12', 'Draft created', rDate(6));
    addCaHistoryWithTimestamp(ca6Id, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, 'u12', 'Submitted for Approval', rDate(5));
    sendEmail(
      'u10',
      `Cash Advance Request Submitted - CADV-${ca6Id.substring(0,6)}`,
      `A Cash Advance request for PHP 6000 has been submitted by Liam Villareal for your approval.\n\nPurpose: Field survey Liam`,
      undefined,
      { timestamp: rDate(5) }
    );
    addCaHistoryWithTimestamp(ca6Id, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.APPROVED, 'u10', 'Approved', rDate(4));
    sendEmail(
      'u12',
      `Cash Advance Request Approved - CADV-${ca6Id.substring(0,6)}`,
      `Your Cash Advance request for PHP 6000 has been Approved by Jack Herrera.`,
      undefined,
      { timestamp: rDate(4) }
    );
    addCaHistoryWithTimestamp(ca6Id, CashAdvanceStatus.APPROVED, CashAdvanceStatus.RELEASED, 'u3', 'Funds released', rDate(3));
    sendEmail(
      'u12',
      `Cash Advance Released - CADV-${ca6Id.substring(0,6)}`,
      `Your Cash Advance for PHP 6000 has been released by Carol Ramos.\n\nRelease Reference: REF-LIAM-SURVEY\n\nPlease file your liquidation within 7 days.`,
      undefined,
      { timestamp: rDate(3) }
    );

    const liq1Id = uuidv4();
    liquidations.push({
      id: liq1Id,
      cashAdvanceId: ca6Id,
      requestorId: 'u12',
      totalSpent: 0,
      varianceAmount: -6000.00,
      varianceType: LiquidationVarianceType.REFUND_DUE,
      status: LiquidationStatus.DRAFT,
      createdAt: rDate(2),
    });
    addCaHistoryWithTimestamp(ca6Id, CashAdvanceStatus.RELEASED, CashAdvanceStatus.RELEASED, 'u12', 'Liquidation Started', rDate(2));
    addLiqHistoryWithTimestamp(liq1Id, '', LiquidationStatus.DRAFT, 'u12', 'Draft Liquidation started', rDate(2));

    // Submitted Liquidation
    const ca7Id = uuidv4();
    const ca7Mom = mkMom('u1', 'Maxs Restaurant Corp', MomStatus.COMPLETED, 4);
    cashAdvances.push({
      id: ca7Id,
      requestorId: 'u1',
      amount: 5000.00,
      purpose: "Max's Group Lunch",
      momId: ca7Mom.id,
      approverId: 'u2',
      status: CashAdvanceStatus.RELEASED,
      releasedBy: 'u3',
      releaseDate: rDate(4),
      releaseReference: 'REF-ALICE-MAXS',
      createdAt: rDate(7),
    });
    addCaHistoryWithTimestamp(ca7Id, '', CashAdvanceStatus.DRAFT, 'u1', 'Draft created', rDate(7));
    addCaHistoryWithTimestamp(ca7Id, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, 'u1', 'Submitted for Approval', rDate(6));
    sendEmail(
      'u2',
      `Cash Advance Request Submitted - CADV-${ca7Id.substring(0,6)}`,
      `A Cash Advance request for PHP 5000 has been submitted by Alice Reyes for your approval.\n\nPurpose: Max's Group Lunch`,
      undefined,
      { timestamp: rDate(6) }
    );
    addCaHistoryWithTimestamp(ca7Id, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.APPROVED, 'u2', 'Approved', rDate(5));
    sendEmail(
      'u1',
      `Cash Advance Request Approved - CADV-${ca7Id.substring(0,6)}`,
      `Your Cash Advance request for PHP 5000 has been Approved by Bob Santos.`,
      undefined,
      { timestamp: rDate(5) }
    );
    addCaHistoryWithTimestamp(ca7Id, CashAdvanceStatus.APPROVED, CashAdvanceStatus.RELEASED, 'u3', 'Funds released', rDate(4));
    sendEmail(
      'u1',
      `Cash Advance Released - CADV-${ca7Id.substring(0,6)}`,
      `Your Cash Advance for PHP 5000 has been released by Carol Ramos.\n\nRelease Reference: REF-ALICE-MAXS\n\nPlease file your liquidation within 7 days.`,
      undefined,
      { timestamp: rDate(4) }
    );

    const liq2Id = uuidv4();
    liquidations.push({
      id: liq2Id,
      cashAdvanceId: ca7Id,
      requestorId: 'u1',
      totalSpent: 5000.00,
      varianceAmount: 0.00,
      varianceType: LiquidationVarianceType.SETTLED,
      status: LiquidationStatus.SUBMITTED,
      createdAt: rDate(3),
    });
    liquidationLineItems.push({
      id: uuidv4(),
      liquidationId: liq2Id,
      expense_date: ca7Mom.meeting_date,
      vendor: "Max's Restaurant",
      category: 'Client Meals',
      amount: 5000.00,
      payment_method: 'Cash',
      business_purpose: 'Lunch meeting with Maxs executive team',
      receipt_url: '/receipt_placeholder.png'
    });
    addCaHistoryWithTimestamp(ca7Id, CashAdvanceStatus.RELEASED, CashAdvanceStatus.RELEASED, 'u1', 'Liquidation Started', rDate(3));
    addCaHistoryWithTimestamp(ca7Id, CashAdvanceStatus.RELEASED, CashAdvanceStatus.RELEASED, 'u1', 'Liquidation Submitted', rDate(3));
    addLiqHistoryWithTimestamp(liq2Id, '', LiquidationStatus.DRAFT, 'u1', 'Draft Liquidation started', rDate(3));
    addLiqHistoryWithTimestamp(liq2Id, LiquidationStatus.DRAFT, LiquidationStatus.SUBMITTED, 'u1', 'Liquidation submitted for review', rDate(3));
    sendEmail(
      'u2',
      `Liquidation Submitted - LIQ-${liq2Id.substring(0,6)}`,
      `A Liquidation report has been submitted by Alice Reyes for Cash Advance CADV-${ca7Id.substring(0,6)}.\n\nTotal Spent: PHP 5000\nVariance: PHP 0 (SETTLED)`,
      undefined,
      { timestamp: rDate(3) }
    );
    }

    // --- Additional seeds for other departments ---
    const mkMomAndClaim = (reqId: string, appId: string, category: string, amt: number, status: ClaimStatus, daysAgo: number) => {
      const momId = uuidv4();
      const mom = {
        id: momId,
        requestor_id: reqId,
        client: 'Internal / Partner',
        client_name: 'Internal / Partner',
        contact_person: 'Partner Contact',
        meeting_date: rDate(daysAgo),
        minutes_source: MinutesSource.TEMPLATE,
        meeting_type: 'In-person',
        purpose: 'Departmental sync',
        discussion: 'Regular departmental meeting.',
        action_items: 'None',
        status: MomStatus.COMPLETED,
        created_at: rDate(daysAgo)
      };
      getOrCreateCompanyInMemory(mom.client);
      moms.push(mom);
      mkClaim({
        requestorId: reqId,
        approverId: appId,
        mom,
        status,
        category,
        amount: amt,
        createdDaysAgo: daysAgo,
        approvedDaysAgo: daysAgo > 2 ? daysAgo - 1 : undefined,
        processedDaysAgo: daysAgo > 3 ? daysAgo - 2 : undefined
      });
    };

    const mkCa = (reqId: string, appId: string, amt: number, purpose: string, status: CashAdvanceStatus, days: number) => {
      const caId = uuidv4();
      const createdDate = rDate(days + 1);
      const ca: CashAdvance = {
        id: caId,
        requestorId: reqId,
        amount: amt,
        purpose,
        approverId: appId,
        status,
        createdAt: createdDate,
      };
      cashAdvances.push(ca);

      const reqUser = users.find(u => u.id === reqId);
      const reqName = reqUser?.name || 'Requestor';
      const appUser = users.find(u => u.id === appId);
      const appName = appUser?.name || 'Approver';

      const actionDate = rDate(days);

      addCaHistoryWithTimestamp(caId, '', CashAdvanceStatus.DRAFT, reqId, 'Draft created', createdDate);

      if (status !== CashAdvanceStatus.DRAFT) {
        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, reqId, 'Submitted for Approval', createdDate);
        
        const subSubject = `Cash Advance Request Submitted - CADV-${caId.substring(0,6)}`;
        const subBody = `A Cash Advance request for PHP ${amt} has been submitted by ${reqName} for your approval.\n\nPurpose: ${purpose}`;
        sendEmail(appId, subSubject, subBody, undefined, { timestamp: createdDate });
      }

      if (status === CashAdvanceStatus.APPROVED || status === CashAdvanceStatus.RELEASED) {
        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.APPROVED, appId, 'Approved', actionDate);

        const appSubject = `Cash Advance Request Approved - CADV-${caId.substring(0,6)}`;
        const appBody = `Your Cash Advance request for PHP ${amt} has been Approved by ${appName}.`;
        sendEmail(reqId, appSubject, appBody, undefined, { timestamp: actionDate });
      } else if (status === CashAdvanceStatus.REJECTED) {
        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.REJECTED, appId, 'Rejected due to policy limit', actionDate);

        const rejSubject = `Cash Advance Request Rejected - CADV-${caId.substring(0,6)}`;
        const rejBody = `Your Cash Advance request for PHP ${amt} has been Rejected by ${appName}.\n\nComment: Rejected due to policy limit`;
        sendEmail(reqId, rejSubject, rejBody, undefined, { timestamp: actionDate });
      }

      if (status === CashAdvanceStatus.RELEASED) {
        ca.releasedBy = 'u3';
        ca.releaseDate = actionDate;
        ca.releaseReference = `REF-${reqId.toUpperCase()}-${caId.substring(0,4).toUpperCase()}`;
        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.APPROVED, CashAdvanceStatus.RELEASED, 'u3', 'Funds released', actionDate);

        const relSubject = `Cash Advance Released - CADV-${caId.substring(0,6)}`;
        const relBody = `Your Cash Advance for PHP ${amt} has been released by Carol Ramos.\n\nRelease Reference: ${ca.releaseReference}\n\nPlease file your liquidation within 7 days.`;
        sendEmail(reqId, relSubject, relBody, undefined, { timestamp: actionDate });
      }
    };

    // Standard items
    if (options.demoClaims) {
    mkMomAndClaim('u13', 'u14', 'Marketing Materials', 15000, ClaimStatus.COMPLETED, 15);
    mkMomAndClaim('u13', 'u14', 'Event Hosting', 25000, ClaimStatus.PENDING_APPROVAL, 2);
    mkMomAndClaim('u15', 'u16', 'Software Licenses', 8500, ClaimStatus.PROCESSING, 5);
    mkMomAndClaim('u15', 'u16', 'Cloud Hosting', 1250, ClaimStatus.COMPLETED, 20);
    mkMomAndClaim('u15', 'u16', 'Team Lunch', 980, ClaimStatus.REJECTED, 3);
    // Guarantees the default demo login (Olivia, u15) always has a payout to
    // test the release-code confirm flow with, without hunting through seed data.
    mkMomAndClaim('u15', 'u16', 'Client Meals', 990, ClaimStatus.READY_FOR_CLAIM, 6);
    mkMomAndClaim('u17', 'u18', 'Office Supplies', 1100, ClaimStatus.READY_FOR_CLAIM, 7);
    mkMomAndClaim('u17', 'u18', 'Equipment Repair', 1350, ClaimStatus.COMPLETED, 12);
    // A few more still-undecided claims, spread across different approvers,
    // so there's real material for upcoming (not-yet-happened) review
    // meetings below -- otherwise almost nothing in this seed is still
    // awaiting a decision and the Calendar's current month looks empty.
    mkMomAndClaim('u1', 'u2', 'Client Meals', 950, ClaimStatus.PENDING_APPROVAL, 1);
    mkMomAndClaim('u6', 'u2', 'Transportation', 1250, ClaimStatus.PENDING_APPROVAL, 2);
    mkMomAndClaim('u11', 'u10', 'Transportation', 875, ClaimStatus.PENDING_APPROVAL, 3);
    mkMomAndClaim('u20', 'u14', 'Event Hosting', 1400, ClaimStatus.PENDING_APPROVAL, 1);
    }

    if (options.demoCashAdvances) {
    mkCa('u13', 'u14', 10000, 'Upcoming Expo', CashAdvanceStatus.APPROVED, 3);
    mkCa('u15', 'u16', 5000, 'Server Migration Overtime Food', CashAdvanceStatus.RELEASED, 4);
    mkCa('u17', 'u18', 20000, 'Facility Maintenance Deposit', CashAdvanceStatus.SUBMITTED, 1);
    }

    // ==========================================
    // HISTORICAL BACKFILL FOR THE PAST 12 MONTHS
    // ==========================================
    if (options.historicalBackfill) {
    const departments = [
      {
        name: 'Sales',
        requestors: ['u1', 'u5', 'u6', 'u11', 'u12'],
        approvers: ['u2', 'u7', 'u8', 'u10'],
        categories: ['Client Meals', 'Accommodation', 'Transportation'],
        vendors: ['Max Restaurant', 'Grab', 'Makati Diamond Residences', 'Mary Grace Cafe', 'Globe Telecom'],
        clients: ['SM Prime Holdings', 'PLDT Inc', 'Jollibee Foods Corp', 'Bank of the Philippine Islands', 'Globe Telecom', 'San Miguel Corporation', 'Meralco', 'BDO Unibank']
      },
      {
        name: 'Marketing',
        requestors: ['u13', 'u20', 'u21'],
        approvers: ['u14'],
        categories: ['Marketing Materials', 'Event Hosting', 'Advertising', 'Client Meals'],
        vendors: ['Print Central', 'Hotel Del Rio', 'Facebook Ads', 'Google Ads', 'Starbucks'],
        clients: ['Creative Agency', 'Partner Promo Group', 'Media Corp']
      },
      {
        name: 'Engineering',
        requestors: ['u15'],
        approvers: ['u16'],
        categories: ['Software Licenses', 'Cloud Hosting', 'Team Lunch', 'Technical Training'],
        vendors: ['Amazon Web Services', 'Microsoft Azure', 'Atlassian', 'JetBrains', 'GrabFood'],
        clients: ['Internal Operations', 'Beta Testing Corp', 'DevOps Consultants']
      },
      {
        name: 'Operations',
        requestors: ['u17'],
        approvers: ['u18'],
        categories: ['Office Supplies', 'Equipment Repair', 'Courier Services', 'Utility Bills'],
        vendors: ['National Bookstore', 'Lalamove', 'Meralco Office', 'PLDT Enterprise', 'Tech Support PH'],
        clients: ['Headquarters', 'Cebu Branch Office', 'Manila Warehouse']
      }
    ];

    const getDaysAgo = (year: number, month: number, day: number) => {
      const target = new Date(year, month - 1, day, 12, 0, 0);
      const now = new Date();
      const nowNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
      const diffMs = nowNoon.getTime() - target.getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    };

    const mkHistoricalCa = (
      reqId: string,
      appId: string,
      amt: number,
      purpose: string,
      status: CashAdvanceStatus,
      daysAgoCreated: number,
      isCompleted: boolean,
      category: string,
      vendor: string,
      client: string
    ) => {
      const caId = uuidv4();
      const createdDate = rDate(daysAgoCreated);
      const ca: CashAdvance = {
        id: caId,
        requestorId: reqId,
        amount: amt,
        purpose,
        approverId: appId,
        status,
        createdAt: createdDate,
      };
      cashAdvances.push(ca);

      const reqUser = users.find(u => u.id === reqId);
      const reqName = reqUser?.name || 'Requestor';
      const appUser = users.find(u => u.id === appId);
      const appName = appUser?.name || 'Approver';

      
      // Draft
      addCaHistoryWithTimestamp(caId, '', CashAdvanceStatus.DRAFT, reqId, 'Draft created', createdDate);

      // Submitted
      addCaHistoryWithTimestamp(caId, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, reqId, 'Submitted for Approval', createdDate);
      const subSubject = `Cash Advance Request Submitted - CADV-${caId.substring(0,6)}`;
      const subBody = `A Cash Advance request for PHP ${amt} has been submitted by ${reqName} for your approval.\n\nPurpose: ${purpose}`;
      sendEmail(appId, subSubject, subBody, undefined, { timestamp: createdDate });

      const approvedDaysAgo = daysAgoCreated - (1 + Math.floor(Math.random() * 2));
      const approvedDate = rDate(approvedDaysAgo);

      if (status === CashAdvanceStatus.REJECTED) {
        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.REJECTED, appId, 'Rejected due to budget constraints', approvedDate);
        const rejSubject = `Cash Advance Request Rejected - CADV-${caId.substring(0,6)}`;
        const rejBody = `Your Cash Advance request for PHP ${amt} has been Rejected by ${appName}.\n\nComment: Rejected due to budget constraints`;
        sendEmail(reqId, rejSubject, rejBody, undefined, { timestamp: approvedDate });
        return;
      }

      // Approved
      addCaHistoryWithTimestamp(caId, CashAdvanceStatus.SUBMITTED, CashAdvanceStatus.APPROVED, appId, 'Approved', approvedDate);
      const appSubject = `Cash Advance Request Approved - CADV-${caId.substring(0,6)}`;
      const appBody = `Your Cash Advance request for PHP ${amt} has been Approved by ${appName}.`;
      sendEmail(reqId, appSubject, appBody, undefined, { timestamp: approvedDate });

      // Released
      const releasedDaysAgo = approvedDaysAgo - (1 + Math.floor(Math.random() * 2));
      const releasedDate = rDate(releasedDaysAgo);
      
      ca.releasedBy = 'u3';
      ca.releaseDate = releasedDate;
      ca.releaseReference = `REF-${reqId.toUpperCase()}-${caId.substring(0,4).toUpperCase()}`;
      addCaHistoryWithTimestamp(caId, CashAdvanceStatus.APPROVED, CashAdvanceStatus.RELEASED, 'u3', 'Funds released', releasedDate);

      const relSubject = `Cash Advance Released - CADV-${caId.substring(0,6)}`;
      const relBody = `Your Cash Advance for PHP ${amt} has been released by Carol Ramos.\n\nRelease Reference: ${ca.releaseReference}\n\nPlease file your liquidation within 7 days.`;
      sendEmail(reqId, relSubject, relBody, undefined, { timestamp: releasedDate });

      // Liquidation
      if (status === CashAdvanceStatus.LIQUIDATED) {
        const liqStartedDaysAgo = releasedDaysAgo - (1 + Math.floor(Math.random() * 2));
        const liqStartedDate = rDate(liqStartedDaysAgo);

        const liqSubmittedDaysAgo = liqStartedDaysAgo - (1 + Math.floor(Math.random() * 2));
        const liqSubmittedDate = rDate(liqSubmittedDaysAgo);

        const liqClosedDaysAgo = liqSubmittedDaysAgo - (1 + Math.floor(Math.random() * 2));
        const liqClosedDate = rDate(liqClosedDaysAgo);

        const liqId = uuidv4();
        const totalSpent = amt;
        
        liquidations.push({
          id: liqId,
          cashAdvanceId: caId,
          requestorId: reqId,
          totalSpent,
          varianceAmount: 0.00,
          varianceType: LiquidationVarianceType.SETTLED,
          status: LiquidationStatus.CLOSED,
      createdAt: liqStartedDate,
        });

        liquidationLineItems.push({
          id: uuidv4(),
          liquidationId: liqId,
          expense_date: liqStartedDate.split('T')[0],
          vendor,
          category,
          amount: totalSpent,
          payment_method: 'Cash',
          business_purpose: `Liquidation of CADV-${caId.substring(0, 6)}: ${purpose}`,
          receipt_url: '/receipt_placeholder.png'
        });

        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.RELEASED, CashAdvanceStatus.RELEASED, reqId, 'Liquidation Started', liqStartedDate);
        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.RELEASED, CashAdvanceStatus.RELEASED, reqId, 'Liquidation Submitted', liqSubmittedDate);
        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.RELEASED, CashAdvanceStatus.RELEASED, appId, 'Liquidation Reviewed', liqClosedDate);
        addCaHistoryWithTimestamp(caId, CashAdvanceStatus.RELEASED, CashAdvanceStatus.LIQUIDATED, 'u3', 'Closed (Refund Collected)', liqClosedDate);

        addLiqHistoryWithTimestamp(liqId, '', LiquidationStatus.DRAFT, reqId, 'Draft Liquidation started', liqStartedDate);
        addLiqHistoryWithTimestamp(liqId, LiquidationStatus.DRAFT, LiquidationStatus.SUBMITTED, reqId, 'Liquidation submitted for review', liqSubmittedDate);
        
        const liqSubSubject = `Liquidation Submitted - LIQ-${liqId.substring(0,6)}`;
        const liqSubBody = `A Liquidation report has been submitted by ${reqName} for Cash Advance CADV-${caId.substring(0,6)}.\n\nTotal Spent: PHP ${totalSpent}\nVariance: PHP 0 (SETTLED)`;
        sendEmail(appId, liqSubSubject, liqSubBody, undefined, { timestamp: liqSubmittedDate });

        addLiqHistoryWithTimestamp(liqId, LiquidationStatus.SUBMITTED, LiquidationStatus.CLOSED, appId, 'Approved and Closed.', liqClosedDate);
        
        const liqCloSubject = `Liquidation Closed (Refund Collected) - LIQ-${liqId.substring(0,6)}`;
        const liqCloBody = `Your Liquidation has been marked as Closed. Custodian Carol Ramos has verified collection of your refund.`;
        sendEmail(reqId, liqCloSubject, liqCloBody, undefined, { timestamp: liqClosedDate });
      }
    };

    const now = new Date();
    const deptStates = departments.map(d => ({
      ...d,
      reqIdx: 0,
      appIdx: 0,
      totalItems: 0
    }));

    for (let monthOffset = 12; monthOffset >= 1; monthOffset--) {
      const targetMonthDate = new Date(now.getFullYear(), now.getMonth() - monthOffset, 15);
      const year = targetMonthDate.getFullYear();
      const month = targetMonthDate.getMonth() + 1;

      for (const ds of deptStates) {
        const count = 8 + Math.floor(Math.random() * 4); // 8, 9, 10, or 11
        for (let i = 0; i < count; i++) {
          const createdDay = 1 + Math.floor(Math.random() * 28);
          const daysAgoCreated = getDaysAgo(year, month, createdDay);

          if (daysAgoCreated <= 20) {
            continue;
          }

          ds.totalItems++;

          // Deterministically assign 1 out of 7 items to Approver (approx 14.3%)
          const isApproverSubmitter = (ds.totalItems % 7 === 0);

          // Deterministically make every 4th item a Cash Advance, otherwise Claim (75% Claim, 25% CADV)
          const isClaim = (ds.totalItems % 4 !== 0);
          
          const isCompleted = Math.random() < 0.85;

          let reqId: string;
          let appId: string;

          if (isApproverSubmitter) {
            reqId = ds.approvers[ds.appIdx % ds.approvers.length];
            ds.appIdx++;

            const reqUser = users.find(u => u.id === reqId);
            appId = reqUser?.reports_to || 'u19';
          } else {
            reqId = ds.requestors[ds.reqIdx % ds.requestors.length];
            ds.reqIdx++;

            const reqUser = users.find(u => u.id === reqId);
            appId = reqUser?.reports_to || ds.approvers[0];
          }

          const category = ds.categories[Math.floor(Math.random() * ds.categories.length)];
          const vendor = ds.vendors[Math.floor(Math.random() * ds.vendors.length)];
          const client = ds.clients[Math.floor(Math.random() * ds.clients.length)];

          // Keep demo reimbursements representative of the policy: most claims
          // sit around the PHP 1,000 reimbursable ceiling, with a small number
          // filed above it to demonstrate the non-blocking cap.
          let amount = 650 + Math.floor(Math.random() * 750);
          if (Math.random() < 0.12) {
            amount = 1500 + Math.floor(Math.random() * 1500);
          }

          if (isClaim) {
            const momDaysAgo = daysAgoCreated + 1;
            const mom = mkMom(reqId, client, MomStatus.COMPLETED, momDaysAgo);

            const approvedDaysAgo = daysAgoCreated - (1 + Math.floor(Math.random() * 2));
            const processedDaysAgo = approvedDaysAgo - (1 + Math.floor(Math.random() * 2));
            const status = isCompleted ? ClaimStatus.COMPLETED : ClaimStatus.REJECTED;

            mkClaim({
              requestorId: reqId,
              approverId: appId,
              mom,
              status,
              category,
              amount,
              createdDaysAgo: daysAgoCreated,
              approvedDaysAgo: isCompleted || status === ClaimStatus.REJECTED ? approvedDaysAgo : undefined,
              processedDaysAgo: isCompleted ? processedDaysAgo : undefined,
              releaseCode: isCompleted ? Math.random().toString(36).substring(2, 8).toUpperCase() : undefined,
              paymentMethod: isCompleted ? 'Cash' : undefined,
              approvalComment: status === ClaimStatus.REJECTED ? 'Rejected: Budget exceeds departmental quota for this category.' : undefined
            });
          } else {
            const status = isCompleted ? CashAdvanceStatus.LIQUIDATED : CashAdvanceStatus.REJECTED;
            const purpose = `${category} for ${client}`;
            mkHistoricalCa(reqId, appId, amount, purpose, status, daysAgoCreated, isCompleted, category, vendor, client);
          }
        }
      }
    }
    }

    claimCounter = seedCounter;
    // Seeded claims never call persistClaim (they're in-memory demo data
    // only), but a live-database demo still allocates real claim numbers
    // from the sequence below — keep it past the seeded range so a real
    // submission can't display the same REIM-YYYY-NNNNNN as seeded data.
    if (isDbConfigured()) {
      try {
        await syncClaimNumberSequenceFloor(seedCounter);
      } catch (err) {
        console.error('[db] Could not sync claim_number_seq after seeding:', err);
      }
    }

    if (options.reviewMeetings) {
      const RM_TIMES = ['09:00', '10:30', '13:00', '14:30', '16:00'];
      const RM_DECLINE_REASONS = [
        'Requestor unavailable at proposed slot, awaiting reschedule.',
        'Approver has a scheduling conflict, needs a new time.',
        'Client meeting ran long, review pushed to another day.'
      ];
      // Pre-meeting statuses (anything but Confirmed) only make sense for a
      // meeting that hasn't happened yet -- nothing in the live system ever
      // sets Completed, so once the date is in the past, Confirmed is the
      // only outcome that stays coherent with an already-decided claim.
      const UPCOMING_STATUS_CYCLE = [
        ReviewMeetingStatus.CONFIRMED,
        ReviewMeetingStatus.PENDING_CONFIRMATION,
        ReviewMeetingStatus.CONFIRMED,
        ReviewMeetingStatus.DECLINE_REQUESTED
      ];
      const rmCandidates = claims.filter(c => c.status !== ClaimStatus.DRAFT);
      const rmCount = Math.min(16, rmCandidates.length);
      const rmStep = rmCount > 0 ? Math.max(1, Math.floor(rmCandidates.length / rmCount)) : 0;

      let upcomingAssigned = 0;

      for (let i = 0; i < rmCount; i++) {
        const claim = rmCandidates[i * rmStep];
        if (!claim) continue;

        const alreadyHasMeeting = reviewMeetings.some(rm => rm.claim_id === claim.id);
        if (alreadyHasMeeting) continue;

        // Only a claim still awaiting a decision can coherently have a
        // review meeting that hasn't happened yet; anything already
        // Approved/Rejected/Processing/etc. necessarily had its meeting
        // (if any) already, and that meeting can only have gone one way.
        const isUndecided = claim.status === ClaimStatus.PENDING_APPROVAL;

        let meetingDate: string;
        let rmStatus: ReviewMeetingStatus;

        if (isUndecided) {
          upcomingAssigned++;
          const daysAhead = upcomingAssigned * 2 - 1; // 1, 3, 5, 7... days out
          meetingDate = rDate(-daysAhead).split('T')[0];
          rmStatus = UPCOMING_STATUS_CYCLE[upcomingAssigned % UPCOMING_STATUS_CYCLE.length];
        } else {
          const claimAgeDays = Math.max(1, Math.round((Date.now() - new Date(claim.created_at).getTime()) / (1000 * 60 * 60 * 24)));
          const meetingDaysAgo = Math.max(1, claimAgeDays - 1);
          meetingDate = rDate(meetingDaysAgo).split('T')[0];
          rmStatus = ReviewMeetingStatus.CONFIRMED;
        }

        const rm: ReviewMeeting = {
          id: uuidv4(),
          claim_id: claim.id,
          requestor_id: claim.requestor_id,
          approver_id: claim.current_approver_id,
          meeting_date: meetingDate,
          meeting_time: RM_TIMES[i % RM_TIMES.length],
          status: rmStatus,
          created_at: claim.created_at
        };
        if (rmStatus === ReviewMeetingStatus.DECLINE_REQUESTED) {
          rm.decline_reason = RM_DECLINE_REASONS[i % RM_DECLINE_REASONS.length];
        }
        reviewMeetings.push(rm);
      }
    }

    if (options.supportRequests) {
      const SR_TICKETS: { subject: string; description: string; priority: SupportRequestPriority }[] = [
        { subject: 'Receipt upload failing on mobile', description: 'Every time I try to attach a receipt photo from my phone, the upload spins forever and never completes. Tried on both WiFi and mobile data.', priority: SupportRequestPriority.HIGH },
        { subject: 'Cannot find my company in the MOM dropdown', description: 'The client I met with, Ayala Land Inc, does not show up in the Company Name dropdown even though I have submitted claims for them before.', priority: SupportRequestPriority.MEDIUM },
        { subject: 'Wrong approver assigned to my claim', description: 'My claim was routed to a manager I do not report to. I think the org chart may be out of date for my department.', priority: SupportRequestPriority.HIGH },
        { subject: 'Release code email never arrived', description: 'My claim moved to For Processing three days ago but I never received the release code email for the Custodian.', priority: SupportRequestPriority.MEDIUM },
        { subject: 'Typo in expense category list', description: '"Accomodation" is misspelled in the expense category dropdown, should be "Accommodation".', priority: SupportRequestPriority.LOW },
        { subject: 'Need help understanding variance on my liquidation', description: 'My liquidation shows a variance amount that does not match my own math. Can someone walk me through how it is calculated?', priority: SupportRequestPriority.MEDIUM },
        { subject: 'Delegation request stuck on Pending', description: 'I set up a delegate for while I am on leave next week but it still shows Pending. Does my delegate need to do something on their end?', priority: SupportRequestPriority.LOW },
        { subject: 'Cash advance amount field rejecting decimals', description: 'Typing 5000.50 into the Cash Advance amount field gets rejected as invalid. Whole numbers work fine.', priority: SupportRequestPriority.HIGH },
        { subject: 'Review meeting time looks wrong after reschedule', description: 'I rescheduled my review meeting and the new time shown on my dashboard does not match what I picked in the form.', priority: SupportRequestPriority.LOW },
        { subject: 'Dashboard totals do not match Transaction History', description: 'The Approved total on my dashboard is higher than what I count when I filter Transaction History to Approved status for the same period.', priority: SupportRequestPriority.MEDIUM }
      ];

      const requestorPool = users.filter(u => u.role !== UserRole.ADMIN).map(u => u.id);
      const adminPool = users.filter(u => u.role === UserRole.ADMIN).map(u => u.id);
      const srStatusCycle = [SupportRequestStatus.RESOLVED, SupportRequestStatus.IN_PROGRESS, SupportRequestStatus.OPEN];

      SR_TICKETS.forEach((ticket, i) => {
        if (requestorPool.length === 0) return;
        const reqId = requestorPool[i % requestorPool.length];
        const createdDaysAgo = 3 + i * 2;
        const createdAt = rDate(createdDaysAgo);
        const srStatus = srStatusCycle[i % srStatusCycle.length];
        const assignedAdmin = srStatus !== SupportRequestStatus.OPEN && adminPool.length > 0
          ? adminPool[i % adminPool.length]
          : undefined;
        const updatedAt = srStatus === SupportRequestStatus.OPEN ? createdAt : rDate(Math.max(0, createdDaysAgo - 1));

        const sr: SupportRequest = {
          id: uuidv4(),
          requestor_id: reqId,
          subject: ticket.subject,
          description: ticket.description,
          priority: ticket.priority,
          status: srStatus,
          assigned_admin_id: assignedAdmin,
          created_at: createdAt,
          updated_at: updatedAt
        };
        supportRequests.push(sr);

        if (srStatus !== SupportRequestStatus.OPEN && assignedAdmin) {
          supportMessages.push({
            id: uuidv4(),
            request_id: sr.id,
            sender_id: assignedAdmin,
            message: srStatus === SupportRequestStatus.RESOLVED
              ? "Thanks for flagging this - I've looked into it and this should be resolved now. Let me know if you still run into it."
              : 'Thanks for the report, looking into this now - will update you shortly.',
            timestamp: updatedAt
          });
          if (srStatus === SupportRequestStatus.RESOLVED) {
            supportMessages.push({
              id: uuidv4(),
              request_id: sr.id,
              sender_id: reqId,
              message: 'Confirmed, working fine on my end now. Thank you!',
              timestamp: rDate(Math.max(0, createdDaysAgo - 2))
            });
          }
        }
      });
    }
  }

  // Admin: Seed 1 Year of History
  // Accepts an optional { options: Partial<SeedDataOptions> } body for the
  // selective Data Management panel - unset fields default to false (a
  // narrower run than "everything"). No body (the original "Generate 1 Year
  // of History" button) still means "generate everything," unchanged.
  app.post('/api/admin/seed-year', async (req, res) => {
    if (!demoModeEnabled) return res.status(404).json({ error: 'Demo data tools are disabled.' });
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    try {
      const requestedOptions = req.body && req.body.options;
      suppressHistoryPersistence = true;
      try {
        if (requestedOptions && typeof requestedOptions === 'object') {
          const selective: SeedDataOptions = {
            demoClaims: !!requestedOptions.demoClaims,
            demoCashAdvances: !!requestedOptions.demoCashAdvances,
            delegations: !!requestedOptions.delegations,
            historicalBackfill: !!requestedOptions.historicalBackfill,
            reviewMeetings: !!requestedOptions.reviewMeetings,
            supportRequests: !!requestedOptions.supportRequests,
          };
          await seedYearOfData(selective);
        } else {
          await seedYearOfData();
        }
      } finally {
        suppressHistoryPersistence = false;
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('Failed to manually seed:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Admin: Reset Simulation - wipes every claim/MOM/history/email/notification
  // and any delegations or reassignments made during a demo, but keeps the
  // standard org chart in place, so the next thing anyone does is create
  // something from scratch rather than looking at a random empty app.
  app.post('/api/admin/reset', async (req, res) => {
    if (!demoModeEnabled) return res.status(404).json({ error: 'Demo data tools are disabled.' });
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    moms = [];
    claims = [];
    expenses = [];
    approvals = [];
    statusHistories = [];
    emails = [];
    teamsMessages = [];
    lastSeenStore = {};
    cashAdvances = [];
    liquidations = [];
    liquidationLineItems = [];
    reviewMeetings = [];
    delegations = [];
    supportRequests = [];
    supportMessages = [];
    companies = buildInitialCompanies();
    // Master data (Phase 1 MDM) is catalog-style reference data, same as
    // companies — reset to its seed set for demo consistency rather than
    // persisted like systemSettings.
    departments = buildInitialDepartments();
    costCenters = buildInitialCostCenters();
    businessUnits = buildInitialBusinessUnits();
    branches = buildInitialBranches();
    projectCodes = buildInitialProjectCodes();
    vendors = buildInitialVendors();
    fieldDefinitions = buildInitialFieldDefinitions();

    users.length = 0;
    users.push(...buildDefaultUsers());
    applyHierarchySyncDefaults(users);
    try {
      await clearUsersInDb();
      await syncUsersToDb(users);
      // Every domain above was just wiped and (for companies/master
      // data/field definitions) reseeded to fixed defaults — clear their
      // Postgres tables too so no orphaned row from before the reset lingers,
      // then persist the fresh reseeded reference data back.
      await clearCoreLoopInDb();
      await clearCashAdvanceLoopInDb();
      await clearWorkflowExtrasInDb();
      await clearReferenceDataInDb();
      for (const company of companies) await persistCompany(company);
      for (const dept of departments) await persistMasterDataRecord('departments', dept);
      for (const cc of costCenters) await persistMasterDataRecord('cost-centers', cc);
      for (const bu of businessUnits) await persistMasterDataRecord('business-units', bu);
      for (const branch of branches) await persistMasterDataRecord('branches', branch);
      for (const pc of projectCodes) await persistMasterDataRecord('project-codes', pc);
      for (const vendor of vendors) await persistMasterDataRecord('vendors', vendor);
      for (const field of fieldDefinitions) await persistFieldDefinition(field);
      await syncClaimNumberSequenceFloor(123);
    } catch (err) {
      console.error('[db] Could not persist reset state to Postgres:', err);
    }

    claimCounter = 123;

    res.json({ success: true });
  });

  // Support Requests API
  app.get('/api/support', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    let userRequests = supportRequests;
    if (user.role !== UserRole.ADMIN) {
      userRequests = supportRequests.filter(sr => sr.requestor_id === user.id);
    }
    
    res.json(userRequests);
  });

  app.get('/api/support/:id', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    const request = supportRequests.find(sr => sr.id === req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    
    if (user.role !== UserRole.ADMIN && request.requestor_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const messages = supportMessages.filter(sm => sm.request_id === request.id)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
    res.json({ ...request, messages });
  });

  app.post('/api/support', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role === UserRole.ADMIN) return res.status(403).json({ error: 'Admins manage support requests and cannot file their own.' });

    const { subject, description, related_entity_type, related_entity_id, priority } = req.body;
    
    const newRequest: SupportRequest = {
      id: uuidv4(),
      requestor_id: user.id,
      subject,
      description,
      related_entity_type,
      related_entity_id,
      priority: priority || SupportRequestPriority.LOW,
      status: SupportRequestStatus.OPEN,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    supportRequests.push(newRequest);
    
    // Notify Admins
    const admins = users.filter(u => u.role === UserRole.ADMIN);
    admins.forEach(admin => {
      sendEmail(
        admin.id,
        `New Support Request: ${subject}`,
        `A new support request has been created by ${user.name}.\n\nPriority: ${newRequest.priority}\nSubject: ${subject}\nDescription: ${description}`,
      );
    });

    try {
      await persistSupportRequest(newRequest);
    } catch (err) {
      console.error('[db] Could not persist new support request to Postgres:', err);
    }
    res.status(201).json(newRequest);
  });

  app.post('/api/support/:id/messages', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    const request = supportRequests.find(sr => sr.id === req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    
    if (user.role !== UserRole.ADMIN && request.requestor_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const { message } = req.body;
    
    const newMessage: SupportRequestMessage = {
      id: uuidv4(),
      request_id: request.id,
      sender_id: user.id,
      message,
      timestamp: new Date().toISOString()
    };
    
    supportMessages.push(newMessage);
    request.updated_at = newMessage.timestamp;
    
    if (user.id === request.requestor_id) {
      if (request.assigned_admin_id) {
         sendEmail(request.assigned_admin_id, `New message on Support Request: ${request.subject}`, `${user.name}: ${message}`);
      }
    } else {
      sendEmail(request.requestor_id, `New message on Support Request: ${request.subject}`, `${user.name}: ${message}`);
    }

    try {
      await persistSupportRequest(request);
      await insertSupportMessage(newMessage);
    } catch (err) {
      console.error('[db] Could not persist support message to Postgres:', err);
    }
    res.status(201).json(newMessage);
  });

  app.put('/api/support/:id', async (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    
    const request = supportRequests.find(sr => sr.id === req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    
    if (user.role !== UserRole.ADMIN && request.requestor_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    if (req.body.status) {
      const oldStatus = request.status;
      request.status = req.body.status;
      if (oldStatus !== request.status && request.status === SupportRequestStatus.RESOLVED) {
        sendEmail(request.requestor_id, `Support Request Resolved: ${request.subject}`, 'Your support request has been marked as resolved.');
      }
    }
    
    if (req.body.priority && user.role === UserRole.ADMIN) {
      request.priority = req.body.priority;
    }
    
    if (req.body.assigned_admin_id && user.role === UserRole.ADMIN) {
      request.assigned_admin_id = req.body.assigned_admin_id;
    }
    
    request.updated_at = new Date().toISOString();

    try {
      await persistSupportRequest(request);
    } catch (err) {
      console.error('[db] Could not persist support request changes to Postgres:', err);
    }
    res.json(request);
  });

  app.get('/api/imports', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });
    res.json(importBatches);
  });

  app.post('/api/imports', async (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const { filename, records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No valid records provided' });
    }

    const batchId = uuidv4();
    const newBatch: ImportBatch = {
      id: batchId,
      admin_id: user.id,
      filename,
      total_records: records.length,
      imported_at: new Date().toISOString()
    };

    // Build every row in memory first — nothing is pushed into the live
    // in-memory arrays or the database until the whole batch has been
    // assembled and (when a database is configured) committed together.
    const claimsToCreate: Claim[] = [];
    const expensesToCreate: ExpenseLineItem[] = [];
    const historyToCreate: StatusHistory[] = [];

    for (const record of records) {
      const claimId = uuidv4();
      const claimNumber = record.claim_number || (await generateClaimNumber());

      claimsToCreate.push({
        id: claimId,
        claim_number: claimNumber,
        requestor_id: record.requestor_id,
        current_approver_id: user.id, // Or whoever, it's historical so doesn't matter much
        mom_id: record.mom_id || '',
        status: ClaimStatus.COMPLETED,
        total_amount: record.total_amount,
        expense_category: normalizeExpenseCategory(record.expense_category),
        receipt_url: record.receipt_url || '',
        remarks: record.remarks || '',
        import_batch_id: batchId,
        created_at: record.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      if (record.lineItems && Array.isArray(record.lineItems)) {
        for (const li of record.lineItems) {
          expensesToCreate.push({
            id: uuidv4(),
            claim_id: claimId,
            expense_date: li.expense_date || new Date().toISOString().split('T')[0],
            vendor: li.vendor || 'Unknown',
            category: normalizeExpenseCategory(li.category || 'Other'),
            amount: li.amount || 0,
            payment_method: li.payment_method || 'Corporate Card',
            business_purpose: li.business_purpose || 'Historical data import',
            receipt_url: li.receipt_url || '',
            or_number: li.or_number || ''
          });
        }
      }

      historyToCreate.push({
        id: uuidv4(),
        claim_id: claimId,
        old_status: 'Imported',
        new_status: ClaimStatus.COMPLETED,
        changed_by: user.id,
        reason: `Migrated from historical records by ${user.name} (Batch ${batchId.substring(0,6)})`,
        timestamp: new Date().toISOString()
      });
    }

    // Unlike a live user submission (best-effort persist, in-memory state
    // always wins), a bad historical-import batch has no user waiting on a
    // single record — reject the whole batch on any DB failure (e.g. a
    // duplicate claim_number hitting the unique constraint) rather than
    // leaving a batch that looks imported in the UI but never committed.
    if (isDbConfigured()) {
      try {
        await persistHistoricalImportBatch(newBatch, claimsToCreate, expensesToCreate, historyToCreate);
      } catch (err) {
        console.error('[db] Historical import batch failed, rejecting whole batch:', err);
        return res.status(500).json({ error: 'Import failed while saving records. No records from this batch were imported — check for duplicate claim numbers and try again.' });
      }
    }

    importBatches.push(newBatch);
    claims.push(...claimsToCreate);
    expenses.push(...expensesToCreate);
    statusHistories.push(...historyToCreate);

    res.status(201).json(newBatch);
  });

  // Frontend: Vite dev middleware locally; static build in production.
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // On Vercel, static assets are served by the platform (see vercel.json);
    // this branch still lets `npm start` serve the built SPA standalone.
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  // Auto-seed on startup unless explicitly disabled. This runs in production
  // too, so a fresh serverless cold start has demo data to serve. Claims,
  // MOMs, cash advances, etc. are not DB-backed yet (docs/DATABASE-MIGRATION.md
  // is mid-migration — see PRODUCTION-PASS.md #3), so this still reseeds them
  // in memory every boot; `resetUsers: !usersLoadedFromDb` is the one
  // exception, so a boot that just loaded real users from Postgres doesn't
  // immediately overwrite them with the fixed demo set.
  if (demoModeEnabled && process.env.AUTO_SEED !== 'false') {
    try {
      suppressHistoryPersistence = true;
      try {
        await seedYearOfData(undefined, !usersLoadedFromDb);
      } finally {
        suppressHistoryPersistence = false;
      }
      console.log('Auto-seeded 1 year of mock data on startup.');
    } catch (err: any) {
      console.error('Failed to auto-seed mock data on startup:', err);
    }
  }

  // --- Durable scheduled jobs (docs/project-handoff/REMAINING-BACKEND-GAPS.md
  // #9: "Stale-approver escalation is triggered manually by an Admin.
  // Delegation expiration is calculated lazily during reads.") A real
  // deployment would use a persistent job queue with database-backed job
  // state; this in-process interval is the pragmatic middle ground for a
  // single-persistent-Node-process app with no external job infrastructure
  // available. Both jobs are idempotent — delegation sync only flips an
  // Active row already past its own end_date, escalation only touches a
  // stale, not-yet-escalated claim — so re-running on every tick is safe.
  // Skipped under VERCEL=1 (the test harness's signal, also set on an actual
  // Vercel deploy): a setInterval has no meaning across serverless
  // invocations, and the test suite calls createApp() repeatedly per file,
  // which would otherwise leak one live interval per test file.
  if (process.env.VERCEL !== '1') {
    const SCHEDULED_JOB_INTERVAL_MS = 60 * 60 * 1000; // hourly — plenty for a multi-day threshold
    setInterval(() => {
      syncDelegationStatuses();
      runStaleApproverFallbackCheck(false, 'system').catch((err: unknown) =>
        console.error('[scheduler] Stale-approver fallback check failed:', err));
    }, SCHEDULED_JOB_INTERVAL_MS);
  }

  return app;
}

// Local dev / standalone prod: listen on a port. Skipped on Vercel, where the
// serverless entry (api/index.ts) imports createApp() and drives it instead.
if (!process.env.VERCEL) {
  createApp().then((app) => {
    const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}
