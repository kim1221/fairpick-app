import { Linking, Alert } from 'react-native';

/**
 * 카카오맵 앱으로 특정 장소 열기
 * @param lat - 위도
 * @param lng - 경도
 * @param placeName - 장소명
 */
export const openKakaoMap = async (
  lat: number,
  lng: number,
  placeName: string
): Promise<void> => {
  const deepLink = `kakaomap://look?p=${lat},${lng}`;
  const webFallback = `https://map.kakao.com/link/map/${encodeURIComponent(placeName)},${lat},${lng}`;
  
  try {
    const canOpen = await Linking.canOpenURL(deepLink);
    if (canOpen) {
      await Linking.openURL(deepLink);
    } else {
      // 카카오맵 앱이 없으면 웹으로 폴백
      await Linking.openURL(webFallback);
    }
  } catch (error) {
    console.error('Failed to open Kakao Map:', error);
    Alert.alert('오류', '카카오맵을 열 수 없습니다.');
  }
};

/**
 * 네이버지도 앱으로 특정 장소 열기
 * @param lat - 위도
 * @param lng - 경도
 * @param placeName - 장소명
 */
export const openNaverMap = async (
  lat: number,
  lng: number,
  placeName: string
): Promise<void> => {
  const deepLink = `nmap://place?lat=${lat}&lng=${lng}&name=${encodeURIComponent(placeName)}`;
  const webFallback = `https://map.naver.com/v5/search/${encodeURIComponent(placeName)}`;
  
  try {
    const canOpen = await Linking.canOpenURL(deepLink);
    if (canOpen) {
      await Linking.openURL(deepLink);
    } else {
      // 네이버지도 앱이 없으면 웹으로 폴백
      await Linking.openURL(webFallback);
    }
  } catch (error) {
    console.error('Failed to open Naver Map:', error);
    Alert.alert('오류', '네이버지도를 열 수 없습니다.');
  }
};

