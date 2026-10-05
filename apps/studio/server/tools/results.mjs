// Shared response projection for tool execution and project candidates. Keep
// paths and large intermediate pixel states behind the local runtime boundary.
export const toolPreviewSummary=preview=>preview?Object.fromEntries(['width','height','pixelHash','frameSpecHash'].map(key=>[key,preview[key]])):undefined;
export const publicToolRun=result=>({...result,records:result.records.map(({before,after,preview,...record})=>({...record,preview:toolPreviewSummary(preview)}))});
