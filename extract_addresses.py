"""Создаёт локальный поисковый индекс адресов/улиц Аягоза из файла OSM."""
import json
from pathlib import Path
import osmium

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'kazakhstan-261008.osm.pbf'
OUTPUT = ROOT / 'addresses.json'
WEST, SOUTH, EAST, NORTH = 80.30, 47.90, 80.55, 48.05


def inside(lon, lat):
    return WEST <= lon <= EAST and SOUTH <= lat <= NORTH


def tags_get(tags, key):
    # PyOsmium TagList поддерживает get, если тег отсутствует, возвращает None.
    return tags.get(key) or ''


class Extract(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.addresses = []
        self.streets = {}
        self.places = {}

    def record(self, tags, lon, lat, road=False):
        street = tags_get(tags, 'addr:street') or tags_get(tags, 'addr:place')
        number = tags_get(tags, 'addr:housenumber')
        name = tags_get(tags, 'name:ru') or tags_get(tags, 'name')
        if number:
            label = (street + ', ' + number) if street else ('Дом ' + number)
            self.addresses.append({'label': label, 'lon': round(lon, 6),
                                   'lat': round(lat, 6), 'kind': 'address'})
        if road and name and name.casefold() not in self.streets:
            self.streets[name.casefold()] = {'label': name, 'lon': round(lon, 6),
                                              'lat': round(lat, 6), 'kind': 'street'}
        if tags_get(tags, 'place') and name and name.casefold() not in self.places:
            self.places[name.casefold()] = {'label': name, 'lon': round(lon, 6),
                                            'lat': round(lat, 6), 'kind': 'place'}

    def node(self, n):
        if n.location.valid():
            lon, lat = n.location.lon, n.location.lat
            if inside(lon, lat):
                self.record(n.tags, lon, lat)

    def way(self, w):
        if not (tags_get(w.tags, 'addr:housenumber') or tags_get(w.tags, 'highway')):
            return
        coords = [(p.lon, p.lat) for p in w.nodes if p.location.valid()]
        if not coords:
            return
        # Для карты поиска используем примерный центр объекта.
        lon = sum(p[0] for p in coords) / len(coords)
        lat = sum(p[1] for p in coords) / len(coords)
        if inside(lon, lat):
            self.record(w.tags, lon, lat, road=bool(tags_get(w.tags, 'highway')))


if not SOURCE.exists():
    raise SystemExit(f'Не найден {SOURCE.name} в {ROOT}')
handler = Extract()
handler.apply_file(str(SOURCE), locations=True)
# Убираем точные повторы адресных точек, оставляя разные дома с одинаковым номером.
unique = {}
for item in handler.addresses:
    key = (item['label'].casefold(), item['lon'], item['lat'])
    unique[key] = item
items = list(unique.values()) + list(handler.streets.values()) + list(handler.places.values())
items.sort(key=lambda item: (item['kind'], item['label'].casefold()))
OUTPUT.write_text(json.dumps(items, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(f'Готово! Адресов: {len(unique)}, улиц: {len(handler.streets)}, мест: {len(handler.places)}')
print(f'Создан файл: {OUTPUT} ({OUTPUT.stat().st_size:,} байт)')
