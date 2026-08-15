import { describe, expect, test } from "vitest";
import {
  DARK_THEME,
  minimumContrastRatioFor,
  themeFor,
} from "../components/terminalShared";

describe("terminal theme helpers", () => {
  test("always returns the dark xterm palette (single dark theme)", () => {
    expect(themeFor("dark")).toBe(DARK_THEME);
  });

  test("keeps the hand-tuned dark palette without auto contrast lift", () => {
    expect(minimumContrastRatioFor("dark")).toBe(1);
  });
});
