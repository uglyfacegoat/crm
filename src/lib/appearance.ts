export const fontScaleOptions = ["compact", "standard", "large"] as const;
export const digitStyleOptions = ["proportional", "tabular"] as const;

export type FontScale = (typeof fontScaleOptions)[number];
export type DigitStyle = (typeof digitStyleOptions)[number];

export const FONT_SCALE_COOKIE = "crm_font_scale";
export const DIGIT_STYLE_COOKIE = "crm_digit_style";

export function parseFontScale(value: string | undefined): FontScale {
  return fontScaleOptions.includes(value as FontScale) ? value as FontScale : "standard";
}

export function parseDigitStyle(value: string | undefined): DigitStyle {
  return digitStyleOptions.includes(value as DigitStyle) ? value as DigitStyle : "proportional";
}
