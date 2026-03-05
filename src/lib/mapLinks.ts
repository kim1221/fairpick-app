import { Linking } from 'react-native';

/**
 * 지도 앱 딥링크 생성 및 실행 유틸리티
 *
 * - KakaoMap: 앱 딥링크 → 웹 fallback
 * - NaverMap: 앱 딥링크 → 웹 fallback
 */

export interface MapLinkParams {
  lat: number;
  lng: number;
  name?: string;
  address?: string;
}

/**
 * 카카오맵 열기
 * - 앱: kakaomap://look?p=LAT,LNG
 * - 웹: https://map.kakao.com/link/map/NAME,LAT,LNG
 */
export async function openKakaoMap({ lat, lng, name }: MapLinkParams): Promise<void> {
  const appScheme = `kakaomap://look?p=${lat},${lng}`;
  const webUrl = `https://map.kakao.com/link/map/${encodeURIComponent(name || '이벤트 위치')},${lat},${lng}`;

  try {
    const canOpen = await Linking.canOpenURL(appScheme);
    if (canOpen) {
      await Linking.openURL(appScheme);
    } else {
      // 앱이 없으면 웹으로 열기
      await Linking.openURL(webUrl);
    }
  } catch (error) {
    console.error('[MapLinks] Failed to open KakaoMap:', error);
    throw new Error('카카오맵을 열 수 없습니다.');
  }
}

/**
 * 네이버지도 열기
 * - 앱: nmap://place?lat=LAT&lng=LNG&name=NAME&appname=fairpick
 * - 웹: https://map.naver.com/v5/search/ADDRESS 또는 좌표 검색
 */
export async function openNaverMap({ lat, lng, name, address }: MapLinkParams): Promise<void> {
  const appScheme = `nmap://place?lat=${lat}&lng=${lng}&name=${encodeURIComponent(
    name || '이벤트 위치',
  )}&appname=fairpick`;

  // 웹 URL: 주소가 있으면 주소 검색, 없으면 좌표 검색
  const webUrl = address
    ? `https://map.naver.com/v5/search/${encodeURIComponent(address)}`
    : `https://map.naver.com/v5/search/${lat},${lng}`;

  try {
    const canOpen = await Linking.canOpenURL(appScheme);
    if (canOpen) {
      await Linking.openURL(appScheme);
    } else {
      // 앱이 없으면 웹으로 열기
      await Linking.openURL(webUrl);
    }
  } catch (error) {
    console.error('[MapLinks] Failed to open NaverMap:', error);
    throw new Error('네이버지도를 열 수 없습니다.');
  }
}

/**
 * 주소 복사하기
 */
export async function copyAddress(address: string): Promise<void> {
  // React Native에서 Clipboard API 사용
  // @ts-ignore - Clipboard는 react-native 0.60+ 에서 사용 가능
  const Clipboard = await import('@react-native-clipboard/clipboard');
  Clipboard.default.setString(address);
}
