"""Extract an OSM-derived search index, including multipolygon POIs.
Requires: pip install osmium==4.3.1 shapely==2.2.0
Coordinates represent the mapped object, not a verified taxi entrance.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import osmium
from shapely.geometry import shape, LineString

BOUNDS = (80.30, 47.90, 80.55, 48.05)
POI_KEYS = ('amenity', 'shop', 'office', 'craft', 'industrial', 'healthcare', 'tourism', 'leisure', 'railway')
KEYS = ('addr:housenumber', 'name', 'name:ru', 'name:kk') + POI_KEYS

def inside(lon, lat):
    return BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]

def extract(source, target):
    entries = {}
    skipped = collections.Counter()
    factory = osmium.geom.GeoJSONFactory()
    objects = osmium.FileProcessor(str(source)).with_locations().with_areas()
    objects = objects.with_filter(osmium.filter.KeyFilter(*KEYS))
    for obj in objects:
        if obj.is_relation():
            continue  # Area relations are handled by the assembled area object.
        tags = dict(obj.tags)
        names = list(dict.fromkeys(tags[k].strip() for k in ('name:ru','name','name:kk') if tags.get(k,'').strip()))
        house = tags.get('addr:housenumber','').strip()
        street = tags.get('addr:street','').strip()
        place = tags.get('addr:place','').strip()
        is_street = bool(tags.get('highway') and names)
        is_poi = bool(names and (any(tags.get(k) for k in POI_KEYS) or tags.get('building') or tags.get('man_made') or tags.get('place')))
        if not (house or is_street or is_poi):
            continue
        try:
            if obj.is_node():
                if not obj.location.valid():
                    skipped['invalid_node'] += 1; continue
                lon, lat = obj.lon, obj.lat
                osm_type, osm_id, precision = 'node', obj.id, 'osm_point'
            elif obj.is_way():
                if obj.is_closed() and not is_street:
                    continue  # Prefer assembled polygon, including its inner rings.
                coords = [(n.lon,n.lat) for n in obj.nodes if n.location.valid()]
                if len(coords) != len(obj.nodes) or len(coords) < 2:
                    skipped['incomplete_way'] += 1; continue
                if not any(inside(x,y) for x,y in coords):
                    continue
                p = LineString(coords).interpolate(0.5, normalized=True)
                lon, lat = p.x, p.y
                osm_type, osm_id, precision = 'way', obj.id, 'line_midpoint'
            elif obj.is_area():
                # Reject remote areas before constructing Shapely geometry.
                if not any(inside(n.lon,n.lat) for ring in obj.outer_rings() for n in ring if n.location.valid()):
                    continue
                geometry = shape(json.loads(factory.create_multipolygon(obj)))
                if geometry.is_empty or not geometry.is_valid:
                    skipped['invalid_area'] += 1; continue
                p = geometry.representative_point()
                lon, lat = p.x, p.y
                osm_type = 'way' if obj.from_way() else 'relation'
                osm_id, precision = obj.orig_id(), 'point_inside_polygon'
            else:
                continue
            if not inside(lon,lat):
                continue
            address = ', '.join(v for v in (street or place, house) if v)
            if house:
                label = ((names[0] + ' — ') if names else '') + (address if street or place else 'дом ' + house)
                kind = 'address'
            else:
                label, kind = names[0], 'street' if is_street else 'place'
            entry = dict(label=label, kind=kind, lon=round(lon,7), lat=round(lat,7),
                osmType=osm_type, osmId=osm_id, coordinateType=precision, aliases=names,
                street=street, housenumber=house, city=tags.get('addr:city',''),
                category=next((tags[k] for k in POI_KEYS if tags.get(k)), tags.get('highway','')))
            entry['searchText'] = ' '.join(dict.fromkeys([label] + names + [street,place,house]))
            entries[(osm_type,osm_id)] = entry
        except (osmium.InvalidLocationError, ValueError, RuntimeError) as exc:
            skipped[type(exc).__name__] += 1
    result = sorted(entries.values(),key=lambda p:(p['kind'],p['label'],p['osmType'],p['osmId']))
    target = Path(target)
    target.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    with open(source,'rb') as source_stream:
        source_hash = hashlib.file_digest(source_stream,'sha256').hexdigest()
    report = dict(sourceFile=Path(source).name,sourceBytes=Path(source).stat().st_size,
        sourceSha256=source_hash,bounds=BOUNDS,
        entries=len(result),kinds=dict(collections.Counter(p['kind'] for p in result)),
        osmTypes=dict(collections.Counter(p['osmType'] for p in result)),skipped=dict(skipped),
        attribution='© OpenStreetMap contributors',license='ODbL-1.0',
        limitations=['Coordinates of ways and areas represent objects, not verified pickup entrances.',
            'Street segments remain separate OSM objects.',
            'No missing street or house names inferred; associatedStreet relations not used to fill addresses.',
            'Objects absent from OSM cannot be found.'])
    target.with_name('search-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('--output',type=Path,default=Path('addresses.json'))
    args=parser.parse_args()
    extract(args.source,args.output)
