import { describe, expect, it } from "vitest";
import {
  describeChoiceRule,
  describeVoteOutcome,
  MIN_PASSWORD_LENGTH,
  parseBallot,
  parsePasswordForm,
  parseProfileForm,
  parseWalletAction,
  VOTE_OUTCOMES,
  type VoteOutcome,
} from "./account-forms";
import type { ParseResult } from "./admin-forms";

function formData(fields: Record<string, string | string[]> = {}): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      data.append(name, v);
    }
  }
  return data;
}

function errorsOf<T>(result: ParseResult<T>) {
  if (result.ok) throw new Error("Expected the form to be rejected.");
  return result.errors;
}

describe("parseProfileForm", () => {
  it("parses a bio and avatar", () => {
    expect(
      parseProfileForm(
        formData({ bio: " Likes engines. ", avatarUrl: "/avatars/ada.png" }),
      ),
    ).toEqual({
      ok: true,
      data: { bio: "Likes engines.", avatarUrl: "/avatars/ada.png" },
      values: { bio: " Likes engines. ", avatarUrl: "/avatars/ada.png" },
    });
  });

  it("clears blank fields", () => {
    const result = parseProfileForm(formData());
    expect(result.ok && result.data).toEqual({ bio: null, avatarUrl: null });
  });

  it("ignores fields players can't change", () => {
    const result = parseProfileForm(formData({ name: "Mallory", id: "x" }));
    expect(result.ok && result.data).toEqual({ bio: null, avatarUrl: null });
  });

  it("rejects a long bio and a bad avatar", () => {
    expect(
      errorsOf(
        parseProfileForm(
          formData({
            bio: "b".repeat(501),
            avatarUrl: "http://example.com/a.png",
          }),
        ),
      ),
    ).toEqual({
      bio: "Keep it under 500 characters.",
      avatarUrl: "Use an https:// URL or a site path starting with /.",
    });
  });
});

describe("parsePasswordForm", () => {
  const newPassword = "correct horse battery";
  const valid = {
    currentPassword: "old password!",
    newPassword,
    confirmPassword: newPassword,
  };

  it("parses a password change", () => {
    expect(parsePasswordForm(formData(valid))).toEqual({
      ok: true,
      data: valid,
      values: {},
    });
  });

  it("never echoes passwords back", () => {
    const result = parsePasswordForm(
      formData({ ...valid, confirmPassword: "typo" }),
    );
    expect(result.values).toEqual({});
  });

  it("requires the current password", () => {
    expect(
      errorsOf(parsePasswordForm(formData({ ...valid, currentPassword: "" }))),
    ).toEqual({ currentPassword: "Required." });
  });

  it("needs a long enough new password", () => {
    const short = "s".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(
      errorsOf(
        parsePasswordForm(
          formData({ ...valid, newPassword: short, confirmPassword: short }),
        ),
      ),
    ).toEqual({ newPassword: "Use at least 12 characters." });

    const exact = "s".repeat(MIN_PASSWORD_LENGTH);
    expect(
      parsePasswordForm(
        formData({ ...valid, newPassword: exact, confirmPassword: exact }),
      ).ok,
    ).toBe(true);
  });

  it("caps the new password at 128 characters", () => {
    const long = "l".repeat(129);
    expect(
      errorsOf(
        parsePasswordForm(
          formData({ ...valid, newPassword: long, confirmPassword: long }),
        ),
      ),
    ).toEqual({ newPassword: "Keep it under 128 characters." });
  });

  it("doesn't trim passwords", () => {
    const spaced = ` ${newPassword} `;
    expect(
      errorsOf(parsePasswordForm(formData({ ...valid, newPassword: spaced }))),
    ).toEqual({ confirmPassword: "Passwords don't match." });
  });

  it("requires the confirmation to match", () => {
    expect(
      errorsOf(
        parsePasswordForm(
          formData({ ...valid, confirmPassword: `${newPassword}!` }),
        ),
      ),
    ).toEqual({ confirmPassword: "Passwords don't match." });
  });

  it("requires a different password", () => {
    expect(
      errorsOf(
        parsePasswordForm(formData({ ...valid, currentPassword: newPassword })),
      ),
    ).toEqual({
      newPassword: "Choose a different password from your current one.",
    });
  });

  it("treats missing fields as blank", () => {
    expect(errorsOf(parsePasswordForm(formData()))).toMatchObject({
      currentPassword: "Required.",
      newPassword: "Use at least 12 characters.",
    });
  });
});

describe("parseBallot", () => {
  const options = [{ id: 1 }, { id: 2 }, { id: 3 }].map((o) => ({
    ...o,
    label: `Option ${o.id}`,
  }));
  const single = { options, minChoices: 1, maxChoices: 1 } as Parameters<
    typeof parseBallot
  >[1];
  const multiple = { ...single, minChoices: 2, maxChoices: 3 };

  it("accepts a single choice", () => {
    expect(parseBallot(formData({ choice: "2" }), single)).toEqual({
      ok: true,
      optionIds: [2],
    });
  });

  it("accepts several choices, dropping repeats", () => {
    expect(
      parseBallot(formData({ choice: ["3", "1", "3"] }), multiple),
    ).toEqual({ ok: true, optionIds: [3, 1] });
  });

  it("rejects choices that aren't this poll's options", () => {
    for (const choice of [["4"], ["1", "99"], ["one"], [""]]) {
      expect(parseBallot(formData({ choice }), multiple)).toEqual({
        ok: false,
        outcome: "invalid",
      });
    }
  });

  it("rejects too few choices", () => {
    expect(parseBallot(formData(), single)).toEqual({
      ok: false,
      outcome: "too-few",
    });
    expect(parseBallot(formData({ choice: ["1", "1"] }), multiple)).toEqual({
      ok: false,
      outcome: "too-few",
    });
  });

  it("rejects too many choices", () => {
    expect(parseBallot(formData({ choice: ["1", "2"] }), single)).toEqual({
      ok: false,
      outcome: "too-many",
    });
  });
});

