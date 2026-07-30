import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import os from 'os';
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

const LIQUIDATION_DEADLINE_DAYS = 7;

let moms: Mom[] = [];
let claims: Claim[] = [];
let expenses: ExpenseLineItem[] = [];
let approvals: Approval[] = [];
let statusHistories: StatusHistory[] = [];
let emails: Email[] = [];
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
    'Client Meals', 'Travel', 'Accommodation', 'Transportation',
    'Office Supplies', 'Software Subscriptions', 'Training', 'Miscellaneous'
  ],
  highValueThreshold: 15000,
  // Single source of truth for every payment-method picker (disbursement,
  // cash advance release, liquidation refund collection) so adding/removing
  // a method is a one-line admin change, not a hunt through JSX.
  paymentMethods: ['Cash'],
  reimbursementCap: 1000,
  // Company spending policy: the maximum amount allowed on a single expense line
  // item, per category. A category absent here (or set to 0) has no cap. Admins
  // edit this from the Company Policy screen; the claim/liquidation submit routes
  // reject any line that exceeds its category's cap.
  categoryLimits: {
    Meals: 2000,
    Transportation: 3000,
  } as Record<string, number>,
};

let claimCounter = 123;

/**
 * Enforce the company spending policy against a set of expense lines. Returns an
 * error message describing the first line that breaks its category cap, or null
 * if every line is within policy. Shared by the reimbursement and liquidation
 * submit paths so the rule lives in exactly one place.
 */
