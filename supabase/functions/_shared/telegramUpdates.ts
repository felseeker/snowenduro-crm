type TelegramChat = { id: number; type: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Return only chat identifiers for people who explicitly started the bot. */
export function extractStartedChats(
  updates: unknown,
): Array<{ chatId: string; type: string }> {
  if (!Array.isArray(updates)) return [];

  const chats = new Map<string, string>();
  for (const update of updates) {
    if (!isRecord(update) || !isRecord(update.message)) continue;
    const message = update.message;
    if (
      typeof message.text !== "string" ||
      !/^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(message.text)
    )
      continue;
    if (!isRecord(message.chat)) continue;

    const chat = message.chat as unknown as TelegramChat;
    if (
      !Number.isSafeInteger(chat.id) ||
      !["private", "group", "supergroup"].includes(chat.type)
    )
      continue;
    const chatId = String(chat.id);
    if (!chats.has(chatId)) chats.set(chatId, chat.type);
  }

  return Array.from(chats, ([chatId, type]) => ({ chatId, type }));
}
