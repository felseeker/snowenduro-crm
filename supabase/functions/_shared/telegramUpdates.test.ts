import { describe, expect, it } from "vitest";
import { extractStartedChats } from "./telegramUpdates.ts";

describe("extractStartedChats", () => {
  it("returns unique private and group chats that explicitly sent /start", () => {
    const updates = [
      { message: { text: "/start", chat: { id: 123, type: "private" } } },
      {
        message: {
          text: "/start@SnowEnduroBot invite",
          chat: { id: -100123, type: "supergroup" },
        },
      },
      { message: { text: "/start", chat: { id: 123, type: "private" } } },
      { message: { text: "hello", chat: { id: 456, type: "private" } } },
      { message: { text: "/starting", chat: { id: 789, type: "private" } } },
    ];

    expect(extractStartedChats(updates)).toEqual([
      { chatId: "123", type: "private" },
      { chatId: "-100123", type: "supergroup" },
    ]);
  });

  it("ignores malformed updates, unsafe IDs, and unsupported chat types", () => {
    expect(
      extractStartedChats([
        null,
        {
          message: {
            text: "/start",
            chat: { id: Number.MAX_SAFE_INTEGER + 1, type: "private" },
          },
        },
        { message: { text: "/start", chat: { id: 4, type: "channel" } } },
      ]),
    ).toEqual([]);
    expect(extractStartedChats({ result: [] })).toEqual([]);
  });
});
