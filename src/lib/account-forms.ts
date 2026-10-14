import { z } from "astro/zod";
import {
  avatarUrlField,
  bioField,
  formValues,
  parseWith,
  type ParseResult,
} from "./admin-forms";

// Validation for the player self-service forms under `/account`. Players can
// only touch their bio and avatar; everything else stays admin-only.

const profileSchema = z.object({
  bio: bioField,
  avatarUrl: avatarUrlField,
});

export type ProfileInput = z.output<typeof profileSchema>;

export function parseProfileForm(form: FormData): ParseResult<ProfileInput> {
  const values = formValues(form);
  return parseWith(
    profileSchema,
    { bio: values.bio ?? "", avatarUrl: values.avatarUrl ?? "" },
    values,
  );
}

export const MIN_PASSWORD_LENGTH = 12;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Required."),
    newPassword: z
      .string()
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      )
      .max(128, "Keep it under 128 characters."),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match.",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a different password from your current one.",
  });

export type PasswordInput = z.output<typeof passwordSchema>;

export function parsePasswordForm(form: FormData): ParseResult<PasswordInput> {
  const values = formValues(form);
  return parseWith(
    passwordSchema,
    {
      currentPassword: values.currentPassword ?? "",
      newPassword: values.newPassword ?? "",
      confirmPassword: values.confirmPassword ?? "",
    },
    // Never echo passwords back into a re-rendered form.
    {},
  );
}
