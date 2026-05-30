# UniApp Classic — 综合参考

## 目录

1. [全局配置](#全局配置)
2. [内置组件](#内置组件)
3. [API](#api)
4. [插件与扩展](#插件与扩展)
5. [工程与构建](#工程与构建)

---

## 全局配置

### pages.json — 页面路由与导航

控制页面注册、窗口外观、tabBar 和分包拆分。

```json
{
  "pages": [
    { "path": "pages/index/index", "style": { "navigationBarTitleText": "Home" } }
  ],
  "subPackages": [
    { "root": "pagesA", "pages": [{ "path": "detail/detail", "style": {} }] }
  ],
  "globalStyle": {
    "navigationBarBackgroundColor": "#F7F7F7",
    "navigationBarTextStyle": "black",
    "navigationBarTitleText": "My App",
    "backgroundColor": "#ffffff",
    "enablePullDownRefresh": false
  },
  "tabBar": {
    "color": "#7A7E83",
    "selectedColor": "#007AFF",
    "backgroundColor": "#F7F7F7",
    "borderStyle": "black",
    "list": [
      { "pagePath": "pages/index/index", "iconPath": "static/home.png", "selectedIconPath": "static/home-active.png", "text": "Home" },
      { "pagePath": "pages/user/user", "iconPath": "static/user.png", "selectedIconPath": "static/user-active.png", "text": "Me" }
    ]
  },
  "easycom": {
    "autoscan": true,
    "custom": {
      "^uni-(.*)": "@dcloudio/uni-ui/lib/uni-$1/uni-$1.vue"
    }
  },
  "preloadRule": {
    "pages/index/index": { "network": "all", "packages": ["pagesA"] }
  }
}
```

页面样式属性（按页面覆盖 globalStyle）：
- navigationBarBackgroundColor, navigationBarTextStyle (white/black), navigationBarTitleText
- navigationStyle: "default" 或 "custom"（自定义导航栏）
- backgroundColor, backgroundTextStyle (dark/light)
- enablePullDownRefresh, onReachBottomDistance（默认 50）
- pageOrientation: portrait / auto / landscape
- disableScroll, usingComponents
- 平台覆盖：mp-weixin, mp-alipay, h5, app-plus

tabBar：2-5 个项。每项：pagePath, text, iconPath, selectedIconPath, redDot, badge

### manifest.json — 应用元数据与平台配置

```json
{
  "name": "My App",
  "appid": "__UNI__XXXXXXX",
  "versionName": "1.0.0",
  "versionCode": "100",
  "vueVersion": "3",
  "app-plus": {
    "distribute": {
      "android": { "packagename": "com.example.app", "targetSdkVersion": 30, "permissions": [] },
      "ios": { "appid": "com.example.app", "capabilities": {} },
      "sdkConfigs": {
        "oauth": { "weixin": { "appid": "", "UniversalLinks": "" } },
        "payment": { "weixin": {}, "alipay": {} },
        "share": { "weixin": {} },
        "push": {},
        "ad": {}
      },
      "icons": {},
      "splashscreen": { "autoclose": true, "waiting": true }
    },
    "modules": ["Barcode", "Bluetooth", "Fingerprint"],
    "privacy": { "prompt": "template" }
  },
  "h5": {
    "router": { "mode": "hash", "base": "/" },
    "devServer": { "port": 8080, "proxy": {} },
    "title": "My App"
  },
  "mp-weixin": {
    "appid": "",
    "setting": { "urlCheck": false, "es6": true, "minified": true },
    "usingComponents": true,
    "permission": { "scope.userLocation": { "desc": "Location needed" } },
    "requiredPrivateInfos": ["getLocation"]
  },
  "mp-alipay": { "appid": "", "component2": true },
  "networkTimeout": { "request": 60000, "downloadFile": 60000 }
}
```

### uni.scss — 全局样式变量

自动导入到每个组件中。关键变量：

```scss
$uni-color-primary: #2979ff;
$uni-color-success: #18bc37;
$uni-color-warning: #f3a73f;
$uni-color-error: #e43d33;
$uni-text-color: #333;
$uni-text-color-grey: #999;
$uni-bg-color: #f8f8f8;
$uni-border-color: #e5e5e5;
$uni-font-size-sm: 12px;
$uni-font-size-base: 14px;
$uni-font-size-lg: 16px;
```

---

## 内置组件

### 视图容器

| 组件 | 关键属性 | 关键事件 |
|-----------|-----------|------------|
| view | hover-class, hover-start-time, hover-stay-time | @click, @longpress |
| scroll-view | scroll-x, scroll-y, scroll-top, refresher-enabled, refresher-triggered | @scroll, @scrolltolower, @refresherrefresh |
| swiper | current, autoplay, interval, duration, circular, vertical | @change, @animationfinish |
| movable-view | direction, x, y, scale, damping | @change, @scale |
| cover-view / cover-image | 覆盖在原生组件上的层 | — |

### 基础内容

| 组件 | 关键属性 | 关键事件 |
|-----------|-----------|------------|
| text | selectable, space, decode | @click |
| rich-text | nodes (String/Array) | @itemclick |
| image | src, mode, lazy-load | @error, @load |
| icon | type, size, color | — |
| progress | percent, show-info, stroke-width, color, active | — |

image mode 值：scaleToFill, aspectFit, aspectFill, widthFix, heightFix, top, bottom, center, left, right, top left, top right, bottom left, bottom right

### 表单组件

| 组件 | 关键属性 | 关键事件 |
|-----------|-----------|------------|
| button | size, type, plain, disabled, loading, open-type | @getphonenumber, @getuserinfo |
| input | value, type, placeholder, focus, maxlength, confirm-type | @input, @focus, @blur, @confirm |
| textarea | value, placeholder, auto-height, maxlength, focus | @input, @focus, @blur, @linechange |
| checkbox / checkbox-group | value, checked, disabled, color | @change（在 group 上） |
| radio / radio-group | value, checked, disabled, color | @change（在 group 上） |
| picker | mode, range, value | @change, @columnchange |
| picker-view | value, indicator-style | @change |
| slider | min, max, step, value, activeColor, show-value | @change, @changing |
| switch | checked, disabled, color | @change |
| form | report-submit | @submit, @reset |
| editor | read-only, placeholder | 通过 uni.createEditorContext 调用 API |

picker mode 值：selector, multiSelector, time, date, region

### 导航

navigator: url, open-type (navigate/redirect/switchTab/reLaunch/navigateBack), delta, hover-class

### 媒体

| 组件 | 关键属性 |
|-----------|-----------|
| video | src, autoplay, loop, muted, controls, poster, object-fit, enable-danmu |
| camera | mode, device-position, flash |
| live-player | url, mode, autoplay, muted |
| live-pusher | url, mode, autopush, beauty |

### 地图、Canvas、web-view

- map: longitude, latitude, scale, markers, polyline, circles, show-location
- canvas: canvas-id, type ("2d")
- web-view: src。通过 uni.postMessage()、uni.navigateBack() 回传通信

### 平台专属

- ad: adpid / unit-id, ad-type, ad-intervals
- official-account: 微信小程序关注按钮
- open-data: type (userNickName, userAvatarUrl 等)

---

## API

### 网络

```js
uni.request({ url, method, data, header, timeout, dataType, responseType, success, fail })
uni.uploadFile({ url, filePath, name, header, formData, success, fail })
uni.downloadFile({ url, header, filePath, success, fail })
uni.connectSocket({ url, header, protocols })
uni.onSocketOpen / onSocketError / onSocketMessage / onSocketClose(callback)
uni.sendSocketMessage({ data })
uni.closeSocket({ code, reason })
```

网络 API 返回任务对象：requestTask.abort(), uploadTask.onProgressUpdate(cb), downloadTask.onProgressUpdate(cb)

### 数据存储

```js
uni.setStorageSync(key, data)
const val = uni.getStorageSync(key)
uni.removeStorageSync(key)
uni.clearStorageSync()
// 异步版本：uni.setStorage, uni.getStorage, uni.removeStorage, uni.clearStorage
```

### 定位

```js
uni.getLocation({ type: 'wgs84' or 'gcj02', altitude, isHighAccuracy })
uni.chooseLocation({ longitude, latitude, keyword })
uni.openLocation({ longitude, latitude, scale, name, address })
```

### 媒体

```js
uni.chooseImage({ count, sizeType, sourceType })
uni.previewImage({ current, urls, indicator, loop })
uni.getImageInfo({ src })
uni.saveImageToPhotosAlbum({ filePath })
uni.compressImage({ src, quality })
uni.chooseVideo({ sourceType, maxDuration, camera })
uni.saveVideoToPhotosAlbum({ filePath })
```

### 设备

```js
uni.getSystemInfoSync()  // brand, model, system, platform, 屏幕尺寸, safeArea
uni.getNetworkType()     // wifi/2g/3g/4g/5g/none
uni.onNetworkStatusChange(callback)  // {isConnected, networkType}
uni.makePhoneCall({ phoneNumber })
uni.scanCode({ scanType, onlyFromCamera })
uni.vibrateLong() / uni.vibrateShort({ type })
uni.getClipboardData() / uni.setClipboardData({ data })
uni.getBatteryInfo()
// 传感器：onAccelerometerChange, onCompassChange, onGyroscopeChange
// 蓝牙：openBluetoothAdapter, createBLEConnection, read/writeBLECharacteristicValue
// WiFi：startWifi, connectWifi, getConnectedWifi
```

### 导航

```js
uni.navigateTo({ url, animationType, animationDuration })
uni.redirectTo({ url })
uni.reLaunch({ url })
uni.switchTab({ url })
uni.navigateBack({ delta })
uni.preloadPage({ url })
```

### UI 与交互

```js
uni.showToast({ title, icon, duration, mask, position })
uni.hideToast()
uni.showLoading({ title, mask })
uni.hideLoading()
uni.showModal({ title, content, showCancel, editable })
uni.showActionSheet({ itemList })
uni.startPullDownRefresh() / uni.stopPullDownRefresh()
// TabBar：setTabBarBadge, removeTabBarBadge, showTabBarRedDot, setTabBarStyle, setTabBarItem
// 导航栏：setNavigationBarTitle, setNavigationBarColor
```

### 登录、支付、分享

```js
uni.login({ provider, scopes })
uni.getUserInfo({ provider, lang })
uni.requestPayment({ provider: 'wxpay' or 'alipay' or 'appleiap', ...paymentParams })
uni.share({ provider, scene, type, title, summary, href, imageUrl })
uni.onShareAppMessage(() => ({ title, path, imageUrl }))
```

### 文件

```js
uni.saveFile({ tempFilePath })
uni.openDocument({ filePath, fileType, showMenu })
uni.getFileSystemManager()  // access, copyFile, mkdir, readFile, writeFile, rename, unlink, unzip
uni.chooseFile({ count, extension })
```

---

## 插件与扩展

### uni_modules 插件系统

uni_modules/ 目录下的标准插件格式。通过 easycom 自动注册。

```
uni_modules/my-plugin/
  package.json
  components/my-component/my-component.vue
  js_sdk/my-util.js
  pages/           （插件页面）
  static/          （插件静态资源）
```

### 原生插件

- 模块类型：通过 uni.requireNativePlugin('PluginName') 访问
- 组件类型：在 pages.json 的 usingComponents 中注册
- UTS 插件（用于 UniApp X）：放在 utssdk/ 目录，编译为原生代码

### 组件库

- uni-ui（官方）：@dcloudio/uni-ui — badge, calendar, card, collapse, forms, icons, list, nav-bar, popup, rate, table, tag 等
- uView UI（社区）：70+ 组件，v2 支持 Vue 3
- ThorUI, TuniaoUI, FirstUI：其他商业/免费组件库

---

## 工程与构建

### 项目结构

```
my-project/
  pages/              # 页面组件
  static/             # 静态资源
  components/         # 自定义组件
  uni_modules/        # 插件
  common/             # 公共工具
  store/              # Vuex/Pinia
  App.vue             # 根组件
  main.js             # 入口文件
  pages.json          # 路由配置
  manifest.json       # 应用配置
  uni.scss            # 全局样式变量
  package.json
```

### Vue 2 与 Vue 3

| 特性 | Vue 2 | Vue 3 |
|---------|-------|-------|
| API 风格 | 仅 Options API | Options + Composition API |
| Script setup | 不支持 | script setup |
| 构建工具 | Webpack | Vite（推荐） |
| 状态管理 | Vuex 3 | Pinia（推荐） |
| manifest 中设置 | "vueVersion": "2" | "vueVersion": "3" |

### 条件编译

```js
// #ifdef MP-WEIXIN
wx.someAPI()
// #endif

// #ifndef APP-PLUS
crossPlatformCode()
// #endif

// #ifdef MP-WEIXIN || MP-ALIPAY
multiPlatformCode()
// #endif
```

CSS（/* #ifdef */）和 HTML（<!-- #ifdef -->）使用相同语法。

平台标识：APP-PLUS, APP-ANDROID, APP-IOS, H5, MP-WEIXIN, MP-ALIPAY, MP-BAIDU, MP-TOUTIAO, MP-QQ, MP-KUAISHOU, MP-JD, MP-LARK, MP（任意小程序）

### CLI 命令

```bash
# 创建项目（Vue 3）
npx degit dcloudio/uni-preset-vue#vite my-project

# 创建项目（Vue 3 + TypeScript）
npx degit dcloudio/uni-preset-vue#vite-ts my-project

# 开发
npm run dev:h5
npm run dev:mp-weixin

# 构建
npm run build:h5
npm run build:mp-weixin
```

### 应用生命周期（App.vue）

```js
// App.vue
export default {
  onLaunch(options) {
    // 应用启动 — 初始化全局状态、检查更新、获取启动参数
    // options: path, query, scene, referrerInfo
  },
  onShow(options) {
    // 应用从后台进入前台
  },
  onHide() {
    // 应用进入后台
  },
  onError(msg) {
    // 全局错误处理
  },
  onUnhandledRejection(e) {
    // 未处理的 Promise 拒绝
  },
  onPageNotFound(res) {
    // 页面未找到 — 可重定向
    uni.redirectTo({ url: '/pages/404/404' })
  }
}
```

### 组件通信模式

```html
<!-- 父组件传递 props -->
<child-component :title="pageTitle" @on-change="handleChange" />

<!-- 子组件 -->
<script>
export default {
  props: {
    title: { type: String, default: '' }
  },
  emits: ['on-change'],
  methods: {
    onClick() {
      this.$emit('on-change', this.title)
    }
  }
}
</script>
```

```html
<!-- Vue 3 Composition API 模式 -->
<script setup>
const props = defineProps({ title: { type: String, default: '' } })
const emit = defineEmits(['on-change'])

function onClick() {
  emit('on-change', props.title)
}
</script>
```

```js
// 跨页面通信：使用 uni.$on / uni.$emit
// 页面 A：监听
uni.$on('refreshData', (data) => { this.loadData() })

// 页面 B：触发
uni.$emit('refreshData', { type: 'update' })

// 在 onUnload 中清理
uni.$off('refreshData')
```

### 自定义导航栏

```html
<template>
  <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px' }">
    <view class="nav-content" :style="{ height: navBarHeight + 'px' }">
      <text class="nav-title">{{ title }}</text>
    </view>
  </view>
  <!-- 为页面内容添加内边距 -->
  <view :style="{ paddingTop: (statusBarHeight + navBarHeight) + 'px' }">
    <!-- 页面内容 -->
  </view>
</template>

<script>
export default {
  data() {
    return {
      statusBarHeight: 0,
      navBarHeight: 44
    }
  },
  created() {
    const sysInfo = uni.getSystemInfoSync()
    this.statusBarHeight = sysInfo.statusBarHeight
  }
}
</script>
```

pages.json 中必须设置：`"navigationStyle": "custom"`

### NVue 页面示例

```html
<template>
  <view class="container">
    <list class="list" @loadmore="onLoadMore">
      <cell v-for="item in list" :key="item.id">
        <view class="item">
          <text class="title">{{ item.title }}</text>
          <text class="desc">{{ item.desc }}</text>
        </view>
      </cell>
    </list>
  </view>
</template>

<style>
.container { flex: 1; background-color: #f5f5f5; }
.list { flex: 1; }
.item { padding: 20px; background-color: #ffffff; border-bottom-width: 1px; border-bottom-color: #eeeeee; }
.title { font-size: 16px; color: #333333; font-weight: bold; }
.desc { font-size: 13px; color: #999999; margin-top: 8px; }
</style>
```

NVue 关键约束：
- 默认 flex-direction 为 column（不像 CSS 默认为 row）
- 所有文本必须使用 `<text>` 标签 — 文本不能直接放在 `<view>` 中
- 文本截断使用 `lines: 1; text-overflow: ellipsis`
- `<image>` 必须设置明确的 width/height
- 背景色必须设在元素本身上，不能继承
- 不支持 class 组合 — 每个元素需要自己的样式

### 动画 API

```js
// uni.createAnimation
const animation = uni.createAnimation({
  duration: 400,
  timingFunction: 'ease-out',
  delay: 0,
  transformOrigin: '50% 50%'
})

// 链式调用动画方法
animation.rotate(45).scale(1.2).translateX(30).step()
animation.rotate(0).scale(1).translateX(0).step({ duration: 200 })

// 应用到数据
this.animationData = animation.export()

// 在模板中使用：<view :animation="animationData" />
```

### 关键注意事项

- rpx 与 px：750rpx = 屏幕宽度。布局用 rpx，字体/边框用 px
- 无 DOM：不能使用 document.*、window.*、navigator.*
- 无 HTML 标签：使用 view/text/navigator/image 代替 div/span/a/img
- onLoad 与 created：onLoad 是 UniApp 页面生命周期（接收查询参数）；created 是 Vue 组件生命周期
- 样式隔离：小程序默认隔离组件样式
- upx 已废弃：始终使用 rpx 代替
- uni.$on 必须在 onUnload 中清理，否则会内存泄漏
- v-for 必须使用 :key，且 key 必须是唯一的 string/number（动态列表不要用 index）
- CSS 中的图片路径（background-image）在某些平台上需要特殊处理
