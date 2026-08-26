import { getChangeStatusAsync } from './operation.mjs';

export async function handleStatus(changeSlug) {
  const report = await getChangeStatusAsync(changeSlug);
  console.log(JSON.stringify({
    change: report.change,
    branch: report.branch,
    location: report.location,
    ...report.stage,
  }, null, 2));
}
