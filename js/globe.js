/**
 * globe.js — the Earth as a ball, for when the map is zoomed right out.
 *
 * Leaflet, which draws everything else here, only knows flat maps. So when you
 * zoom out to the whole world the flat map steps aside and this takes its
 * place: the same map style, wrapped round a sphere you can spin, with your
 * position, the destination and the route drawn on it. Zoom back in and the flat
 * map returns at the same place.
 *
 * It needs MapLibre GL v5 (v4 has no globe) and WebGL; `createGlobe` returns
 * null-safe methods, and `open` says whether it worked so the caller can stay
 * on the flat map if it did not.
 */

import { buildGlobeStyle, registerMarkers } from "./mapstyle.js";

export function createGlobe(container, { overture = false } = {}) {
  let map = null;
  let satellite = false;
  let trip = null;                    // what to draw: { origin, destination, path, estimate }
  let originMarker = null;
  let destMarker = null;
  let zoomListener = () => {};
  let ready = false;                  // the style has loaded, so layers can be added

  /** A round marker made of one element. */
  const dot = (size, fill, ring) => {
    const d = document.createElement("div");
    d.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${fill};border:${ring}px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)`;
    return d;
  };

  function drawTrip() {
    if (!map) return;
    const at = (p) => (p ? [p.lon, p.lat] : null);

    for (const [name, marker] of [["origin", originMarker], ["destination", destMarker]]) {
      const p = trip && trip[name];
      if (!p && marker) {
        marker.remove();
        if (name === "origin") originMarker = null; else destMarker = null;
      } else if (p) {
        if (!marker) {
          const made = new maplibregl.Marker({ element: name === "origin" ? dot(16, "#1a73e8", 3) : dot(20, "#ea4335", 3) });
          if (name === "origin") originMarker = made; else destMarker = made;
        }
        (name === "origin" ? originMarker : destMarker).setLngLat(at(p)).addTo(map);
      }
    }

    if (!ready) return;                                // the "style.load" listener draws it then
    const path = trip && trip.path && trip.path.length > 1 ? trip.path : null;
    if (!path) {
      for (const id of ["trip-line", "trip-casing"]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource("trip")) map.removeSource("trip");
      return;
    }
    const data = { type: "Feature", geometry: { type: "LineString", coordinates: path.map((p) => [p.lon, p.lat]) } };
    if (map.getSource("trip")) { map.getSource("trip").setData(data); }
    else {
      map.addSource("trip", { type: "geojson", data });
      const layout = { "line-cap": "round", "line-join": "round" };
      map.addLayer({ id: "trip-casing", type: "line", source: "trip", layout, paint: { "line-color": "#ffffff", "line-width": 7 } });
      map.addLayer({ id: "trip-line", type: "line", source: "trip", layout, paint: { "line-color": "#1a73e8", "line-width": 4 } });
    }
    // An estimate (a flight, a boat) is dotted, as on the flat map.
    map.setPaintProperty("trip-line", "line-dasharray", trip.estimate ? [0.1, 2.2] : null);
    map.setPaintProperty("trip-casing", "line-dasharray", trip.estimate ? [0.1, 2.2] : null);
  }

  return {
    /** Show the globe, looking at [lng, lat]. Returns false if it cannot be drawn here. */
    open({ center, zoom, isSatellite, padding }) {
      try {
        if (typeof maplibregl === "undefined") return false;
        if (!map) {
          map = new maplibregl.Map({
            container,
            style: buildGlobeStyle({ overture, satellite: !!isSatellite }),
            center, zoom, padding: padding || {},
            minZoom: 0.4, maxZoom: 3.6,
            maxPitch: 0, attributionControl: false,
            dragRotate: false, pitchWithRotate: false, touchPitch: false,
          });
          satellite = !!isSatellite;
          map.jumpTo({ center, zoom, padding: padding || {} });     // the padding keeps the ball clear of the sheet
          registerMarkers(map);                        // the same round place markers and dots
          map.touchZoomRotate.disableRotation();
          map.on("style.load", () => { ready = true; drawTrip(); });
          map.on("zoomend", () => zoomListener(map.getZoom()));
        } else {
          map.jumpTo({ center, zoom, padding: padding || {} });
          if (!!isSatellite !== satellite) this.setSatellite(!!isSatellite);
          map.resize();
        }
        drawTrip();
        return true;
      } catch (err) {
        map = null;
        return false;
      }
    },
    /** Where it is looking now, so the flat map can take over from the same spot. */
    view() {
      return map ? { center: map.getCenter().wrap(), zoom: map.getZoom() } : null;
    },
    setSatellite(on) {
      if (!map || on === satellite) return;
      satellite = on;
      ready = false;
      map.setStyle(buildGlobeStyle({ overture, satellite: on }));
    },
    /** What to draw on the ball: { origin, destination, path, estimate }. */
    setTrip(next) { trip = next; drawTrip(); },
    turnTo(center) { if (map) map.easeTo({ center, duration: 400 }); },
    zoomIn() { if (map) map.zoomIn(); },
    zoomOut() { if (map) map.zoomOut(); },
    panBy(dx, dy) { if (map) map.panBy([dx, dy], { animate: false }); },
    resize() { if (map) map.resize(); },
    onZoom(fn) { zoomListener = fn; },
    get map() { return map; },
  };
}
