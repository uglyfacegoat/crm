export const fontScaleOptions = ["compact", "standard", "large"] as const;
export const digitStyleOptions = ["proportional", "tabular"] as const;
export const appearanceThemeOptions = ["light", "dark"] as const;

export type FontScale = (typeof fontScaleOptions)[number];
export type DigitStyle = (typeof digitStyleOptions)[number];
export type AppearanceTheme = (typeof appearanceThemeOptions)[number];

export const FONT_SCALE_COOKIE = "crm_font_scale";
export const DIGIT_STYLE_COOKIE = "crm_digit_style";
export const APPEARANCE_THEME_COOKIE = "crm_appearance_theme";

export function parseFontScale(value: string | undefined): FontScale {
  return fontScaleOptions.includes(value as FontScale) ? value as FontScale : "standard";
}

export function parseDigitStyle(value: string | undefined): DigitStyle {
  return digitStyleOptions.includes(value as DigitStyle) ? value as DigitStyle : "proportional";
}

export function parseAppearanceTheme(value: string | undefined): AppearanceTheme {
  return appearanceThemeOptions.includes(value as AppearanceTheme) ? value as AppearanceTheme : "light";
}
