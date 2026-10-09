-- The fingerprint of the app's data, used to prove two databases hold the
-- same thing: Neon against UpCloud at cutover (FR-003), a restore against
-- production (deploy/README.md § Restore), an archive against the live
-- database before a pause. Run by verify-copy.sh, which diffs two outputs.
--
-- Output is one `kind|name|value...` line per fact, in a fixed order, so two
-- runs diff cleanly (research R11). Users appear by id only, never by email:
-- this is printed to a terminal and may be pasted into a PR.

-- Row counts per table, alembic_version included: a copy on a different
-- migration would otherwise match everywhere else and still be wrong.
SELECT 'rows', 'alembic_version', count(*) FROM alembic_version
UNION ALL SELECT 'rows', 'categories', count(*) FROM categories
UNION ALL SELECT 'rows', 'email_sends', count(*) FROM email_sends
UNION ALL SELECT 'rows', 'fx_rates', count(*) FROM fx_rates
UNION ALL SELECT 'rows', 'subscription_groups', count(*) FROM subscription_groups
UNION ALL SELECT 'rows', 'subscriptions', count(*) FROM subscriptions
UNION ALL SELECT 'rows', 'users', count(*) FROM users;

SELECT 'migration', version_num, '' FROM alembic_version ORDER BY version_num;

-- Sequence positions. pg_restore sets them; if one were behind, the next
-- insert would collide with a copied id. NULL means never used.
SELECT 'sequence', sequencename, coalesce(last_value::text, 'unused')
FROM pg_sequences
WHERE schemaname = 'public'
ORDER BY sequencename;

-- Per user: subscription count, category count, and the cost total per
-- currency. Totals catch a damaged Numeric that row counts would miss.
SELECT 'user', u.id,
       (SELECT count(*) FROM subscriptions s WHERE s.user_id = u.id),
       (SELECT count(*) FROM categories c WHERE c.user_id = u.id),
       coalesce((SELECT string_agg(t.currency || '=' || t.total, ',' ORDER BY t.currency)
                 FROM (SELECT currency, sum(cost) AS total
                       FROM subscriptions s
                       WHERE s.user_id = u.id
                       GROUP BY currency) AS t), '')
FROM users u
ORDER BY u.id;
