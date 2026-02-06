import { config } from '../src/config';

console.log({
  kakaoRestApiKey_set: !!config.kakaoRestApiKey,
  kakaoRestApiKey_len: (config.kakaoRestApiKey || '').length,
  kakaoRestApiKey_prefix: (config.kakaoRestApiKey || '').slice(0, 6), // 앞 6글자만(노출 최소화)
});