describe("describeChoiceRule", () => {
  it.each([
    [1, 1, "pick one"],
    [2, 2, "pick 2"],
    [1, 3, "pick 1–3"],
  ])("describes %i–%i as %j", (minChoices, maxChoices, rule) => {
    expect(describeChoiceRule({ minChoices, maxChoices })).toBe(rule);
  });
});

describe("describeVoteOutcome", () => {
  const poll = {
    minChoices: 1,
    maxChoices: 2,
    voteBonusPoints: 2,
    bonusTaskId: "week-01",
  };

  it("mentions the bonus when a vote counts", () => {
    expect(describeVoteOutcome("voted", poll)).toEqual({
      tone: "success",
      message: "Vote counted: +2 bonus points.",
    });
    expect(
      describeVoteOutcome("voted", { ...poll, voteBonusPoints: 1 }).message,
    ).toBe("Vote counted: +1 bonus point.");
  });

  it("mentions the bonus lost when a vote is withdrawn", () => {
    expect(describeVoteOutcome("retracted", poll).message).toBe(
      "Vote withdrawn, along with your 2 bonus points.",
    );
  });

  it("leaves the bonus out when there isn't one", () => {
    for (const noBonus of [
      { ...poll, voteBonusPoints: 0 },
      { ...poll, bonusTaskId: undefined },
    ]) {
      expect(describeVoteOutcome("voted", noBonus).message).toBe(
        "Vote counted.",
      );
      expect(describeVoteOutcome("retracted", noBonus).message).toBe(
        "Vote withdrawn.",
      );
    }
  });

  it("explains a wrong number of choices with the rule", () => {
    expect(describeVoteOutcome("too-few", poll)).toEqual({
      tone: "error",
      message: "Not enough options picked: pick 1–2.",
    });
    expect(describeVoteOutcome("too-many", poll).message).toBe(
      "Too many options picked: pick 1–2.",
    );
  });

  it("describes every outcome", () => {
    const tones = Object.fromEntries(
      VOTE_OUTCOMES.map((o) => [o, describeVoteOutcome(o, poll).tone]),
    );
    expect(tones).toEqual({
      voted: "success",
      changed: "success",
      retracted: "success",
      "not-open": "error",
      locked: "error",
      "too-few": "error",
      "too-many": "error",
      invalid: "error",
    } satisfies Record<VoteOutcome, string>);
    for (const outcome of VOTE_OUTCOMES) {
      expect(describeVoteOutcome(outcome, poll).message).not.toBe("");
    }
  });
});

describe("parseWalletAction", () => {
  const parse = (fields: Record<string, string>) =>
    parseWalletAction(formData(fields));

  it("parses equip and unequip", () => {
    expect(parse({ intent: "equip", itemId: "duck" })).toEqual({
      intent: "equip",
      itemId: "duck",
    });
    expect(parse({ intent: "unequip", slot: "pet" })).toEqual({
      intent: "unequip",
      slot: "pet",
    });
    expect(parse({ intent: "unequip", slot: "hat" })).toBeUndefined();
  });

  it("needs a target for Sabotage and none for anything else", () => {
    const use = { intent: "use", taskId: "w2" };
    expect(
      parse({ ...use, effect: "sabotage", targetPlayerId: "bob" }),
    ).toEqual({
      intent: "use",
      effect: "sabotage",
      taskId: "w2",
      targetPlayerId: "bob",
    });
    expect(parse({ ...use, effect: "sabotage" })).toBeUndefined();
    expect(
      parse({ ...use, effect: "hint", targetPlayerId: "bob" }),
    ).toBeUndefined();
    expect(parse({ ...use, effect: "hint" })).toMatchObject({
      effect: "hint",
      targetPlayerId: null,
    });
  });

  it("rejects unknown intents and effects", () => {
    expect(parse({ intent: "steal" })).toBeUndefined();
    expect(
      parse({ intent: "use", taskId: "w2", effect: "nuke" }),
    ).toBeUndefined();
  });

  it("never uses a passive power-up", () => {
    for (const effect of ["shield", "mirror", "insurance"]) {
      expect(parse({ intent: "use", taskId: "w2", effect })).toBeUndefined();
    }
  });

  it("parses a gift within the weekly cap, with an optional note", () => {
    const gift = { intent: "gift", toPlayerId: "bob" };
    expect(parse({ ...gift, amount: "3", message: "  nice   work " })).toEqual({
      intent: "gift",
      toPlayerId: "bob",
      amount: 3,
      message: "nice work",
    });
    expect(parse({ ...gift, amount: "1" })).toMatchObject({ message: null });
    for (const amount of ["0", "6", "-1", "1.5", "two", ""]) {
      expect(parse({ ...gift, amount })).toBeUndefined();
    }
    expect(
      parse({ ...gift, amount: "1", message: "x".repeat(81) }),
    ).toBeUndefined();
    expect(parse({ intent: "gift", amount: "1" })).toBeUndefined();
  });
});
