import { Accuracy, getCurrentLocation } from '@apps-in-toss/framework';

export type CurrentCoords = {
  lat: number;
  lng: number;
};

export async function getCurrentCoordsOrNull(): Promise<CurrentCoords | null> {
  try {
    const permission = await getCurrentLocation.getPermission();
    if (permission === 'denied' || permission === 'notDetermined') {
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
