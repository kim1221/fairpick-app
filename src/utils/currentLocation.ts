import { Accuracy, getCurrentLocation } from '@apps-in-toss/framework';

export type CurrentCoords = {
  lat: number;
  lng: number;
};

export async function getCurrentCoordsOrNull(): Promise<CurrentCoords | null> {
  try {
    // PermissionStatus = 'notDetermined' | 'denied' | 'allowed'
    // notDetermined이면 getCurrentLocation 호출이 OS 권한 요청을 트리거하므로 그대로 진행해요.
    const permission = await getCurrentLocation.getPermission();
    if (permission === 'denied') {
      return null;
    }

    const location = await getCurrentLocation({ accuracy: Accuracy.Balanced });
    const { latitude, longitude } = location.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return { lat: latitude, lng: longitude };
  } catch {
    return null;
  }
}
