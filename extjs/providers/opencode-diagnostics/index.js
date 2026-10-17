import {startCapture} from './capture.js';

// OpenCode 2.0.28 Plugin.define 的契约为返回同一 {id, setup} 对象；不引入 SDK/npm 安装。
export default {id:'sacode.diagnostics.readonly',setup(ctx){return startCapture(ctx);}};
