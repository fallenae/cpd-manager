import { MRTB_REQUIREMENTS } from "./requirements.mjs";

const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateAudit(state, requirements = MRTB_REQUIREMENTS) {
  const startYear = Number(state.settings.bienniumStart);
  const years = [startYear, startYear + 1];
  const activities = state.activities.filter((activity) => years.includes(Number(activity.activityYear)));
  const totals = {
    total: 0,
    substantive: 0,
    general: 0,
    byYear: Object.fromEntries(years.map((year) => [year, 0]))
  };

  for (const activity of activities) {
    const hours = Number(activity.hours) || 0;
    totals.total += hours;
    totals[activity.type === "substantive" ? "substantive" : "general"] += hours;
    totals.byYear[activity.activityYear] += hours;
  }

  for (const key of ["total", "substantive", "general"]) totals[key] = round(totals[key]);
  for (const year of years) totals.byYear[year] = round(totals.byYear[year]);

  const evidence = activities.flatMap((activity) =>
    activity.attachments.map((attachment) => ({
      ...attachment,
      activityId: activity.id,
      activityName: activity.name,
      activityDate: activity.activityDate,
      activityYear: activity.activityYear,
      activityType: activity.type
    }))
  );
  const selectedEvidence = evidence.filter((item) => item.auditSelected);
  const selectedReflections = activities
    .flatMap((activity) => activity.reflections.map((reflection) => ({ ...reflection, activityName: activity.name })))
    .filter((reflection) => reflection.auditSelected);
  const reflectionCounts = Object.fromEntries(requirements.reflectionCategories.map((category) => [category, 0]));
  for (const reflection of selectedReflections) {
    if (reflection.category in reflectionCounts) reflectionCounts[reflection.category] += 1;
  }

  const checks = {
    profile: Boolean(state.settings.fullName?.trim() && state.settings.registrationNumber?.trim()),
    totalHours: totals.total >= requirements.totalHours,
    substantiveHours: totals.substantive >= requirements.minimumSubstantiveHours,
    generalHours: totals.general <= requirements.maximumGeneralHours,
    annualHours: years.every((year) => totals.byYear[year] >= requirements.minimumHoursPerYear),
    evidenceCount: selectedEvidence.length === requirements.evidenceFiles,
    substantiveEvidence:
      selectedEvidence.filter((item) => item.activityType === "substantive").length >= requirements.minimumSubstantiveEvidence,
    evidenceAcrossYears: years.every((year) => selectedEvidence.some((item) => Number(item.activityYear) === year)),
    evidenceIdentity: selectedEvidence.length > 0 && selectedEvidence.every((item) => item.nameConfirmed && item.dateConfirmed),
    reflections: requirements.reflectionCategories.every((category) => reflectionCounts[category] === 1),
    peerDeclaration: Boolean(state.peerDeclaration)
  };

  return {
    years,
    totals,
    evidence,
    selectedEvidence,
    selectedReflections,
    reflectionCounts,
    checks,
    ready: Object.values(checks).every(Boolean)
  };
}
