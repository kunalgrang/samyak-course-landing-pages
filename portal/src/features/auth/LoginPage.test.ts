import { describe, expect, it } from "vitest";
import { isCompleteOtp, OTP_LENGTH, otpHelperText, sanitizeOtpInput } from "./LoginPage";

describe("LoginPage OTP field", () => {
  it("uses 4-digit student-facing OTP wording and constraints", () => {
    expect(OTP_LENGTH).toBe(4);
    expect(otpHelperText).toBe("Enter the 4-digit OTP sent to your mobile number.");
    expect(sanitizeOtpInput("12ab3456")).toBe("1234");
    expect(isCompleteOtp("1234")).toBe(true);
    expect(isCompleteOtp("123")).toBe(false);
    expect(isCompleteOtp("12345")).toBe(false);
    expect(isCompleteOtp("12a4")).toBe(false);
  });
});
