export function bienniumStartForYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year)) throw new Error("Enter a valid year");
  return year % 2 === 1 ? year : year - 1;
}

export function activitiesForBiennium(activities, startYear) {
  const start = Number(startYear);
  return activities.filter((activity) => {
    const year = Number(activity.activityYear || String(activity.activityDate || "").slice(0, 4));
    return year === start || year === start + 1;
  });
}

export function availableBienniums(activities, selectedStart, currentYear = new Date().getFullYear()) {
  const currentStart = bienniumStartForYear(currentYear);
  const selected = bienniumStartForYear(selectedStart);
  const recorded = activities
    .map((activity) => Number(activity.activityYear || String(activity.activityDate || "").slice(0, 4)))
    .filter(Number.isInteger)
    .map(bienniumStartForYear);
  const oldest = Math.max(2001, Math.min(currentStart - 10, selected, ...recorded));
  const newest = Math.max(currentStart, selected, ...recorded);
  const options = [];
  for (let start = newest; start >= oldest; start -= 2) options.push(start);
  return options;
}
