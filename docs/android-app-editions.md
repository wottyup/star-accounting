# Android 安装包版本区分

| 安装包 | 手机应用名 | `applicationId` | 页面与导航 |
| --- | --- | --- | --- |
| Web 壳版 | 星会计 Web 壳 | `com.wotty.stark.web` | Capacitor WebView，网页底部导航 |
| KT 混合版 | 星会计 KT 混合版 | `com.wotty.stark.ktweb` | 复用网页页面，Kotlin 原生底部导航 |
| 纯 KT 原生版 | 星会计 原生版 | `com.wotty.stark.nativeapp` | Kotlin / Jetpack Compose 原生页面与底部导航 |

三个版本使用独立包名，可以同时安装。Web 壳版和 KT 混合版由 `app/android` 工程构建；纯 KT 版由根目录 Gradle 工程中的 `native-app` 模块构建。

构建命令：

- Web 壳：`pnpm --dir app apk:linux`
- KT 混合版：`pnpm --dir app apk:ktweb:linux`
- 纯 KT 原生版：`./gradlew :native-app:assembleDebug`

APK 文件名包含应用类型、版本名、Android 版本码和时间戳，构建时归档到 `releases/`。
