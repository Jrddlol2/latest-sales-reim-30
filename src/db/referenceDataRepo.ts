/**
 * Persistence for admin-configured reference data: companies, the six
 * master-data catalogs, field definitions, and system settings. Fourth
 * domain migrated per docs/DATABASE-MIGRATION.md's order.
 *
 * Same pattern as the earlier repos: targeted upserts per mutation,
 * boot-time load only replaces the in-memory arrays when DEMO_MODE=false,
 * every real route writes through regardless of DEMO_MODE. See
 * coreLoopRepo.ts's file header for the full rationale.
 *
 * The six master-data catalogs (departments, cost centers, business units,
 * branches, project codes, vendors) are structurally identical — matching
 * server.ts's own registerMasterDataRoutes() factory — so one generic
 * pair of functions covers all six instead of six near-duplicate modules.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { getDb } from './index';
import {
  companies as companiesTable, fieldDefinitions as fieldDefinitionsTable, systemSettings as systemSettingsTable,
  departments as departmentsTable, costCenters as costCentersTable, businessUnits as businessUnitsTable,
  branches as branchesTable, projectCodes as projectCodesTable, vendors as vendorsTable,
  statusHistories as statusHistoriesTable,
} from './schema';
import type { Company, FieldDefinition, MasterDataRecord, StatusHistory } from '../serverTypes';

export const isDbConfigured = () => !!process.env.DATABASE_URL;

// --- companies ------------------------------------------------------------

function companyToRow(c: Company) {
  return {
    id: c.id,
    name: c.name,
    industry: c.industry ?? null,
    notes: c.notes ?? null,
    address: c.address ?? null,
    businessUnitId: c.business_unit_id || null,
    costCenterId: c.cost_center_id || null,
    defaultDepartmentId: c.default_department_id || null,
    currency: c.currency ?? null,
    taxId: c.tax_id ?? null,
    contactPerson: c.contact_person ?? null,
    contactEmail: c.contact_email ?? null,
    defaultApproverId: c.default_approver_id || null,
  };
}

function companyFromRow(r: typeof companiesTable.$inferSelect): Company {
  return {
    id: r.id,
    name: r.name,
    industry: r.industry ?? undefined,
    notes: r.notes ?? undefined,
    address: r.address ?? undefined,
    business_unit_id: r.businessUnitId ?? undefined,
    cost_center_id: r.costCenterId ?? undefined,
    default_department_id: r.defaultDepartmentId ?? undefined,
    currency: r.currency ?? undefined,
    tax_id: r.taxId ?? undefined,
    contact_person: r.contactPerson ?? undefined,
    contact_email: r.contactEmail ?? undefined,
    default_approver_id: r.defaultApproverId ?? undefined,
  };
}

export async function persistCompany(company: Company): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = companyToRow(company);
  await db.insert(companiesTable).values(row).onConflictDoUpdate({ target: companiesTable.id, set: row });
}

export async function loadCompaniesFromDb(): Promise<Company[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const rows = await db.select().from(companiesTable);
  return rows.map(companyFromRow);
}

// --- master data catalogs (generic across all six) -------------------------

const MASTER_DATA_TABLES = {
  departments: departmentsTable,
  'cost-centers': costCentersTable,
  'business-units': businessUnitsTable,
  branches: branchesTable,
  'project-codes': projectCodesTable,
  vendors: vendorsTable,
} as const;

export type MasterDataKey = keyof typeof MASTER_DATA_TABLES;

function masterDataToRow(r: MasterDataRecord) {
  return {
    id: r.id,
    name: r.name,
    code: r.code ?? null,
    active: r.active,
    notes: r.notes ?? null,
  };
}

function masterDataFromRow<T extends MasterDataRecord>(row: {
  id: string; name: string; code: string | null; active: boolean; notes: string | null;
  createdAt: Date; updatedAt: Date;
}): T {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? undefined,
    active: row.active,
    notes: row.notes ?? undefined,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  } as T;
}

export async function persistMasterDataRecord(key: MasterDataKey, record: MasterDataRecord): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const table = MASTER_DATA_TABLES[key];
  const row = masterDataToRow(record);
  await db.insert(table).values(row).onConflictDoUpdate({ target: table.id, set: row });
}

export async function loadMasterDataTable<T extends MasterDataRecord>(key: MasterDataKey): Promise<T[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const table = MASTER_DATA_TABLES[key];
  const rows = await db.select().from(table);
  return rows.map((r: any) => masterDataFromRow<T>(r));
}

// --- field definitions ------------------------------------------------

function fieldDefinitionToRow(f: FieldDefinition) {
  return {
    id: f.id,
    entity: f.entity,
    applicableClaimTypes: f.applicableClaimTypes ?? null,
    key: f.key,
    label: f.label,
    inputType: f.input_type,
    required: f.required,
    active: f.active,
    defaultValue: f.default_value ?? null,
    displayOrder: f.display_order,
    options: f.options ?? null,
    masterDataEntity: f.master_data_entity ?? null,
    allowOther: f.allow_other ?? false,
    validation: f.validation ? JSON.stringify(f.validation) : null,
  };
}

function fieldDefinitionFromRow(r: typeof fieldDefinitionsTable.$inferSelect): FieldDefinition {
  return {
    id: r.id,
    entity: r.entity,
    applicableClaimTypes: (r.applicableClaimTypes ?? undefined) as FieldDefinition['applicableClaimTypes'],
    key: r.key,
    label: r.label,
    input_type: r.inputType,
    required: r.required,
    active: r.active,
    default_value: r.defaultValue ?? undefined,
    display_order: r.displayOrder,
    options: r.options ?? undefined,
    master_data_entity: (r.masterDataEntity ?? undefined) as FieldDefinition['master_data_entity'],
    allow_other: r.allowOther ?? undefined,
    validation: r.validation ? JSON.parse(r.validation) : undefined,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export async function persistFieldDefinition(field: FieldDefinition): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = fieldDefinitionToRow(field);
  await db.insert(fieldDefinitionsTable).values(row).onConflictDoUpdate({ target: fieldDefinitionsTable.id, set: row });
}

export async function loadFieldDefinitionsFromDb(): Promise<FieldDefinition[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const rows = await db.select().from(fieldDefinitionsTable);
  return rows.map(fieldDefinitionFromRow);
}

// --- system settings (singleton row) ---------------------------------------

export interface SystemSettingsShape {
  expenseCategories: string[];
  highValueThreshold: number;
  paymentMethods: string[];
  categoryLimits: Record<string, number>;
}

export async function persistSystemSettings(settings: SystemSettingsShape): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  const row = {
    id: 'default',
    expenseCategories: settings.expenseCategories,
    highValueThreshold: String(settings.highValueThreshold),
    paymentMethods: settings.paymentMethods,
    categoryLimits: JSON.stringify(settings.categoryLimits || {}),
  };
  await db.insert(systemSettingsTable).values(row).onConflictDoUpdate({ target: systemSettingsTable.id, set: row });
}

/**
 * Deletes every company, master-data, and field-definition row. Used only by
 * POST /api/admin/reset, which immediately reseeds fresh defaults afterward
 * (via persistCompany/persistMasterDataRecord/persistFieldDefinition, called
 * per reseeded record from server.ts). Companies reference master-data ids
 * (business_unit_id, cost_center_id, default_department_id), so they're
 * cleared first.
 */
