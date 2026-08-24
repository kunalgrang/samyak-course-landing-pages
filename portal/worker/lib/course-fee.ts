export const BASIS_POINTS_DENOMINATOR = 10000;

// Future organisation settings source. V1 locks Samyak course fee GST at 18%.
export function getCourseFeeGstBasisPoints() {
  return 1800;
}

export function roundDivNearestPaise(numerator: number, denominator: number) {
  assertNonNegativeInteger(numerator, "numerator");
  assertPositiveInteger(denominator, "denominator");
  if (!Number.isSafeInteger(numerator + Math.floor(denominator / 2))) throw new Error("Money calculation exceeds safe integer range");
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function calculatePreGstAmountPaise(inclusiveAmountPaise: number, gstBasisPoints: number) {
  assertNonNegativeInteger(inclusiveAmountPaise, "inclusive amount");
  assertNonNegativeInteger(gstBasisPoints, "GST basis points");
  return roundDivNearestPaise(inclusiveAmountPaise * BASIS_POINTS_DENOMINATOR, BASIS_POINTS_DENOMINATOR + gstBasisPoints);
}

export function calculatePartnerCommissionPaise(preGstAmountPaise: number, commissionBasisPoints: number) {
  assertNonNegativeInteger(preGstAmountPaise, "pre-GST amount");
  assertBasisPoints(commissionBasisPoints, "commission basis points");
  return roundDivNearestPaise(preGstAmountPaise * commissionBasisPoints, BASIS_POINTS_DENOMINATOR);
}

export function assertBasisPoints(value: number, label: string) {
  assertNonNegativeInteger(value, label);
  if (value > BASIS_POINTS_DENOMINATOR) throw new Error(`${label} must be at most 10000`);
}

function assertNonNegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}
