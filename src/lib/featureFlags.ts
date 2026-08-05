import { ClaimType } from '../types';

/**
 * Soft-launch gates for claim types whose end-to-end workflow is built and
 * tested but not yet cleared for real users (a business decision, not a
 * technical gap). Flip a flag to `true` to launch that type — no other code
 * change is needed: the submit picker, deep links, dashboard CTAs, and the
 * server create routes all read these same constants.
 */
const STATIC_CLAIM_TYPE_ENABLED: Record<ClaimType, boolean> = {
  Reimbursement: true,
  'Transport Reimbursement': true,
  'Cash Advance': false,
  Liquidation: false,
};

/**
 * Runtime escape hatch: with `ENABLE_ALL_CLAIM_TYPES=1` in the environment,
 * every type is creatable regardless of the static defaults above — used by
 * the workflow test suite (which exercises the full advance→liquidation loop)
 * and available to ops for a controlled rollout without a code change.
 *
 * `typeof process` is guarded so the browser bundle, where `process` doesn't
 * exist, simply falls through to the static defaults.
 */
function allClaimTypesForced(): boolean {
  return typeof process !== 'undefined' && !!process.env && process.env.ENABLE_ALL_CLAIM_TYPES === '1';
}

export function isClaimTypeEnabled(type: ClaimType): boolean {
  if (allClaimTypesForced()) return true;
  return STATIC_CLAIM_TYPE_ENABLED[type] !== false;
}

/** Shown wherever a gated type is surfaced but not yet creatable. */
export const COMING_SOON_MESSAGE =
  'This request type is coming soon. It isn’t available to submit yet — please use General or Transport Reimbursement in the meantime.';
