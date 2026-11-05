export const distributionPercent = (count: number, total: number): string => {
  if (!count || !total) return "0%";
  const percent = count * 100 / total;
  return percent < .1 ? "<0.1%" : `${Number(percent.toFixed(1))}%`;
};
