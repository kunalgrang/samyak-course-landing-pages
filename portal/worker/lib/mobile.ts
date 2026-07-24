export function normalizeIndianMobile(value: string) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function maskMobile(mobile: string) {
  const lastFour = mobile.slice(-4);
  return `******${lastFour}`;
}
