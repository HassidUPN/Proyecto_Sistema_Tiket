create type ticket_status as enum ('WAITING', 'CALLING', 'IN_PROGRESS', 'COMPLETED', 'ABSENT');
create type client_profile as enum ('PN', 'TE');
create type service_type as enum ('CAJA', 'SERVICIO_CLIENTE');
create type station_type as enum ('CAJA', 'CUBICULO');

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
  v_state priority_state%rowtype;
  v_pn_count int;
  v_ratio_te int;
  v_chosen tickets%rowtype;
begin
  select * into v_state
  from priority_state
  where service_type = p_service_type
  for update;

  if not found then
    insert into priority_state (service_type, te_served_since_switch, current_ratio_te)
    values (p_service_type, 0, 1)
    returning * into v_state;
  end if;

  select count(*) into v_pn_count
  from tickets
  where service_type = p_service_type
    and profile = 'PN'
    and status = 'WAITING';

  v_ratio_te := case when v_pn_count < 5 then 2 else 1 end;

  if v_ratio_te <> v_state.current_ratio_te then
    v_state.te_served_since_switch := 0;
  end if;

  if v_state.te_served_since_switch < v_ratio_te then
    select * into v_chosen
    from tickets
    where service_type = p_service_type
      and profile = 'TE'
      and status = 'WAITING'
    order by created_at asc
    limit 1
    for update skip locked;
  end if;

  if not found then
    select * into v_chosen
    from tickets
    where service_type = p_service_type
      and profile = 'PN'
      and status = 'WAITING'
    order by created_at asc
    limit 1
    for update skip locked;

    if found then
      update priority_state
      set te_served_since_switch = 0,
          current_ratio_te = v_ratio_te
      where service_type = p_service_type;
    end if;
  else
    update priority_state
    set te_served_since_switch = v_state.te_served_since_switch + 1,
        current_ratio_te = v_ratio_te
    where service_type = p_service_type;
  end if;

  if not found then
    return null;
  end if;

  update tickets
  set status = 'CALLING',
      station_id = p_station_id,
      called_at = now(),
      started_at = null,
      completed_at = null
  where id = v_chosen.id
  returning * into v_chosen;

  update stations
  set current_ticket_id = v_chosen.id
  where id = p_station_id;

  return v_chosen;
end;
$$;