export async function clearReferenceDataInDb(): Promise<void> {
  if (!isDbConfigured()) return;
  const db = getDb();
  await db.transaction(async (tx: typeof db) => {
    await tx.delete(companiesTable);
    for (const table of Object.values(MASTER_DATA_TABLES)) {
      await tx.delete(table);
    }
    await tx.delete(fieldDefinitionsTable);
  });
}

export async function loadSystemSettingsFromDb(): Promise<SystemSettingsShape | undefined> {
  if (!isDbConfigured()) return undefined;
  const db = getDb();
  const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.id, 'default'));
  const row = rows[0];
  if (!row) return undefined;
  return {
    expenseCategories: row.expenseCategories,
    highValueThreshold: Number(row.highValueThreshold),
    paymentMethods: row.paymentMethods,
    categoryLimits: row.categoryLimits ? JSON.parse(row.categoryLimits) : {},
  };
}

function masterDataHistoryFromRow(r: typeof statusHistoriesTable.$inferSelect): StatusHistory {
  return {
    id: r.id,
    claim_id: '',
    master_data_key: r.masterDataKey ?? undefined,
    master_data_id: r.masterDataId ?? undefined,
    old_status: r.oldStatus,
    new_status: r.newStatus,
    changed_by: r.changedBy,
    reason: r.reason ?? undefined,
    timestamp: r.timestamp.toISOString(),
  };
}

/**
 * Loads master-data audit history (departments/cost-centers/business-units/
 * branches/project-codes/vendors edits made via the generic master-data
 * routes) from the shared status_histories table. Was previously write-only:
 * addMasterDataHistory() pushed into the in-memory array but nothing
 * persisted or reloaded it, so these entries vanished on every restart.
 */
export async function loadMasterDataHistoryFromDb(): Promise<StatusHistory[]> {
  if (!isDbConfigured()) return [];
  const db = getDb();
  const rows = await db.select().from(statusHistoriesTable)
    .where(and(isNotNull(statusHistoriesTable.masterDataKey), isNotNull(statusHistoriesTable.masterDataId)));
  return rows.map(masterDataHistoryFromRow);
}
