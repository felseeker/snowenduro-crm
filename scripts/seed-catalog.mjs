import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for this command.",
  );
  process.exit(1);
}

const catalog = JSON.parse(
  await readFile(
    new URL("../supabase/seed/catalog.json", import.meta.url),
    "utf8",
  ),
);
if (!Array.isArray(catalog) || catalog.length === 0) {
  console.error("The checked-in catalog seed is empty or invalid.");
  process.exit(1);
}
for (const [index, product] of catalog.entries()) {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug) ||
    !product.name ||
    !["snowbike", "snowmobile"].includes(product.category)
  ) {
    console.error(`Catalog seed record ${index + 1} is invalid.`);
    process.exit(1);
  }
}

const client = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const rows = catalog.map((product, index) => ({
  slug: product.slug,
  name: product.name,
  category: product.category,
  data: product,
  availability: "on_order",
  is_published: true,
  sort_order: index,
}));
const { data, error } = await client
  .from("products")
  .upsert(rows, {
    onConflict: "slug",
    ignoreDuplicates: true,
  })
  .select("slug");
if (error) {
  console.error("Unable to add the initial catalog to the database.");
  process.exit(1);
}
process.stdout.write(
  `Added ${data?.length ?? 0} new products. Existing product records were not overwritten or deleted.\n`,
);
