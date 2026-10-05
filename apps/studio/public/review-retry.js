// Retry malformed model feedback once, inside the original time budget. Never retry a cancellation.
export function retryReview(error,{attempt=0,elapsedMs=0,aborted=false}={}) {
  return !aborted && attempt===0 && elapsedMs<80_000 && error?.retryable===true && ['INCONSISTENT_REVIEW','INVALID_MODEL_RESPONSE'].includes(error.code);
}
