import { registerRootComponent } from 'expo';

// TaskManager.defineTask 는 반드시 앱이 일찍 로드하는 모듈의 최상위 스코프에서
// 실행돼야 한다 — 앱이 완전히 종료된 상태에서 이 작업만으로 깨어날 때도
// 태스크 정의가 이미 등록돼 있어야 하기 때문이다. index.ts 가 가장 이른 지점이다.
import './src/push/backgroundTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
