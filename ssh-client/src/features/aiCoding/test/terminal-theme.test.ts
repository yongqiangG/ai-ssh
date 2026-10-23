import { describe, expect, test } from "vitest";
import {
  DARK_THEME,
  LIGHT_THEME,
  minimumContrastRatioFor,
  themeFor,
} from "../components/terminalShared";

describe("terminal theme helpers", () => {
  test("maps each variant to its hand-tuned xterm palette", () => {
    expect(themeFor("dark")).toBe(DARK_THEME);
    expect(themeFor("light")).toBe(LIGHT_THEME);
  });

  test("keeps the hand-tuned dark palette without auto contrast lift", () => {
    expect(minimumContrastRatioFor("dark")).toBe(1);
  });

  test("lifts low-contrast ANSI on light backgrounds (nezha parity)", () => {
    expect(minimumContrastRatioFor("light")).toBe(4.5);
  });
});