function checkCategoryLimits(_items: Array<{ category?: string; amount?: number }>): string | null {
  // Category limits are retained as legacy configuration for old demo data,
  // but they no longer block a request. The approved policy allows any claimed
  // amount and caps only the amount actually paid out.
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
  { name: 'Cebu Pacific Air', industry: 'Aviation', notes: 'Airline partner for travel and logistics arrangements.' },
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

const getOrCreateCompany = (name?: string | null): void => {
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const exists = companies.some(c => c.name.toLowerCase() === trimmed.toLowerCase());
  if (!exists) {
    companies.push({ id: uuidv4(), name: trimmed });
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
    // Phase 3 MDM: cascading Company -> Department -> Cost Center -> Project.
    // These are ordinary dynamic fields sourced live from the Phase 1 Master
    // Data catalogs (rather than a hardcoded option list) — selecting a
    // Company with a matching default pre-fills these (see the MOM forms'
    // company-select handler), but they stay user-editable dropdowns, since
    // Master Data has no formal parent/child linkage to filter options by.
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
  { id: 'u22', name: 'Fiona Mercado', email: 'fiona@mgenesis.com', role: UserRole.FINANCE, department: 'Finance', job_title: 'Finance Analyst', reports_to: null, avatar_url: '/avatars/corp_female_1.jpg' },
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

// Prototype notification transport. Internal workflow messages are recorded as
// Teams messages (and still drive in-app notifications); only a MOM explicitly
// sent to an external client remains an email.
// opts.plain sends an unstyled personal-message email (no SharePoint header/footer) -
// used for the MOM email to an external client contact, which must read as a personal
// message, not a system notification. Every other notification keeps the full
// enterprise template by omitting opts.
const sendEmail = (toOrId: string, subject: string, body: string, ccId?: string, opts?: { plain?: boolean; recipientName?: string; fromLabel?: string; timestamp?: string }) => {
  const recipient = users.find(u => u.id === toOrId);
  const toEmail = recipient ? recipient.email : toOrId;
  const recipientId = recipient ? recipient.id : 'external';
  const recipientName = opts?.recipientName || (recipient ? recipient.name : toOrId.split('@')[0]);
  const channel: 'Email' | 'Teams' = opts?.plain ? 'Email' : 'Teams';
  const fromLine = opts?.plain ? (opts.fromLabel || 'system@reimbursement.local') : 'Sales Reimbursement System';

  const emailTimestamp = opts?.timestamp || new Date().toISOString();
  const sentString = new Date(emailTimestamp).toLocaleString('en-US', { timeZone: 'Asia/Manila' });

  const finalBody = opts?.plain
    ? `Dear ${recipientName},


${body}`
    : `${body}

Sent via Microsoft Teams (prototype log)
${sentString}`;

  const email: Email = {
    id: uuidv4(),
    recipient_id: recipientId,
    from: fromLine,
    to: toEmail,
    subject,
    body: finalBody,
    channel,
    delivery_status: 'Logged',
    read: false,
    timestamp: emailTimestamp
  };
  emails.push(email);

  if (ccId) {
    const ccRecipient = users.find(u => u.id === ccId);
    emails.push({
      id: uuidv4(),
      recipient_id: ccRecipient?.id || 'external',
      from: fromLine,
      to: ccRecipient?.email || ccId,
      subject: `[CC] ${subject}`,
      body: finalBody,
      channel,
      delivery_status: 'Logged',
      read: false,
      timestamp: emailTimestamp
    });
  }

  console.log(`\n--- MOCK ${channel.toUpperCase()} TRANSPORT ---`);
  console.log(`To: ${email.to}`);
  if (ccId) console.log(`CC: ${users.find(u => u.id === ccId)?.email || ccId}`);
  console.log(`Subject: ${email.subject}`);
  console.log(`Body:\n${email.body}`);
  console.log(`----------------------------\n`);
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

  // --- P1 #7 HTTP security middleware (prototype-level pass) -------------
  // contentSecurityPolicy is off: the SPA loads a Google Fonts CDN stylesheet
  // and Vite's dev-mode inline HMR scripts, and a real CSP needs to be tuned
  // against the actual asset list — not something to guess at here. The
  // other helmet defaults (X-Frame-Options, X-Content-Type-Options, HSTS,
  // etc.) apply as-is.
  app.use(helmet({ contentSecurityPolicy: false }));

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

  // --- INTERIM upload access gate -------------------------------------
  // TEMPORARY until Phase 2 (real authentication/sessions). Previously this
  // was a bare `express.static` mount with zero access control — any
  // receipt/MOM attachment URL, once known, was publicly fetchable by
  // anyone. This route requires *a* logged-in identity (same mock-auth
  // concept used everywhere else in this file — X-User-Id) before serving a
  // file, but does NOT check that the identity actually owns/has a
  // legitimate reason to see that specific file. That per-resource
  // ownership check needs real sessions to be meaningful and should be
  // built in Phase 2, not bolted onto the header-trust model here.
  //
  // Browsers don't attach custom headers to <img>/<iframe>/direct-navigation
  // requests, so this also accepts the same identity via a `?uid=` query
  // param (see getUploadUrl() in src/utils.ts) for those cases — deliberately
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

  // An Active ApproverDelegation stands in for the delegating approver on
  // every claim/cash-advance/liquidation visibility and action check below —
  // otherwise a delegate could accept a delegation (see /api/delegations/:id/accept)
  // and still see zero of the work it was meant to hand them. Pending, Declined,
  // Expired, and Cancelled delegations grant nothing.
  const isActiveDelegateFor = (delegateId: string, approverId: string | undefined | null): boolean =>
    !!approverId && delegations.some(d =>
      d.delegate_id === delegateId && d.approver_id === approverId && d.status === DelegationStatus.ACTIVE
    );

  const addHistory = (claimId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    statusHistories.push({
      id: uuidv4(),
      claim_id: claimId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    });
  };

  const addCaHistory = (caId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    statusHistories.push({
      id: uuidv4(),
      claim_id: '',
      cash_advance_id: caId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    });
  };

  const addLiqHistory = (liqId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    statusHistories.push({
      id: uuidv4(),
      claim_id: '',
      liquidation_id: liqId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    });
  };

  const addUserHistory = (userId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    statusHistories.push({
      id: uuidv4(),
      claim_id: '',
      user_id: userId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    });
  };

  const addDelegationHistory = (delegationId: string, oldStatus: string, newStatus: string, changedBy: string, reason?: string) => {
    statusHistories.push({
      id: uuidv4(),
      claim_id: '',
      delegation_id: delegationId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: changedBy,
      reason,
      timestamp: new Date().toISOString()
    });
  };

  // Master Data (Phase 1 MDM) — one history helper shared by every entity's
  // route factory below, following the exact same "push into statusHistories,
  // one call per meaningfully-changed field" shape as addUserHistory.
  const addMasterDataHistory = (entityKey: string, recordId: string, field: string, oldVal: string, newVal: string, changedBy: string) => {
    statusHistories.push({
      id: uuidv4(),
      claim_id: '',
      master_data_key: entityKey,
      master_data_id: recordId,
      old_status: `${field}: ${oldVal}`,
      new_status: `${field}: ${newVal}`,
      changed_by: changedBy,
      reason: `Changed ${entityKey} ${field}`,
      timestamp: new Date().toISOString()
    });
  };

  interface MasterDataEntityConfig<T extends MasterDataRecord> {
    key: string;   // used in the URL, e.g. 'departments'
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

    app.post(base, (req, res) => {
      const user = getUser(req);
      if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

      const { errors, fields } = config.validateFields(req.body, config.store());
      if (errors.length) return res.status(400).json({ error: errors[0] });

      const now = new Date().toISOString();
      const record = { id: uuidv4(), active: true, created_at: now, updated_at: now, ...fields } as T;
      config.store().push(record);
      res.json(record);
    });

    app.put(`${base}/:id`, (req, res) => {
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
    key: 'departments', label: 'Department',
    store: () => departments,
    validateFields: validateNamedCatalogEntity('Department'),
  });
  registerMasterDataRoutes<CostCenter>({
    key: 'cost-centers', label: 'Cost Center',
    store: () => costCenters,
    validateFields: validateNamedCatalogEntity('Cost Center'),
  });
  registerMasterDataRoutes<BusinessUnit>({
    key: 'business-units', label: 'Business Unit',
    store: () => businessUnits,
    validateFields: validateNamedCatalogEntity('Business Unit'),
  });
  registerMasterDataRoutes<Branch>({
    key: 'branches', label: 'Branch',
    store: () => branches,
    validateFields: validateNamedCatalogEntity('Branch'),
  });
  registerMasterDataRoutes<ProjectCode>({
    key: 'project-codes', label: 'Project Code',
    store: () => projectCodes,
    validateFields: validateNamedCatalogEntity('Project Code'),
  });
  registerMasterDataRoutes<Vendor>({
    key: 'vendors', label: 'Vendor',
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

  app.post('/api/field-definitions', (req, res) => {
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
    res.json(def);
  });

  app.put('/api/field-definitions/:id', (req, res) => {
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

  // Lazily flips any Active delegation whose end_date has passed to Expired.
  // No scheduler exists in this prototype, so this runs on every read/use of
  // the delegations list instead - self-healing rather than time-driven.
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
  const detectStaleApprovers = (requestorId: string, oldManagerId: string | null, newManagerId: string | null, changedBy: string) => {
    if (!oldManagerId || oldManagerId === newManagerId) return;
    const requestor = users.find(u => u.id === requestorId);
    const oldApprover = users.find(u => u.id === oldManagerId);
    const newApprover = newManagerId ? users.find(u => u.id === newManagerId) : undefined;

    const affected = claims.filter(c =>
      c.requestor_id === requestorId &&
      c.current_approver_id === oldManagerId &&
      c.status === ClaimStatus.PENDING_APPROVAL
    );

    affected.forEach(claim => {
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
    });
  };

  // Auth endpoints (Mock)
  app.get('/api/users', (req, res) => res.json(users));

  // Admin settings endpoints
  app.get('/api/admin/settings', (req, res) => {
    res.json(systemSettings);
  });

  app.put('/api/admin/settings', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { expenseCategories, highValueThreshold, paymentMethods, categoryLimits } = req.body;
    if (expenseCategories && Array.isArray(expenseCategories)) {
      systemSettings.expenseCategories = expenseCategories;
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
        if (Number.isFinite(num) && num > 0) cleaned[cat] = num;
      }
      systemSettings.categoryLimits = cleaned;
    }
    res.json(systemSettings);
  });

  // Admin: Update a user's role/department/job title/reporting manager.
  // Configuration action, deliberately separate from claim approval/processing
  // permissions - segregation of duties for claims is untouched by this route.
  app.put('/api/users/:id', (req, res) => {
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
      detectStaleApprovers(target.id, oldManagerId, reports_to, admin.id);
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

    res.json({ user: target, changed });
  });

  // Company Directory - readable by any authenticated role since MOM creation
  // (any Requestor/Approver) needs to read it; create/edit is Admin-only.
  app.get('/api/companies', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json([...companies].sort((a, b) => a.name.localeCompare(b.name)));
  });

  app.post('/api/companies', (req, res) => {
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
      contact_person, contact_email
    };
    companies.push(company);
    res.json(company);
  });

  // Phase 1 MDM enrichment fields below (address/business_unit_id/etc.) are
  // additive to the pre-existing name/industry/notes fields — see
  // src/types.ts's Company interface. default_approver_id is informational
  // reference data ONLY: it must never be read by claim approval routing,
  // which stays 100% derived from requestor.reports_to / an active
  // ApproverDelegation, per CLAUDE.md's segregation-of-duties rule.
  app.put('/api/companies/:id', (req, res) => {
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

    (['address', 'business_unit_id', 'cost_center_id', 'default_department_id', 'currency', 'tax_id', 'default_approver_id', 'contact_person', 'contact_email'] as const)
      .forEach(field => {
        const value = req.body[field];
        if (value !== undefined && company[field] !== value) {
          addMasterDataHistory('companies', company.id, field, String(company[field] ?? '(none)'), String(value || '(none)'), user.id);
          company[field] = value;
        }
      });

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
  app.put('/api/me/notification-prefs', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    user.notification_prefs = req.body;
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

    let hasAccess = false;
    if (user.role === UserRole.ADMIN) {
      hasAccess = true;
    } else if (user.role === UserRole.REQUESTOR) {
      hasAccess = mom.requestor_id === user.id;
    } else if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      hasAccess = mom.requestor_id === user.id || !!(mom.claim_id && mom.requestor_id && reporteeIds.includes(mom.requestor_id));
    }

    if (!hasAccess) {
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
    if (![UserRole.ADMIN, UserRole.FINANCE].includes(user.role)) return res.status(403).json({ error: 'Forbidden' });

    const flatReceipts = [];

    // 1. Flatten claim expenses
    for (const exp of expenses) {
      const claim = claims.find(c => c.id === exp.claim_id);
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

  app.post('/api/moms', (req, res) => {
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

    getOrCreateCompany(mom.client);
    moms.push(mom);
    res.json(mom);
  });

  app.put('/api/moms/:id', (req, res) => {
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
    getOrCreateCompany(mom.client);
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

    res.json(mom);
  });

  app.post('/api/moms/:id/send', (req, res) => {
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

    // The approver is the internal recipient. The external client is copied
    // only when the requestor explicitly checked "CC client".
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
      approverId,
      subject,
      body,
      mom.cc_client && mom.contact_person_email ? mom.contact_person_email : undefined,
      { plain: true, recipientName: users.find(u => u.id === approverId)?.name || 'Approver', fromLabel: `${user.name} <${user.email}>` }
    );

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
    } else if (user.role === UserRole.ADMIN || user.role === UserRole.FINANCE) {
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
    let hasAccess = false;
    if (user.role === UserRole.ADMIN || user.role === UserRole.FINANCE) {
      hasAccess = true;
    } else if (user.role === UserRole.REQUESTOR) {
      hasAccess = claim.requestor_id === user.id;
    } else if (user.role === UserRole.APPROVER) {
      hasAccess = claim.current_approver_id === user.id || claim.original_approver_id === user.id || claim.requestor_id === user.id || isActiveDelegateFor(user.id, claim.current_approver_id);
    } else if (user.role === UserRole.CUSTODIAN) {
      hasAccess = [ClaimStatus.APPROVED, ClaimStatus.PROCESSING, ClaimStatus.READY_FOR_CLAIM, ClaimStatus.COMPLETED].includes(claim.status) || claim.requestor_id === user.id;
    }
    if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

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

  app.post('/api/claims', (req, res) => {
    const user = getUser(req);
    if (!user || !user.reports_to) return res.status(403).json({ error: 'Forbidden: You must have a designated manager (reports_to) to submit.' });
    
    const { mom_id, expense_category, total_amount, receipt_url, or_number, remarks, supporting_documents, line_items, is_draft, reimbursement_type } = req.body;
    const isTransport = reimbursement_type === 'Transport';

    if (!is_draft && !mom_id && !isTransport) return res.status(400).json({ error: 'Minutes of Meeting (MOM) is required.' });
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
    let mainCategory = expense_category || 'Multiple Categories';
    let mainReceipt = receipt_url || '';

    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      for (const item of line_items) {
        if (!is_draft && !item.category) return res.status(400).json({ error: 'Each expense must have a category.' });
        const numericAmount = Number(item.amount);
        if (isNaN(numericAmount) || numericAmount <= 0) return res.status(400).json({ error: 'Each expense amount must be a valid number greater than zero.' });
        if (!item.receipt_url) return res.status(400).json({ error: 'Each expense must have a receipt.' });
        
        itemsToCreate.push({
          category: item.category,
          amount: numericAmount,
          receipt_url: item.receipt_url,
          or_number: item.or_number,
          // Preserve the per-row detail the requestor entered; fall back to the
          // meeting-derived values only when a field wasn't provided.
          vendor: item.vendor,
          expense_date: item.expense_date,
          payment_method: item.payment_method,
          business_purpose: item.business_purpose || remarks || (isTransport ? 'Transport reimbursement' : `Sales reimbursement for meeting with ${mom?.client || 'client'}`)
        });
        claimTotal += numericAmount;
      }
      mainCategory = itemsToCreate.length === 1 ? itemsToCreate[0].category : 'Multiple Categories';
      mainReceipt = itemsToCreate[0].receipt_url;
    } else {
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
        category: expense_category,
        amount: numericAmount,
        receipt_url: receipt_url,
        or_number: or_number,
        business_purpose: remarks || (isTransport ? 'Transport reimbursement' : `Sales reimbursement for meeting with ${mom?.client || 'client'}`)
      });
      claimTotal = numericAmount;
      mainCategory = expense_category;
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
    const year = new Date().getFullYear();
    const numStr = String(claimCounter++).padStart(6, '0');
    const claimNumber = `REIM-${year}-${numStr}`;

    // Create compatible expense items
    for (const item of itemsToCreate) {
      expenses.push({
        id: uuidv4(),
        claim_id: claimId,
        expense_date: item.expense_date || mom?.meeting_date || new Date().toISOString().split('T')[0],
        vendor: item.vendor || mom?.client || (isTransport ? 'Transport Provider' : 'Client Meeting'),
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
      mom_id: mom_id,
      reimbursement_type: isTransport ? 'Transport' : 'Standard',
      status: ClaimStatus.PENDING_APPROVAL,
      total_amount: claimTotal,
      reimbursable_amount: Math.min(claimTotal, systemSettings.reimbursementCap),
      expense_category: mainCategory,
      receipt_url: mainReceipt,
      remarks,
      supporting_documents,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      flagged_high_value: itemsToCreate.some(item => item.amount > systemSettings.highValueThreshold)
    };

    claims.push(claim);
    if (mom) mom.claim_id = claimId;

    addHistory(
      claim.id,
      ClaimStatus.DRAFT,
      ClaimStatus.PENDING_APPROVAL,
      user.id,
      `Claim filed; reimbursable amount ${formatPHP(claim.reimbursable_amount || 0)}`
    );
    
    if (originalApproverId && currentApproverId !== originalApproverId) {
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
    
    if (currentApproverId) {
      const approver = users.find(u => u.id === currentApproverId);
      const approverName = approver ? approver.name : 'Approver';

      const emailSubject = `Reimbursement Submitted - ${claimNumber}`;
      const emailBody = `A new reimbursement request ${claimNumber} by ${user.name} has been submitted and is awaiting your review and approval.

Reference:
${claimNumber}

Required Action:
Please log in to the system and navigate to the Approval Queue to approve or reject this claim.`;

      sendEmail(currentApproverId, emailSubject, emailBody);

      sendEmail(
        user.id,
        `Reimbursement Submitted - ${claimNumber}`,
        `Your reimbursement request ${claimNumber} for PHP ${claimTotal} has been successfully submitted and routed to ${approverName} for review.

Reference:
${claimNumber}

You'll receive another email as soon as ${approverName} makes a decision.`
      );
    }

    res.json(claim);
  });

  // Review Meetings: internal review calls the Requestor schedules with their
  // Approver at submission time. Separate from the MOM's client meeting date -
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
  app.post('/api/review-meetings/:id/confirm', (req, res) => {
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

    res.json(rm);
  });

  // Approver (or active delegate) declines a proposed Review Meeting time,
  // optionally with a reason. The Requestor must propose a new time via
  // PUT /api/review-meetings/:id/reschedule before the meeting can move
  // forward again.
  app.post('/api/review-meetings/:id/decline', (req, res) => {
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

    res.json(rm);
  });

  // Requestor proposes a new date/time for their own Review Meeting - reused
  // after a decline (or any time before the meeting is Completed), re-opening
  // the same pending-confirmation cycle rather than a separate claim step.
  app.put('/api/review-meetings/:id/reschedule', (req, res) => {
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

    res.json(rm);
  });

  // Revise & Resubmit: a Requestor reopens their own Returned claim, edits
  // it, and sends it back to Pending Approval with a fresh Approval record.
  // The prior "Returned" decision and status-history entry are never
  // touched - this only ever appends new rows.
  app.put('/api/claims/:id/resubmit', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const claim = claims.find(c => c.id === req.params.id && c.requestor_id === user.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.status !== ClaimStatus.RETURNED) {
      return res.status(400).json({ error: 'Only a claim that has been Returned can be revised and resubmitted.' });
    }

    const { mom_id, expense_category, total_amount, receipt_url, or_number, remarks, supporting_documents, line_items } = req.body;
    const isTransport = claim.reimbursement_type === 'Transport';

    if (!mom_id && !isTransport) return res.status(400).json({ error: 'Minutes of Meeting (MOM) is required.' });
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
    let mainCategory = expense_category || 'Multiple Categories';
    let mainReceipt = receipt_url || '';

    if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      for (const item of line_items) {
        if (!item.category) return res.status(400).json({ error: 'Each expense must have a category.' });
        const numericAmount = Number(item.amount);
        if (isNaN(numericAmount) || numericAmount <= 0) return res.status(400).json({ error: 'Each expense amount must be a valid number greater than zero.' });
        if (!item.receipt_url) return res.status(400).json({ error: 'Each expense must have a receipt.' });
        
        itemsToCreate.push({
          category: item.category,
          amount: numericAmount,
          receipt_url: item.receipt_url,
          or_number: item.or_number,
          // Preserve the per-row detail the requestor entered; fall back to the
          // meeting-derived values only when a field wasn't provided.
          vendor: item.vendor,
          expense_date: item.expense_date,
          payment_method: item.payment_method,
          business_purpose: item.business_purpose || remarks || (isTransport ? 'Transport reimbursement' : `Sales reimbursement for meeting with ${mom?.client || 'client'}`)
        });
        claimTotal += numericAmount;
      }
      mainCategory = itemsToCreate.length === 1 ? itemsToCreate[0].category : 'Multiple Categories';
      mainReceipt = itemsToCreate[0].receipt_url;
    } else {
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
        category: expense_category,
        amount: numericAmount,
        receipt_url: receipt_url,
        or_number: or_number,
        business_purpose: remarks || (isTransport ? 'Transport reimbursement' : `Sales reimbursement for meeting with ${mom?.client || 'client'}`)
      });
      claimTotal = numericAmount;
      mainCategory = expense_category;
      mainReceipt = receipt_url;
    }

    // Company spending policy — a resubmit is always a real submission.
    const policyError = checkCategoryLimits(itemsToCreate);
    if (policyError) return res.status(400).json({ error: policyError });

    // Re-link the MOM if the requestor swapped it out for a different one.
    if (mom && claim.mom_id !== mom_id) {
      const oldMom = moms.find(m => m.id === claim.mom_id);
      if (oldMom) oldMom.claim_id = undefined;
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
        vendor: item.vendor || mom?.client || (isTransport ? 'Transport Provider' : 'Client Meeting'),
        category: item.category,
        amount: item.amount,
        payment_method: item.payment_method || 'Cash',
        business_purpose: item.business_purpose,
        receipt_url: item.receipt_url,
        or_number: item.or_number
      });
    }

    const oldStatus = claim.status;
    claim.mom_id = mom_id;
    claim.expense_category = mainCategory;
    claim.total_amount = claimTotal;
    claim.reimbursable_amount = Math.min(claimTotal, systemSettings.reimbursementCap);
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
      sendEmail(claim.current_approver_id, emailSubject, emailBody);

      sendEmail(
        user.id,
        `Reimbursement Resubmitted - ${claimNumber}`,
        `Your revised reimbursement claim ${claimNumber} has been successfully resubmitted and routed to ${approverName} for review.

Reference:
${claimNumber}

You'll receive another email as soon as ${approverName} makes a decision.`
      );
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

  app.post('/api/claims/:id/approve', (req, res) => {
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
    
    const { decision, comment, review_meeting } = req.body; // Approved, Rejected, Returned
    if (!['Approved', 'Rejected', 'Returned'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
    if ((decision === 'Rejected' || decision === 'Returned') && !comment) {
      return res.status(400).json({ error: 'Comment required' });
    }
    
    const oldStatus = claim.status;
    let newStatus = claim.status;
    
    if (decision === 'Approved') newStatus = ClaimStatus.PROCESSING;
    else if (decision === 'Rejected') newStatus = ClaimStatus.REJECTED;
    else if (decision === 'Returned') newStatus = ClaimStatus.RETURNED;
    
    claim.status = newStatus;
    claim.updated_at = new Date().toISOString();
    
    
    approvals.push({
      id: uuidv4(),
      claim_id: claim.id,
      approver_id: user.id,
      decision,
      comment: comment || '',
      timestamp: new Date().toISOString()
    });
    
    addHistory(claim.id, oldStatus, newStatus, user.id, comment || undefined);

    if (decision === 'Returned' && review_meeting?.meeting_date && review_meeting?.meeting_time) {
      const hasConflict = reviewMeetings.some(rm =>
        rm.approver_id === user.id &&
        [ReviewMeetingStatus.PENDING_CONFIRMATION, ReviewMeetingStatus.CONFIRMED].includes(rm.status) &&
        rm.meeting_date === review_meeting.meeting_date &&
        rm.meeting_time === review_meeting.meeting_time
      );
      if (hasConflict) {
        claim.status = oldStatus;
        claim.updated_at = new Date().toISOString();
        approvals.pop();
        statusHistories.pop();
        return res.status(409).json({ error: 'You already have a review meeting at that date and time.' });
      }
      reviewMeetings.push({
        id: uuidv4(),
        claim_id: claim.id,
        requestor_id: claim.requestor_id,
        approver_id: user.id,
        meeting_date: review_meeting.meeting_date,
        meeting_time: review_meeting.meeting_time,
        status: ReviewMeetingStatus.CONFIRMED,
        created_at: new Date().toISOString()
      });
      addHistory(
        claim.id,
        newStatus,
        newStatus,
        user.id,
        `Optional review meeting scheduled for ${review_meeting.meeting_date} at ${review_meeting.meeting_time}`
      );
    }
    
    const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0,6)}`;

    if (decision === 'Approved') {
      claim.approved_at = new Date().toISOString();

      // Email Notification 3: Approved (Recipient: Requestor)
      const approvedSubject = `Approved - ${claimNumber}`;
      const approvedBody = `Your reimbursement request ${claimNumber} has been approved by ${user.name}. It has been forwarded to the Custodian for processing and payment release.

Reference:
${claimNumber}`;
      sendEmail(claim.requestor_id, approvedSubject, approvedBody);

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
      const actionText = decision === 'Returned' ? 'Please revise and resubmit your claim.' : 'No action required.';
      const emailSubject = `Reimbursement ${decision} - ${claimNumber}`;
      const emailBody = `Your reimbursement request ${claimNumber} has been ${decision.toLowerCase()} by ${user.name}.

Reason:
${comment}

Reference:
${claimNumber}

Required Action:
${actionText}`;
      sendEmail(claim.requestor_id, emailSubject, emailBody);
    }

    res.json(claim);
  });

  app.post('/api/claims/:id/custodian-decision', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.CUSTODIAN) return res.status(403).json({ error: 'Forbidden' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (![ClaimStatus.APPROVED, ClaimStatus.PROCESSING].includes(claim.status)) {
      return res.status(400).json({ error: 'Only a claim in the custodian queue can be returned or rejected.' });
    }

    const { decision, comment } = req.body;
    if (!['Returned', 'Rejected'].includes(decision) || !String(comment || '').trim()) {
      return res.status(400).json({ error: 'A valid decision and reason are required.' });
    }

    const oldStatus = claim.status;
    claim.status = decision === 'Returned' ? ClaimStatus.RETURNED : ClaimStatus.REJECTED;
    claim.updated_at = new Date().toISOString();
    addHistory(claim.id, oldStatus, claim.status, user.id, `Custodian: ${comment}`);

    const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0, 6)}`;
    sendEmail(
      claim.requestor_id,
      `Reimbursement ${decision} by Finance - ${claimNumber}`,
      decision === 'Returned'
        ? `Finance returned ${claimNumber} for correction.\n\nReason:\n${comment}\n\nRevise and resubmit it; it will go through approver review again.`
        : `Finance permanently rejected ${claimNumber}.\n\nReason:\n${comment}`
    );

    res.json(claim);
  });

  // docs/hierarchy-sync-design.md §5: the flagged old approver (or an Admin,
  // any time, per §7) hands a stale claim off to the suggested new approver.
  app.post('/api/claims/:id/transfer-approver', (req, res) => {
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

    res.json(claim);
  });

  // Simulates the daily/hourly Entra ID sync's fallback cron
  // (docs/hierarchy-sync-design.md §5) — there's no real scheduler in this
  // prototype, so an Admin can trigger a check manually. `force: true` skips
  // the day-count gate purely so the behavior is demoable without waiting 7
  // real days; the day-based check is what a real cron would use.
  app.post('/api/admin/run-fallback-check', (req, res) => {
    const admin = getUser(req);
    if (!admin || admin.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    const force = !!req.body?.force;
    const now = Date.now();
    const escalated: Claim[] = [];

    claims.forEach(claim => {
      if (!claim.approver_stale_since || claim.escalated_to_admin) return;
      const days = (now - new Date(claim.approver_stale_since).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= STALE_APPROVER_FALLBACK_DAYS || force) {
        claim.escalated_to_admin = true;
        escalated.push(claim);

        const claimNumber = claim.claim_number || `REIM-${claim.id.substring(0, 6)}`;
        const currentApprover = users.find(u => u.id === claim.current_approver_id);
        const suggested = claim.pending_transfer_to ? users.find(u => u.id === claim.pending_transfer_to) : undefined;
        addHistory(claim.id, claim.status, claim.status, admin.id,
          `Fallback escalation: ${claimNumber} unresolved org-change notice sent to Admin.`);
        sendEmail(admin.id, `Escalation: stuck approval - ${claimNumber}`,
          `${claimNumber} has had an unresolved org-change approver notice for ${STALE_APPROVER_FALLBACK_DAYS}+ days.

Current approver: ${currentApprover?.name || '(unknown)'}
Suggested new approver: ${suggested?.name || '(unassigned)'}
Reason: ${claim.approver_stale_reason || 'Org change'}

Manual reassignment may be needed.`);
      }
    });

    res.json({ escalatedCount: escalated.length, escalated: escalated.map(c => c.id) });
  });

  // Generate, Edit or Regenerate Claim Code (Release Code) - Custodian
  app.put('/api/claims/:id/claim-code', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.CUSTODIAN) return res.status(403).json({ error: 'Forbidden' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const { code } = req.body;
    const isRegen = !!claim.release_code;
    claim.release_code = code || Math.random().toString(36).substring(2, 8).toUpperCase();
    
    addHistory(claim.id, claim.status, claim.status, user.id, isRegen ? `Regenerated Claim Code to ${claim.release_code}` : `Generated Claim Code ${claim.release_code}`);
    
    res.json(claim);
  });

  // Mark Ready for Claim - Custodian
  app.post('/api/claims/:id/ready-for-claim', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.CUSTODIAN) return res.status(403).json({ error: 'Forbidden' });

    const claim = claims.find(c => c.id === req.params.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    if (!claim.release_code) {
      claim.release_code = Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    const { payment_method } = req.body;
    if (!payment_method || !systemSettings.paymentMethods.includes(payment_method)) {
      return res.status(400).json({ error: `Payment method must be one of: ${systemSettings.paymentMethods.join(', ')}` });
    }
    claim.payment_method = payment_method;
    claim.processed_by = user.id;

    const oldStatus = claim.status;
    claim.status = ClaimStatus.READY_FOR_CLAIM;
    claim.processing_date = new Date().toISOString();
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
      fromLabel: "SharePoint Online <no-reply@sharepointonline.com>"
    });

    res.json(claim);
  });

  // Complete Claim - Requestor confirming they received payment
  app.post('/api/claims/:id/claim', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const claim = claims.find(c => c.id === req.params.id && c.requestor_id === user.id);
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    if (claim.status !== ClaimStatus.READY_FOR_CLAIM) {
      return res.status(400).json({ error: 'Claim is not ready for claiming.' });
    }

    const { code } = req.body;
    if (!code || code !== claim.release_code) {
      return res.status(400).json({ error: 'Incorrect Claim Code' });
    }

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
        `${user.name} has confirmed receipt of the payout for ${claimNumber} (${formatPHP(claim.reimbursable_amount ?? Math.min(claim.total_amount, systemSettings.reimbursementCap))}). The claim is now complete — no further action is required.`
      );
    }
    // Confirmation copy to the requestor, matching every other step's pattern.
    sendEmail(
      claim.requestor_id,
      `Reimbursement Completed - ${claimNumber}`,
      `You've confirmed receipt of your reimbursement ${claimNumber} (${formatPHP(claim.reimbursable_amount ?? Math.min(claim.total_amount, systemSettings.reimbursementCap))}). This claim is now complete.`
    );

    res.json(claim);
  });

  // Outbox API
  app.get('/api/outbox', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const base = [UserRole.ADMIN, UserRole.FINANCE].includes(user.role) ? emails : emails.filter(e => e.recipient_id === user.id);
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
      emails.forEach(e => {
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

    // emails: count of unread emails for the user
    const emailsCount = emails.filter(e => e.recipient_id === user.id && !e.read).length;

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
    if (!user || ![UserRole.ADMIN, UserRole.FINANCE].includes(user.role)) return res.status(403).json({ error: 'Forbidden' });

    const enriched = statusHistories.map(h => {
      const claim = claims.find(c => c.id === h.claim_id);
      const changedBy = users.find(u => u.id === h.changed_by);
      const targetUser = h.user_id ? users.find(u => u.id === h.user_id) : undefined;
      return { ...h, claim, changedBy, targetUser };
    }).sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const { page, pageSize, search, limit } = req.query;

    let filtered = enriched;
    if (typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(e =>
        [e.changedBy?.name, e.claim?.claim_number, e.new_status, e.old_status, e.reason, e.targetUser?.name, (e as any).master_data_key]
          .some(v => (v || '').toString().toLowerCase().includes(q))
      );
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

  // --- CASH ADVANCE & LIQUIDATION ENDPOINTS ---

  const recalculateLiquidation = (liquidationId: string) => {
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
    } else {
      filtered = cashAdvances; // Custodian and Admin see all
    }

    const enriched = filtered.map(ca => {
      const requestor = users.find(u => u.id === ca.requestorId);
      const approver = users.find(u => u.id === ca.approverId);
      const mom = ca.momId ? moms.find(m => m.id === ca.momId) : undefined;
      return { ...ca, requestor, approver, mom };
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
  app.post('/api/cash-advances', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
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
    addCaHistory(caId, '', CashAdvanceStatus.DRAFT, user.id, 'Cash Advance Draft Created');
    res.json(cashAdvance);
  });

  // 4. Update cash advance in Draft or Rejected status
  app.put('/api/cash-advances/:id', (req, res) => {
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

    res.json(ca);
  });

  // 5. Submit Cash Advance
  app.post('/api/cash-advances/:id/submit', (req, res) => {
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

    res.json(ca);
  });

  // 6. Approve or Reject Cash Advance
  app.post('/api/cash-advances/:id/approve', (req, res) => {
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
    addCaHistory(ca.id, oldStatus, newStatus, user.id, comment || `Cash Advance ${decision}`);

    sendEmail(
      ca.requestorId,
      `Cash Advance Request ${decision} - CADV-${ca.id.substring(0,6)}`,
      `Your Cash Advance request for PHP ${ca.amount} has been ${decision} by ${user.name}.${comment ? `\n\nComment: ${comment}` : ''}`
    );

    res.json(ca);
  });

  // 7. Release Cash Advance (Custodian only)
  app.post('/api/cash-advances/:id/release', (req, res) => {
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
    ca.releaseReference = releaseReference;
    ca.releaseMethod = releaseMethod;
    addCaHistory(ca.id, oldStatus, CashAdvanceStatus.RELEASED, user.id, `Released via ${releaseMethod} with Voucher Reference: ${releaseReference}`);

    sendEmail(
      ca.requestorId,
      `Cash Advance Released - CADV-${ca.id.substring(0,6)}`,
      `Your Cash Advance for PHP ${ca.amount} has been released by ${user.name}.\n\nRelease Reference: ${releaseReference}\n\nPlease file your liquidation within ${LIQUIDATION_DEADLINE_DAYS} days.`
    );

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
    } else {
      filtered = liquidations; // Custodian and Admin see all
    }

    const enriched = filtered.map(l => {
      const requestor = users.find(u => u.id === l.requestorId);
      const cashAdvance = cashAdvances.find(c => c.id === l.cashAdvanceId);
      const items = liquidationLineItems.filter(item => item.liquidationId === l.id);
      return { ...l, requestor, cashAdvance, lineItems: items };
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
    let hasAccess = false;
    if (user.role === UserRole.REQUESTOR) {
      hasAccess = l.requestorId === user.id;
    } else if (user.role === UserRole.APPROVER) {
      const reporteeIds = users.filter(u => u.reports_to === user.id).map(u => u.id);
      const relatedCa = cashAdvances.find(c => c.id === l.cashAdvanceId);
      hasAccess = l.requestorId === user.id || relatedCa?.approverId === user.id || reporteeIds.includes(l.requestorId) || isActiveDelegateFor(user.id, relatedCa?.approverId);
    } else {
      hasAccess = true; // Custodian and Admin see all
    }
    if (!hasAccess) return res.status(403).json({ error: 'Forbidden' });

    const requestor = users.find(u => u.id === l.requestorId);
    const cashAdvance = cashAdvances.find(c => c.id === l.cashAdvanceId);
    const items = liquidationLineItems.filter(item => item.liquidationId === l.id);

    const history = statusHistories
      .filter(h => h.liquidation_id === l.id)
      .map(h => ({
        ...h,
        changedBy: users.find(u => u.id === h.changed_by)
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({ ...l, requestor, cashAdvance, lineItems: items, history });
  });

  // 10. Initiate liquidation for a Released Cash Advance
  app.post('/api/liquidations', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

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
    addLiqHistory(liquidationId, '', LiquidationStatus.DRAFT, user.id, 'Liquidation Draft Started');
    addCaHistory(ca.id, ca.status, ca.status, user.id, 'Liquidation Started');
    res.json(liquidation);
  });

  // 11. Add a line item to a Liquidation (editable only in Draft or ReturnedForRevision)
  app.post('/api/liquidations/:id/line-items', (req, res) => {
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
      category,
      amount: numericAmount,
      payment_method,
      business_purpose,
      receipt_url,
      attachment_type: attachment_type || 'Official Receipt',
      or_number: or_number || undefined
    };

    liquidationLineItems.push(newItem);
    recalculateLiquidation(l.id);

    res.json(newItem);
  });

  // 12. Update a line item in a Liquidation
  app.put('/api/liquidations/:id/line-items/:itemId', (req, res) => {
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
    if (category !== undefined) item.category = category;
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

    recalculateLiquidation(l.id);
    res.json(item);
  });

  // 13. Delete a line item from a Liquidation
  app.delete('/api/liquidations/:id/line-items/:itemId', (req, res) => {
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
    recalculateLiquidation(l.id);

    res.json({ success: true });
  });

  // 14. Submit a Liquidation report
  app.post('/api/liquidations/:id/submit', (req, res) => {
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

    recalculateLiquidation(l.id);

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

    res.json(l);
  });

  // 15. Approve/Reviewed or Return a Liquidation report (Approver only)
  app.post('/api/liquidations/:id/review', (req, res) => {
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
      recalculateLiquidation(l.id);

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
        const year = new Date().getFullYear();
        const numStr = String(claimCounter++).padStart(6, '0');
        const claimNumber = `REIM-${year}-${numStr}`;

        const shortFallClaim: Claim = {
          id: claimId,
          claim_number: claimNumber,
          requestor_id: l.requestorId,
          current_approver_id: ca.approverId,
          mom_id: ca.momId || '',
          status: ClaimStatus.PROCESSING,
          total_amount: l.varianceAmount,
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

    res.json(l);
  });

  // 16. Collect refund and close Liquidation (Custodian only)
  app.post('/api/liquidations/:id/collect-refund', (req, res) => {
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
  app.post('/api/delegations', (req, res) => {
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
    addDelegationHistory(id, '', DelegationStatus.PENDING, user.id, `Delegation requested to ${delegate.name}`);

    sendEmail(
      delegate_id,
      `Delegation Request from ${user.name}`,
      `${user.name} has asked you to cover their approval duties from ${start_date} to ${end_date}.\n\nPlease log in and Accept or Decline this request from Settings > Approval Delegation. Your decision does not take effect until you respond - claims will keep routing to ${user.name} until then.`
    );

    res.json(delegation);
  });

  // Delegate accepts a Pending request - only now does routing actually change.
  app.post('/api/delegations/:id/accept', (req, res) => {
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
      `${user.name} has accepted your request to cover approvals from ${delegation.start_date} to ${delegation.end_date}. Claims from your direct reports will now route to them for that period.`
    );

    res.json(delegation);
  });

  // Delegate declines - request never takes effect, approver has to pick someone else.
  app.post('/api/delegations/:id/decline', (req, res) => {
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
      `${user.name} has declined your request to cover approvals from ${delegation.start_date} to ${delegation.end_date}.${reason ? `\n\nReason: ${reason}` : ''}\n\nPlease choose a different delegate if you still need coverage for this period.`
    );

    res.json(delegation);
  });

  // Approver cancels their own delegation early, whether it's still Pending
  // or already Active.
  app.post('/api/delegations/:id/cancel', (req, res) => {
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
      `${user.name} has cancelled the delegation ${oldStatus === DelegationStatus.ACTIVE ? 'that was active' : 'request'} covering ${delegation.start_date} to ${delegation.end_date}. ${oldStatus === DelegationStatus.ACTIVE ? 'You no longer need to act on their behalf.' : 'No action is needed.'}`
    );

    res.json(delegation);
  });

  // Admin: Reassign Approver
  app.put('/api/claims/:id/reassign', (req, res) => {
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


    statusHistories.push({
      id: uuidv4(),
      claim_id: claim.id,
      old_status: claim.status,
      new_status: claim.status,
      changed_by: user.id,
      reason: `Admin reassigned from ${oldApproverName} to ${newApproverName}. Reason: ${reason}`,
      timestamp: new Date().toISOString()
    });
    
    res.json(claim);
  });

  // Admin: Seed Data
  app.post('/api/admin/seed', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    try {
      seedYearOfData({
        demoClaims: true,
        demoCashAdvances: true,
        delegations: true,
        historicalBackfill: false,
        reviewMeetings: false,
        supportRequests: false,
      });
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

  function seedYearOfData(options: SeedDataOptions = FULL_SEED_OPTIONS) {
    moms = [];
    claims = [];
    expenses = [];
    approvals = [];
    statusHistories = [];
    emails = [];
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

    users.length = 0;
    users.push(...buildDefaultUsers());
    applyHierarchySyncDefaults(users);

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
      // Roughly 1 in 3 minutes were uploaded as a scanned document rather
      // than filled in via the template form - the real distribution the
      // requestor-facing MOM step supports.
      const isUploaded = momCursor % 3 === 0;
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
        minutes_source: isUploaded ? MinutesSource.UPLOADED : MinutesSource.TEMPLATE,
        meeting_type: MEETING_TYPES[idx],
        participants_internal: internalParticipants,
        participants_external: `${contact}${idx % 2 === 0 ? ', ' + CONTACTS[(idx + 1) % 5] : ''}`,
        custom_fields: { type_of_account: ACCOUNT_TYPES[idx], category: CATEGORIES[idx] },
        ...(isUploaded ? { file_url: '/mom_attachment_placeholder.png', file_name: `${actualClient.replace(/[^a-zA-Z0-9]/g, '_')}_minutes.png` } : {}),
      };
      getOrCreateCompany(actualClient);
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
        requestor_id: opts.requestorId,
        current_approver_id: currentApproverId,
        original_approver_id: opts.approverId,
        mom_id: opts.mom.id,
        status: opts.status,
        total_amount: opts.amount,
        expense_category: opts.category,
        receipt_url: '/receipt_placeholder.png',
        remarks: `Reimbursement for sales meeting with ${opts.mom.client} team.`,
        supporting_documents: 'Proposal_Draft_v1.pdf',
        release_code: isReleaseStage ? (opts.releaseCode || Math.random().toString(36).substring(2, 8).toUpperCase()) : undefined,
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
                  `Your reimbursement of PHP ${Math.min(opts.amount, systemSettings.reimbursementCap)} has been successfully paid out via Cash.`,
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
      total_amount: 3200.00,
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
      amount: 3200.00,
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
      category: 'Travel',
      amount: 4500.00,
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
      amount: 8500.00,
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
      amount: 1500.00,
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
      amount: 6200.00,
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
      amount: 4800.00,
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
      category: 'Travel',
      amount: 12500.00,
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
      amount: 25000.00,
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
      purpose: 'Travel to Cebu',
      approverId: 'u2',
      status: CashAdvanceStatus.SUBMITTED,
      createdAt: rDate(3),
    });
    addCaHistoryWithTimestamp(ca2Id, '', CashAdvanceStatus.DRAFT, 'u5', 'Draft created', rDate(3));
    addCaHistoryWithTimestamp(ca2Id, CashAdvanceStatus.DRAFT, CashAdvanceStatus.SUBMITTED, 'u5', 'Submitted for Approval', rDate(2));
    sendEmail(
      'u2',
      `Cash Advance Request Submitted - CADV-${ca2Id.substring(0,6)}`,
      `A Cash Advance request for PHP 5000 has been submitted by Eve Garcia for your approval.\n\nPurpose: Travel to Cebu`,
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
      getOrCreateCompany(mom.client);
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
    mkMomAndClaim('u15', 'u16', 'Cloud Hosting', 12000, ClaimStatus.COMPLETED, 20);
    mkMomAndClaim('u15', 'u16', 'Team Lunch', 4500, ClaimStatus.REJECTED, 3);
    // Guarantees the default demo login (Olivia, u15) always has a payout to
    // test the release-code confirm flow with, without hunting through seed data.
    mkMomAndClaim('u15', 'u16', 'Client Meals', 4200, ClaimStatus.READY_FOR_CLAIM, 6);
    mkMomAndClaim('u17', 'u18', 'Office Supplies', 6000, ClaimStatus.READY_FOR_CLAIM, 7);
    mkMomAndClaim('u17', 'u18', 'Equipment Repair', 9500, ClaimStatus.COMPLETED, 12);
    // A few more still-undecided claims, spread across different approvers,
    // so there's real material for upcoming (not-yet-happened) review
    // meetings below -- otherwise almost nothing in this seed is still
    // awaiting a decision and the Calendar's current month looks empty.
    mkMomAndClaim('u1', 'u2', 'Client Meals', 3800, ClaimStatus.PENDING_APPROVAL, 1);
    mkMomAndClaim('u6', 'u2', 'Travel', 7200, ClaimStatus.PENDING_APPROVAL, 2);
    mkMomAndClaim('u11', 'u10', 'Transportation', 2100, ClaimStatus.PENDING_APPROVAL, 3);
    mkMomAndClaim('u20', 'u14', 'Event Hosting', 9800, ClaimStatus.PENDING_APPROVAL, 1);
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
        categories: ['Client Meals', 'Travel', 'Accommodation', 'Transportation'],
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

          // Cluster demo reimbursements around the current PHP 1,000 payout
          // cap so the UI visibly includes claims just below and above it.
          let amount = 700 + Math.floor(Math.random() * 701);
          if (category.includes('Hosting') || category.includes('Materials') || category.includes('Repair')) {
            amount += 10000 + Math.floor(Math.random() * 20000);
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
  app.post('/api/admin/seed-year', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    try {
      const requestedOptions = req.body && req.body.options;
      if (requestedOptions && typeof requestedOptions === 'object') {
        const selective: SeedDataOptions = {
          demoClaims: !!requestedOptions.demoClaims,
          demoCashAdvances: !!requestedOptions.demoCashAdvances,
          delegations: !!requestedOptions.delegations,
          historicalBackfill: !!requestedOptions.historicalBackfill,
          reviewMeetings: !!requestedOptions.reviewMeetings,
          supportRequests: !!requestedOptions.supportRequests,
        };
        seedYearOfData(selective);
      } else {
        seedYearOfData();
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
  app.post('/api/admin/reset', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });

    moms = [];
    claims = [];
    expenses = [];
    approvals = [];
    statusHistories = [];
    emails = [];
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

  app.post('/api/support', (req, res) => {
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
      sendEmail(admin.id, user.name, `New Support Request: ${subject}`, `A new support request has been created by ${user.name}.\n\nPriority: ${newRequest.priority}\nSubject: ${subject}\nDescription: ${description}`);
    });
    
    res.status(201).json(newRequest);
  });

  app.post('/api/support/:id/messages', (req, res) => {
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
         sendEmail(request.assigned_admin_id, user.name, `New message on Support Request: ${request.subject}`, message);
      }
    } else {
      sendEmail(request.requestor_id, user.name, `New message on Support Request: ${request.subject}`, message);
    }
    
    res.status(201).json(newMessage);
  });

  app.put('/api/support/:id', (req, res) => {
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
        sendEmail(request.requestor_id, 'System', `Support Request Resolved: ${request.subject}`, 'Your support request has been marked as resolved.');
      }
    }
    
    if (req.body.priority && user.role === UserRole.ADMIN) {
      request.priority = req.body.priority;
    }
    
    if (req.body.assigned_admin_id && user.role === UserRole.ADMIN) {
      request.assigned_admin_id = req.body.assigned_admin_id;
    }
    
    request.updated_at = new Date().toISOString();
    
    res.json(request);
  });

  app.get('/api/imports', (req, res) => {
    const user = getUser(req);
    if (!user || user.role !== UserRole.ADMIN) return res.status(403).json({ error: 'Forbidden' });
    res.json(importBatches);
  });

  app.post('/api/imports', (req, res) => {
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
    importBatches.push(newBatch);

    // Create claims
    for (const record of records) {
      const claimId = uuidv4();
      
      const newClaim: Claim = {
        id: claimId,
        claim_number: record.claim_number || `REIM-${claimCounter++}`,
        requestor_id: record.requestor_id,
        current_approver_id: user.id, // Or whoever, it's historical so doesn't matter much
        mom_id: record.mom_id || '',
        status: ClaimStatus.COMPLETED,
        total_amount: record.total_amount,
        expense_category: record.expense_category,
        receipt_url: record.receipt_url || '',
        remarks: record.remarks || '',
        import_batch_id: batchId,
        created_at: record.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      claims.push(newClaim);
      
      if (record.lineItems && Array.isArray(record.lineItems)) {
        for (const li of record.lineItems) {
          expenses.push({
            id: uuidv4(),
            claim_id: claimId,
            expense_date: li.expense_date || new Date().toISOString().split('T')[0],
            vendor: li.vendor || 'Unknown',
            category: li.category || 'Other',
            amount: li.amount || 0,
            payment_method: li.payment_method || 'Corporate Card',
            business_purpose: li.business_purpose || 'Historical data import',
            receipt_url: li.receipt_url || '',
            or_number: li.or_number || ''
          });
        }
      }
      
      statusHistories.push({
        id: uuidv4(),
        claim_id: claimId,
        old_status: 'Imported',
        new_status: ClaimStatus.COMPLETED,
        changed_by: user.id,
        reason: `Migrated from historical records by ${user.name} (Batch ${batchId.substring(0,6)})`,
        timestamp: new Date().toISOString()
      });
    }

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
  // too, so a fresh serverless cold start has demo data to serve. NOTE: the
  // backend is in-memory — state does not persist across cold starts. That is
  // a deliberate prototype limitation; see PRODUCTION-PASS.md #3 (persistent DB).
  if (process.env.AUTO_SEED !== 'false') {
    try {
      seedYearOfData();
      console.log('Auto-seeded 1 year of mock data on startup.');
    } catch (err: any) {
      console.error('Failed to auto-seed mock data on startup:', err);
    }
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
