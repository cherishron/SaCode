import { hapTasks } from '@ohos/hvigor-ohos-plugin';
import { kuiklyCompilePlugin } from '@kuikly-open/ohos-compile-plugin';

export default {
    system: hapTasks,
    plugins: [
        kuiklyCompilePlugin()
    ]
}