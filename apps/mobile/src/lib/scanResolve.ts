import {
  resolveScan as sharedResolveScan,
  type ScanResolveResult,
  type ScanResolution,
  type ScanResolutionError,
  looksLikeEpc,
  looksLikeInventoryId,
} from "@mbapp/scan";
import { resolveEpc } from "../features/_shared/epc";

export { looksLikeEpc, looksLikeInventoryId };
export type { ScanResolveResult, ScanResolution, ScanResolutionError };

export async function resolveScan(scan: string): Promise<ScanResolveResult> {
  return sharedResolveScan(scan, { resolveEpc });
}
