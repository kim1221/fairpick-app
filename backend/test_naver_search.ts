import { searchEventInfo } from './src/lib/naverApi';
import * as dotenv from 'dotenv';

dotenv.config();

async function test() {
  const result = await searchEventInfo('쿠키런: 킹덤 아트 콜라보 프로젝트', '아라아트센터');
  
  console.log('=== 플레이스 결과 ===');
  if (result.place?.items?.[0]) {
    console.log(JSON.stringify(result.place.items[0], null, 2));
  } else {
    console.log('플레이스 결과 없음');
  }
  
  console.log('\n=== 블로그 결과 (처음 2개) ===');
  if (result.blog?.items) {
    result.blog.items.slice(0, 2).forEach((item: any, idx: number) => {
      console.log(`\n[${idx + 1}] ${item.title}`);
      console.log(`날짜: ${item.postdate}`);
      console.log(`내용: ${item.description.substring(0, 200)}...`);
    });
  }
  
  console.log('\n=== 웹 결과 (처음 3개) ===');
  if (result.web?.items) {
    result.web.items.slice(0, 3).forEach((item: any, idx: number) => {
      console.log(`\n[${idx + 1}] ${item.title}`);
      console.log(`링크: ${item.link}`);
      console.log(`내용: ${item.description.substring(0, 200)}...`);
    });
  }
}

test().catch(console.error);
