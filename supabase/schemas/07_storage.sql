--
-- Storage
-- This file declares storage bucket policies.
--

create policy "Attachments 1mt4rzk_0" on storage.objects for select to authenticated using (bucket_id = 'attachments');
create policy "Attachments 1mt4rzk_1" on storage.objects for insert to authenticated with check (bucket_id = 'attachments');
create policy "Attachments 1mt4rzk_3" on storage.objects for delete to authenticated using (bucket_id = 'attachments');

-- SnowEnduro catalog photos are private to the authenticated administrator.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-images', 'catalog-images', false, 12582912, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy catalog_images_admin_read on storage.objects for select to authenticated using (bucket_id = 'catalog-images' and public.is_admin());
create policy catalog_images_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'catalog-images' and public.is_admin());
create policy catalog_images_admin_update on storage.objects for update to authenticated using (bucket_id = 'catalog-images' and public.is_admin()) with check (bucket_id = 'catalog-images' and public.is_admin());
create policy catalog_images_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'catalog-images' and public.is_admin());
