-- Keep the current public site consistently English until localized content
-- fields are introduced. Event, league, place, race, athlete, and club names
-- remain unchanged.
update public.event_editions
set
  about_text = case slug
    when 'raslina-trail-2026' then
      'Raslina Trail 2026 takes place among olive groves, stone roads, and the shore of Prokljansko jezero. The short race offers a fast and accessible route, while the middle-distance race adds more kilometres and climbing through mixed trail terrain. Both races use existing verified GPX routes, saved galleries, and the official results from the Ši Trail Liga bonus round.'
    when 'trtarski-krug-2026' then
      'Trtarski krug 2026 features short and long trail races on the slopes of Trtar. The routes combine rocky terrain, forest and gravel passages, and open sections overlooking the Šibenik hinterland. The event uses existing verified GPX routes, their galleries, and complete official results from the Ši Trail Liga archive.'
    when 'torak-trail-2026' then
      'Torak Trail 2026 connects two routes through Dalmatian karst, gravel roads, and fast trail sections. The short race offers an accessible, dynamic challenge, while the long race adds distance, climbing, and more changes of pace. Both races use existing verified GPX routes, the start and finish zone at Torak, and official results from the Ši Trail Liga archive.'
    when 'vrpolje-trail-2026-2026' then
      'Vrpolje opens the Ši Trail Liga season with varied terrain and routes that demand a good rhythm from the first to the final kilometre. The routes combine narrow trail sections, rocky terrain, gravel roads, and short paved crossings. The short course offers an accessible but rewarding trail challenge, while the long course adds more climbing, technical sections, and changes of pace. The start and finish zone is located in Vrpolje, with organized parking by the school and easy access to all event facilities.'
    else about_text
  end,
  updated_at = now()
where slug in (
  'raslina-trail-2026',
  'trtarski-krug-2026',
  'torak-trail-2026',
  'vrpolje-trail-2026-2026'
)
  and status = 'completed'
  and public_visibility = 'public';

update public.event_series as series
set
  description = 'The opening round of the Ši Trail Liga takes you onto Vrpolje''s dynamic trails—through singletrack, rocky sections, and gravel roads—with two routes suited to recreational runners and experienced trail racers.',
  updated_at = now()
where exists (
  select 1
  from public.event_editions as edition
  where edition.event_series_id = series.id
    and edition.slug = 'vrpolje-trail-2026-2026'
    and edition.name = 'Vrpolje Trail 2026'
    and edition.status = 'completed'
    and edition.public_visibility = 'public'
);
