import config from "@truewords/eslint-config/next";

// React 패키지는 Next.js 라우트를 소유하지 않는다.
export default [...config, { rules: { "@next/next/no-html-link-for-pages": "off" } }];
