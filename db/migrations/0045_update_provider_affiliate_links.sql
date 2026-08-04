-- Keep public provider entry points on the operator-supplied affiliate URLs.
-- Matching stays limited to active platform channels and uses provider aliases
-- plus known provider domains so existing channel IDs and API endpoints remain
-- unchanged.
with affiliate_targets(provider_key, aliases, domains, affiliate_url) as (
  values
    (
      'ccsub',
      array['ccsub', 'cc sub'],
      array['ccsub.net'],
      'https://www.ccsub.net/go/VWP3GKKD'
    ),
    (
      'runapi',
      array['runapi', 'run api'],
      array['runapi.co'],
      'https://runapi.co/register?aff=DW73'
    ),
    (
      'aicodemirror',
      array['aicodemirror', 'ai code mirror'],
      array['aicodemirror.com', 'claudecode.net.cn'],
      'https://www.aicodemirror.com/register?invitecode=Y61TP9'
    ),
    (
      'crazyrouter',
      array['crazyrouter', 'crazy router'],
      array['crazyrouter.com'],
      'https://crazyrouter.com/register?aff=XCYN'
    ),
    (
      'apikey_fun',
      array['apikey.fun', 'apikey fun', 'api key fun'],
      array['apikey.fun'],
      'https://apikey.fun/register?aff=WF5QUC4NWV4K'
    ),
    (
      'apinebula',
      array['apinebula', 'api nebula'],
      array['apinebula.com'],
      'https://apinebula.com/kn9g18'
    )
),
candidate_channels as (
  select
    c.id,
    lower(trim(c.name)) as name_key,
    lower(trim(c.provider)) as provider_key,
    lower(
      split_part(
        split_part(regexp_replace(coalesce(c.endpoint, ''), '^https?://', '', 'i'), '/', 1),
        ':',
        1
      )
    ) as endpoint_host,
    lower(
      split_part(
        split_part(regexp_replace(coalesce(c.official_site_url, ''), '^https?://', '', 'i'), '/', 1),
        ':',
        1
      )
    ) as official_host
  from channels c
  where c.owner_type = 'platform'
    and c.deleted_at is null
    and c.status <> 'deleted'
),
matched_channels as (
  select distinct on (c.id)
    c.id,
    t.affiliate_url
  from candidate_channels c
  join affiliate_targets t on
    exists (
      select 1
      from unnest(t.aliases) as alias_value(value)
      where c.provider_key = alias_value.value
        or c.name_key = alias_value.value
        or c.provider_key like '%' || alias_value.value || '%'
        or c.name_key like '%' || alias_value.value || '%'
    )
    or exists (
      select 1
      from unnest(t.domains) as domain_value(value)
      where c.endpoint_host = domain_value.value
        or c.endpoint_host like '%.' || domain_value.value
        or c.official_host = domain_value.value
        or c.official_host like '%.' || domain_value.value
    )
  order by c.id, t.provider_key
),
updated_channels as (
  update channels c
  set
    official_site_url = m.affiliate_url,
    updated_at = now()
  from matched_channels m
  where c.id = m.id
    and c.official_site_url is distinct from m.affiliate_url
  returning c.id
)
update recommend_picks rp
set
  cta_label = '去官方体验',
  cta_url = m.affiliate_url,
  updated_at = now()
from matched_channels m
where rp.channel_id = m.id
  and (
    rp.cta_label is distinct from '去官方体验'
    or rp.cta_url is distinct from m.affiliate_url
  );
