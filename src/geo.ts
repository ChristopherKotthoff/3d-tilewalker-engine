import { Vector3, Matrix4, MathUtils } from "three";
import type { TilesRenderer } from "3d-tiles-renderer/three";
import type { LatLng } from "./types";

const _ecef = new Vector3();
const _inv = new Matrix4();
const _carto = { lat: 0, lon: 0, height: 0 };

/**
 * Convert a lat/lng (degrees) to a position in the re-centered Three.js world.
 *
 * The ReorientationPlugin has transformed `tiles.group` so that our reference
 * lat/lon sits at the origin with +Y up. So: lat/lng -> ECEF (via the ellipsoid)
 * -> apply the group's world matrix to land in the same recentered space the
 * streamed geometry lives in.
 *
 * `height` is metres above the ellipsoid; the exact value barely matters because
 * we snap Y to the ground by raycast anyway — we just need X/Z right.
 */
export function latLngToWorld(
  tiles: TilesRenderer,
  ll: LatLng,
  height = 0,
  target = new Vector3(),
): Vector3 {
  tiles.ellipsoid.getCartographicToPosition(
    MathUtils.degToRad(ll.lat),
    MathUtils.degToRad(ll.lng),
    height,
    _ecef,
  );
  target.copy(_ecef).applyMatrix4(tiles.group.matrixWorld);
  return target;
}

/** Inverse of latLngToWorld: recentered world XYZ -> lat/lng (degrees). */
export function worldToLatLng(tiles: TilesRenderer, world: Vector3): LatLng {
  _inv.copy(tiles.group.matrixWorld).invert();
  _ecef.copy(world).applyMatrix4(_inv);
  tiles.ellipsoid.getPositionToCartographic(_ecef, _carto);
  return {
    lat: MathUtils.radToDeg(_carto.lat),
    lng: MathUtils.radToDeg(_carto.lon),
  };
}
