do $$
begin
  create type ticket_status as enum ('WAITING', 'CALLING', 'IN_PROGRESS', 'COMPLETED', 'ABSENT');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type client_profile as enum ('PN', 'TE');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type service_type as enum ('CAJA', 'SERVICIO_CLIENTE');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type station_type as enum ('CAJA', 'CUBICULO');
exception when duplicate_object then null;
end $$;

create table if not exists workday_sessions (
  id uuid primary key default gen_random_uuid(),
  session_date date not null default current_date,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by text
);

create table if not exists stations (
  id uuid primary key default gen_random_uuid(),
  station_type station_type not null,
  label text not null,
  active boolean not null default true,
  current_ticket_id uuid,
  employee_name text
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  sequence int not null,
  profile client_profile not null,
  service_type service_type not null,
  status ticket_status not null default 'WAITING',
  station_id uuid references stations(id),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  called_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
);

create table if not exists priority_state (
  service_type service_type primary key,
  te_served_since_switch int not null default 0,
  current_ratio_te int not null default 1
);

create table if not exists daily_sequence (
  service_type service_type not null,
  profile client_profile not null,
  seq_date date not null default current_date,
  last_value int not null default 0,
  primary key (service_type, profile, seq_date)
);

with numbered_cubiculos as (
  select id, row_number() over (order by id) as station_number
  from stations
  where station_type = 'CUBICULO'
)
update stations
set label = chr(64 + numbered_cubiculos.station_number::int)
from numbered_cubiculos
where stations.id = numbered_cubiculos.id;

create or replace function generate_ticket_code(p_service_type service_type, p_profile client_profile)
returns text
language plpgsql
as $$
declare
  v_seq int;
  v_prefix text;
begin
  insert into daily_sequence (service_type, profile, seq_date, last_value)
  values (p_service_type, p_profile, current_date, 1)
  on conflict (service_type, profile, seq_date)
  do update set last_value = daily_sequence.last_value + 1
  returning last_value into v_seq;

  v_prefix := case
    when p_profile = 'TE' then 'TE'
    when p_service_type = 'CAJA' then 'C'
    else 'SC'
  end;

  return v_prefix || '-' || lpad(v_seq::text, 3, '0');
end;
$$;

create or replace function call_next_ticket(p_service_type service_type, p_station_id uuid)
returns tickets
language plpgsql
as $$
declare
  v_chosen tickets%rowtype;
begin
  if not exists (
    select 1 from stations where id = p_station_id and active = true
  ) then
    return null;
  end if;

  select * into v_chosen
  from tickets
  where service_type = p_service_type
    and status = 'WAITING'
    and profile = 'TE'
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then
    select * into v_chosen
    from tickets
    where service_type = p_service_type
      and status = 'WAITING'
      and profile = 'PN'
    order by created_at asc
    limit 1
    for update skip locked;
  end if;

  if not found then
    return null;
  end if;

  update tickets
  set status = 'CALLING',
      station_id = p_station_id,
      called_at = now(),
      started_at = now(),
      completed_at = null
  where id = v_chosen.id
  returning * into v_chosen;

  update stations
  set current_ticket_id = v_chosen.id
  where id = p_station_id;

  return v_chosen;
end;
$$;
