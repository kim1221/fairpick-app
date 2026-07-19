import { Accuracy, getCurrentLocation, Storage as TossStorage } from '@apps-in-toss/framework';

export type CurrentCoords = {
  lat: number;
  lng: number;
};

const KEY_LAST_COORDS = 'location:lastCoords';
// 캐시 좌표로 먼저 그리고, 새 GPS가 이만큼 벗어났을 때만 재검증을 요청한다.
const SIGNIFICANT_MOVE_METERS = 500;
// 권한이 이미 허용된 상태에서 첫 GPS 응답을 기다려 줄 최대 시간.
const GPS_TIMEOUT_MS = 2500;

async function loadCachedCoords(): Promise<CurrentCoords | null> {
  try {
    const raw = await TossStorage.getItem(KEY_LAST_COORDS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CurrentCoords>;
    if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) return null;
    return { lat: parsed.lat as number, lng: parsed.lng as number };
  } catch {
    return null;
  }
}

async function saveCachedCoords(coords: CurrentCoords): Promise<void> {
  try {
    await TossStorage.setItem(KEY_LAST_COORDS, JSON.stringify(coords));
  } catch {
    // 저장 실패는 무시 — 다음 진입에서 GPS를 한 번 더 기다릴 뿐이다.
  }
}

function distanceMeters(a: CurrentCoords, b: CurrentCoords): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, s)));
}

async function readGpsCoords(): Promise<CurrentCoords | null> {
  const location = await getCurrentLocation({ accuracy: Accuracy.Balanced });
  const { latitude, longitude } = location.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { lat: latitude, lng: longitude };
}

export async function getCurrentCoordsOrNull(): Promise<CurrentCoords | null> {
  try {
    // PermissionStatus = 'notDetermined' | 'denied' | 'allowed'
    // notDetermined이면 getCurrentLocation 호출이 OS 권한 요청을 트리거하므로 그대로 진행해요.
    const permission = await getCurrentLocation.getPermission();
    if (permission === 'denied') {
      return null;
    }

    const coords = await readGpsCoords();
    if (coords) void saveCachedCoords(coords);
    return coords;
  } catch {
    return null;
  }
}

/**
 * 첫 페인트를 막지 않는 좌표 확보.
 * - 캐시가 있으면 즉시 반환하고, 신선한 GPS는 뒤에서 받아 500m 이상 이동했을 때만 onMoved로 알린다.
 * - 캐시가 없고 권한이 허용 상태면 GPS를 GPS_TIMEOUT_MS까지만 기다린다.
 *   늦으면 null을 반환해 화면을 먼저 그리고, GPS가 도착하면 onMoved로 알린다.
 * - 권한 미결정이면 OS 팝업을 띄워야 하므로 타임아웃 없이 기다린다(첫 카드 배정의 지역성 보장).
 */
export async function getStartupCoords(
  onMoved?: (fresh: CurrentCoords) => void,
): Promise<CurrentCoords | null> {
  try {
    const permission = await getCurrentLocation.getPermission();
    if (permission === 'denied') {
      return null;
    }

    const cached = permission === 'allowed' ? await loadCachedCoords() : null;

    const gpsPromise = readGpsCoords()
      .then((fresh) => {
        if (fresh) void saveCachedCoords(fresh);
        return fresh;
      })
      .catch(() => null);

    if (cached) {
      void gpsPromise.then((fresh) => {
        if (fresh && distanceMeters(cached, fresh) > SIGNIFICANT_MOVE_METERS) {
          onMoved?.(fresh);
        }
      });
      return cached;
    }

    if (permission === 'notDetermined') {
      return await gpsPromise;
    }

    const raced = await Promise.race([
      gpsPromise,
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), GPS_TIMEOUT_MS);
      }),
    ]);
    if (raced !== 'timeout') {
      return raced;
    }
    void gpsPromise.then((fresh) => {
      if (fresh) onMoved?.(fresh);
    });
    return null;
  } catch {
    return null;
  }
}
