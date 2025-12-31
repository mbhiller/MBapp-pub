export { parseMbappQr, type MbappQr } from "./qr";
export {
  resolveScan,
  looksLikeEpc,
  looksLikeInventoryId,
  type ResolveEpcFn,
  type ScanResolveResult,
  type ScanResolution,
  type ScanResolutionError,
} from "./scanResolve";
export {
  pickBestMatchingLineId,
  incrementCapped,
  type GetLineId,
  type GetLineItemId,
  type GetRemaining,
} from "./scanLineSelect";
