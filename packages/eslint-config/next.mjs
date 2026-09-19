import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-config-next 16.3 은 eslint-plugin-react-hooks v7 의 React Compiler 규칙(set-state-in-effect · refs ·
// immutability …)을 error 로 켠다. 2026-09-06 기준 web 10 · admin 3건이 걸리고 전부 UI 동작을 바꾸는 수정이라
// 화면 확인 없이 고치지 않는다(docs/TODO.md, ADR 2026-09-06 D4). 그때까지 warn 으로 두어 CI 를 막지 않되
// 새 위반은 보이게 한다. rules-of-hooks · exhaustive-deps 는 기존 강도 그대로다.
const reactCompilerRulesAsWarn = {
  name: "truewords/react-compiler-rules-staged",
  rules: {
    "react-hooks/component-hook-factories": "warn",
    "react-hooks/config": "warn",
    "react-hooks/error-boundaries": "warn",
    "react-hooks/gating": "warn",
    "react-hooks/globals": "warn",
    "react-hooks/immutability": "warn",
    "react-hooks/incompatible-library": "warn",
    "react-hooks/preserve-manual-memoization": "warn",
    "react-hooks/purity": "warn",
    "react-hooks/refs": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/set-state-in-render": "warn",
    "react-hooks/static-components": "warn",
    "react-hooks/unsupported-syntax": "warn",
    "react-hooks/use-memo": "warn",
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  reactCompilerRulesAsWarn,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
