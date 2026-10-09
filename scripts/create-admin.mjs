import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!url || !serviceKey || !email || !password) {
  console.error(
    "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL and ADMIN_PASSWORD for this command.",
  );
  process.exit(1);
}
if (password.length < 14) {
  console.error("ADMIN_PASSWORD must be at least 14 characters.");
  process.exit(1);
}

const client = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let user = null;
for (let page = 1; page <= 20; page += 1) {
  const { data, error } = await client.auth.admin.listUsers({
    page,
    perPage: 1000,
  });
  if (error) fail("Unable to inspect administrator accounts.");
  user =
    data.users.find((candidate) => candidate.email?.toLowerCase() === email) ??
    null;
  if (user || data.users.length < 1000) break;
}

if (user) {
  const { data: salesRecord, error } = await client
    .from("sales")
    .select("administrator")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || salesRecord?.administrator !== true)
    fail(
      "This account exists but is not the administrator. No account settings were changed.",
    );
  process.stdout.write(
    "The administrator account is already ready. Its password was not changed.\n",
  );
} else {
  const { count, error: countError } = await client
    .from("sales")
    .select("id", { count: "exact", head: true });
  if (countError) fail("Unable to verify that this is the first CRM account.");
  if ((count ?? 0) !== 0)
    fail(
      "An account already exists. Use the current administrator account instead of creating a second one.",
    );

  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: "SnowEnduro", last_name: "Administrator" },
  });
  if (error || !data.user) fail("Unable to create the administrator account.");
  const { data: salesRecord, error: salesError } = await client
    .from("sales")
    .select("administrator")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (salesError || salesRecord?.administrator !== true)
    fail(
      "The account was created, but the database did not assign administrator access. Stop setup and inspect the auth trigger.",
    );
  process.stdout.write(
    "The first administrator account is ready. The password was not printed.\n",
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
