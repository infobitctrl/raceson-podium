alter table public.league_seasons
  add column if not exists organizer_rules text;

comment on column public.league_seasons.organizer_rules is
  'Organizer-authored rules published with this league season.';

alter table public.event_editions
  add column if not exists organizer_rules text;

comment on column public.event_editions.organizer_rules is
  'Organizer-authored rules published on this event edition public page.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'league_seasons_organizer_rules_length_check'
      and conrelid = 'public.league_seasons'::regclass
  ) then
    alter table public.league_seasons
      add constraint league_seasons_organizer_rules_length_check
      check (organizer_rules is null or char_length(organizer_rules) <= 20000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'event_editions_organizer_rules_length_check'
      and conrelid = 'public.event_editions'::regclass
  ) then
    alter table public.event_editions
      add constraint event_editions_organizer_rules_length_check
      check (organizer_rules is null or char_length(organizer_rules) <= 20000);
  end if;
end
$$;

update public.league_seasons season
set organizer_rules = $rules$
ŠIBENSKA TRAIL LIGA — PRAVILA SEZONE / ŠIBENIK TRAIL LEAGUE — SEASON RULES

1. Primjena / Scope
Ova pravila uređuju ligašku prihvatljivost, bodovanje, poredak i prigovore. Uvjeti prijave, obvezna oprema, staza, vremenska ograničenja, povrati i sigurnosne upute objavljuju se za svaki događaj zasebno. Na dan utrke sigurnosne upute organizatora događaja imaju prednost, ali ne mijenjaju prešutno ligaško bodovanje.
These rules govern league eligibility, scoring, standings, and protests. Entry terms, mandatory equipment, course, cut-offs, refunds, and safety instructions are published separately for each event. Event-organizer safety directions prevail on race day but do not silently change league scoring.

2. Prihvatljivost i rezultat / Eligibility and result
U poredak ulazi sportaš s valjanom prijavom i objavljenim službenim ili ispravljenim rezultatom u mapiranoj utrci. DNS, DNF, diskvalifikacija i poništen rezultat ne dobivaju bodove za plasman. Kategorija, dob i klupska pripadnost utvrđuju se prema objavljenoj konfiguraciji sezone i zapisu rezultata.
A valid entry and an official or corrected result in a mapped race are required for the standings. DNS, DNF, disqualification, and void results receive no placing points. Category, age, and club attribution follow the published season configuration and result record.

3. Bodovanje / Scoring
Mjerodavna je strukturirana tablica bodova prikazana ispod ovih pravila. Sezona ima sedam planiranih kola, a najboljih pet rezultata ulazi u pojedinačni zbroj. Bodovi za kasniji službeni završetak, najmanji broj nastupa, način rješavanja izjednačenja i klupski zbroj primjenjuju se točno kako su objavljeni u tablicama pravila platforme.
The structured points table displayed below is authoritative. The season has seven planned rounds and the best five results count toward an individual total. Later-finisher points, minimum appearances, tie-break method, and club aggregation apply exactly as published in the platform rule tables.

4. Objave, ispravci i prigovori / Publication, corrections, and protests
Liga se ažurira nakon službene objave rezultata događaja. Ispravljeni rezultat zamjenjuje prethodni rezultat u sljedećem ligaškom izračunu uz vidljiv trag ispravka. Prigovor se podnosi organizatoru u roku od 72 sata od relevantne objave, osim ako događaj objavi kraći sigurnosni rok. Organizator mora obrazložiti odluku i ispraviti zahvaćene poretke.
The league updates after an event publishes official results. A corrected result replaces the earlier result in the next league calculation with correction history preserved. Protests must reach the organizer within 72 hours of the relevant publication unless an event publishes a shorter safety deadline. The organizer must explain the decision and correct affected standings.

5. Pošteno natjecanje i izmjene / Fair competition and changes
Zabranjeni su lažni identiteti, zamjena startnog broja, skraćivanje staze, propuštanje obvezne kontrole, manipulacija vremenom ili GPS dokazom te ometanje drugih. Bitne promjene vrijede unaprijed i moraju biti objavljene prijavljenim sudionicima. Retroaktivna promjena dopuštena je samo radi ispravka pogreške, sigurnosti ili primjene mjerodavnog pravila, uz obrazloženje i ponovni izračun.
False identity, bib swapping, course cutting, missed mandatory checkpoints, manipulation of timing or GPS evidence, and interference with others are prohibited. Material changes apply prospectively and must be notified to registered participants. A retroactive change is limited to correcting an error, protecting safety, or applying an existing rule, with reasons and recalculation.

6. Privatnost / Privacy
Javni ligaški zapis ograničen je na podatke potrebne za rezultate i poredak, primjerice ime, klub, kategoriju, vrijeme, plasman i bodove. Kontakt za hitne slučajeve, zdravstveni podaci, podaci o plaćanju i privatni GPS zapisi nisu dio javnog poretka. Za prava na pristup, ispravak, brisanje, ograničenje ili prigovor vrijedi obavijest Pravila, privatnost i pravne informacije te obavijest odgovornog organizatora.
The public league record is limited to data needed for results and standings, such as name, club, category, time, place, and points. Emergency contact, health, payment, and private GPS data are not part of public standings. Access, correction, erasure, restriction, and objection rights are explained in the Rules, privacy & legal center and the responsible organizer's notice.
$rules$
from public.leagues league
where league.id = season.league_id
  and league.slug in (
    'sibenska-trail-liga',
    'si-trail-liga',
    's-i-trail-liga',
    'sibenik-trail-league'
  )
  and nullif(btrim(season.organizer_rules), '') is null;
