# UniApp 最佳实践与避坑指南

## 目录

1. [项目架构最佳实践](#1-项目架构最佳实践)
2. [样式与布局避坑](#2-样式与布局避坑)
3. [组件使用避坑](#3-组件使用避坑)
4. [API 使用避坑](#4-api-使用避坑)
5. [跨平台兼容性](#5-跨平台兼容性)
6. [性能优化](#6-性能优化)
7. [状态管理最佳实践](#7-状态管理最佳实践)
8. [网络请求最佳实践](#8-网络请求最佳实践)
9. [UniCloud 开发避坑](#9-unicloud-开发避坑)
10. [UniApp X 注意事项](#10-uniapp-x-注意事项)
11. [小程序审核与发布避坑](#11-小程序审核与发布避坑)
12. [常见 Bug 汇总](#12-常见-bug-汇总)

---

## 1. 项目架构最佳实践

### 目录结构规范

```
src/
  pages/                    # 页面（与 pages.json 对应）
  components/               # 公共组件
  api/                      # 接口请求封装
  utils/                    # 工具函数
  store/                    # 状态管理 (Pinia)
  static/                   # 静态资源（注意体积）
  common/                   # 公共样式、常量
  uni_modules/              # 插件
```

### 分包策略

- 首页必须在主包，主包控制在 2MB 以内（小程序限制）
- 按 功能模块 分包，不要按页面类型分包
- 使用 preloadRule 预加载常用分包
- 静态资源尽量放服务器，不要放 static/ 目录

```json
{
  "subPackages": [
    { "root": "pagesA", "pages": [...] },
    { "root": "pagesB", "pages": [...] }
  ],
  "preloadRule": {
    "pages/index/index": {
      "network": "all",
      "packages": ["pagesA"]
    }
  }
}
```

### easycom 自动导入

不要手动 import 组件，利用 easycom 规则自动注册：

```json
{
  "easycom": {
    "autoscan": true,
    "custom": {
      "^uni-(.*)": "@dcloudio/uni-ui/lib/uni-$1/uni-$1.vue",
      "^my-(.*)": "@/components/my-$1.vue"
    }
  }
}
```

---

## 2. 样式与布局避坑

### rpx vs px 核心规则

- **布局尺寸用 rpx**：宽度、高度、间距、边框圆角
- **字体大小用 px**：font-size 始终用 px，rpx 在大屏上字会过大
- **细边框用 rpx 或 0.5px**：1px 边框在高清屏上看起来是 2px
- **750rpx = 屏幕宽度**，设计稿按 750 宽度出图

```css
/* 正确 */
.box { width: 686rpx; font-size: 14px; margin: 20rpx; border-radius: 12rpx; }

/* 错误 — 字号用 rpx 会在 iPad 上巨大 */
.bad { font-size: 28rpx; }
```

### 样式隔离

小程序默认组件样式隔离。在 Vue 3 组件中需要穿透时：

```js
// 方式1：关闭隔离
export default {
  options: { styleIsolation: 'shared' }
}

// 方式2：使用 :deep()（仅 H5 和 App）
// :deep(.child-class) { ... }
```

### NVue 样式限制

nvue 页面（原生渲染）CSS 严重受限：
- 只支持 flexbox 布局，默认 flex-direction: column
- 不支持 float、position: fixed（部分支持）、overflow: visible
- 不支持 calc()、vw/vh
- 不支持 CSS 动画（用 animation 模块或 transition）
- text 组件不能嵌套 view
- 必须显式写 width 或 flex: 1

```css
/* nvue 正确写法 */
.container {
  flex: 1;
  flex-direction: column;
}
.title {
  font-size: 32px;
  color: #333333;
  lines: 1;
  text-overflow: ellipsis;
}
```

### 全局样式陷阱

- App.vue 中的全局样式在 nvue 页面无效
- uni.scss 的变量在所有页面可用（包括 nvue），但普通 CSS 规则不行
- 不要在 App.vue 写标签选择器（view {}），小程序端可能异常

---

## 3. 组件使用避坑

### view / text / image 选择

| 场景 | 正确组件 | 错误做法 |
|------|---------|---------|
| 容器 | view | div |
| 文字 | text | span, p |
| 图片 | image | img |
| 链接 | navigator | a |
| 列表 | scroll-view 或 list | div v-for + 原生滚动 |

### image 组件坑

1. **mode 默认是 scaleToFill**（拉伸变形），绝大多数场景应使用 aspectFit 或 aspectFill
2. **image 有默认宽高** 320x240px，不设宽高会撑开布局
3. **动态 src 必须用 require 或绝对路径**

```html
<!-- 静态路径 -->
<image src="/static/logo.png" />

<!-- 动态路径需要 require -->
<image :src="require('@/static/logo.png')" />

<!-- 网络图片直接用 -->
<image src="https://example.com/img.png" mode="aspectFill" />
```

4. **lazy-load 只在部分平台生效**（微信小程序、App）

### scroll-view 坑

1. **必须设置固定高度**，否则不滚动
2. **scroll-x/scroll-y 不能同时设为 true**（部分平台不支持双向滚动）
3. **下拉刷新用 refresher-enabled**，不要自己实现
4. **scroll-into-view** 目标元素必须有 id（不是 class）
5. **滚动事件 @scroll 触发频率极高**，务必节流

```html
<scroll-view
  scroll-y
  :style="{ height: scrollHeight + 'px' }"
  :refresher-enabled="true"
  :refresher-triggered="isRefreshing"
  @refresherrefresh="onRefresh"
  @scrolltolower="onLoadMore"
>
</scroll-view>
```

### input / textarea 坑

1. **小程序端 input 是原生组件**，层级最高，会覆盖其他元素（z-index 无效）
2. **placeholder-style 和 placeholder-class** 是控制 placeholder 样式的唯一方式
3. **confirm-type** 控制键盘右下角按钮文字：send/search/next/go/done
4. **adjust-position 默认 true**，键盘弹起会自动推页面，但部分安卓机型有 bug
5. **textarea 在 iOS 上有默认内边距**，需手动清除

```html
<textarea
  :placeholder="placeholder"
  placeholder-class="textarea-placeholder"
  :adjust-position="true"
  :auto-height="true"
  :disable-default-padding="true"
/>
```

### picker 组件坑

1. **mode="region" 在部分平台不支持**（App 需要百度地图 SDK）
2. **multiSelector 的 @columnchange** 只在微信小程序有效
3. **range 数据变化后需要手动重置 value**，否则可能显示错位

### swiper 坑

1. **circular=true 时首尾衔接有闪烁**，部分安卓机型明显
2. **动态修改 current 需要用 :current="swiperCurrent"**，直接赋值可能不触发更新
3. **display-multiple-items + circular 有 bug**，避免同时使用
4. **autoplay 在 App 端后台回来后可能失效**，需手动重启

---

## 4. API 使用避坑

### 路由跳转

1. **navigateTo 有页面栈限制**：小程序端最多 10 层
2. **switchTab 只能跳 tabBar 页**，且跳转后会销毁非 tabBar 页面
3. **reLaunch 会关闭所有页面**，注意状态丢失
4. **传参通过 URL query**，对象参数需要序列化

```js
// 传对象
uni.navigateTo({
  url: '/pages/detail/detail?data=' + encodeURIComponent(JSON.stringify(obj))
})

// 接收
onLoad(options) {
  const data = JSON.parse(decodeURIComponent(options.data))
}
```

5. **redirectTo 后当前页面被销毁**，不能返回

### 数据存储

1. **StorageSync 同步方法有大小限制**：单条数据建议不超过 1MB，总计不超过 10MB
2. **小程序端 storage 是同步阻塞的**，大量数据用异步版本
3. **不要存敏感信息**（密码、token 可被逆向读取）
4. **setStorage 的 encrypt 参数仅 App 端有效**

### 网络请求

1. **uni.request 不支持 Promise 链式拦截**，需要自己封装
2. **小程序端并发请求限制 10 个**，超出会排队
3. **request 的 data 中 get 方法会拼到 URL 上**，post 才放 body
4. **timeout 默认 60s**，弱网环境可能不够
5. **HTTPS 是强制要求**，HTTP 请求会被拦截

### 获取节点信息

```js
// 正确方式
uni.createSelectorQuery()
  .in(this)   // 组件内必须 .in(this)
  .select('.my-element')
  .boundingClientRect(rect => {
    console.log(rect.width, rect.height)
  })
  .exec()

// 错误：小程序没有 DOM
// document.querySelector('.my-element')
```

### 页面生命周期顺序

```
页面首次进入: onLoad -> onShow -> onReady
从其他页面返回: onShow
页面销毁: onUnload
TabBar 切换: onHide -> onShow
```

**关键：onLoad 只执行一次**，返回页面不会重新触发。需要每次显示都刷新的逻辑放在 onShow 里。

---

## 5. 跨平台兼容性

### 条件编译核心模式

```js
// #ifdef APP-PLUS
// 仅 App 端代码
// #endif

// #ifdef MP-WEIXIN
// 仅微信小程序代码
// #endif

// #ifndef H5
// 非 H5 端代码
// #endif

// #ifdef MP-WEIXIN || MP-ALIPAY
// 微信或支付宝小程序
// #endif
```

CSS 和 HTML 同理使用注释语法。不能嵌套条件编译。

### 常见平台差异

| 功能 | H5 | App | 微信小程序 |
|------|-----|-----|-----------|
| 地图 | 腾讯地图 | 高德/Google | 腾讯地图 |
| 支付 | 需自行接入 | uni.requestPayment | wx.requestPayment |
| 分享 | 不支持 onShareAppMessage | uni.share | onShareAppMessage |
| 扫码 | 需第三方库 | uni.scanCode | uni.scanCode |
| 推送 | 不支持 | UniPush | 订阅消息 |
| localStorage | 5MB+ | 无上限 | 10MB |

### 小程序特有注意事项

1. **onShareAppMessage 必须定义**，否则没有分享按钮（微信）
2. **getUserInfo 需要用户主动点击按钮触发**，不能自动调用
3. **requestPayment 的参数格式各平台不同**，需分别处理
4. **canvas 在小程序端是原生组件**，层级问题同 input
5. **web-view 加载的业务域名需在后台配置**

---

## 6. 性能优化

### 长列表优化

1. **不要用 v-for + view 实现长列表**，使用 scroll-view + 触底加载
2. **nvue 用 list + cell**，自带回收机制
3. **UniApp X 用 list-view + list-item**，设置 type 属性区分不同条目类型
4. **分页加载**，每页 20-30 条，触底加载下一页
5. **避免大列表用复杂组件**，简化列表项模板

```html
<!-- UniApp X 长列表 -->
<list-view :scroll-y="true" @scrolltolower="onLoadMore">
  <list-item v-for="item in list1" :key="item.id" type="1">
    <text>{{ item.title }}</text>
  </list-item>
  <list-item v-for="item in list2" :key="item.id" type="2">
    <image :src="item.cover" />
  </list-item>
</list-view>
```

### 图片优化

1. **压缩后再上传**，原图动辄 5MB+
2. **使用 CDN 缩略图参数**，列表页用小图，详情页用大图
3. **image 组件设置 mode="aspectFill"** 避免留白
4. **懒加载**：lazy-load="true"（微信、App）
5. **小程序端用 webp 格式**：webp="true"

### 分包与代码体积

1. **主包控制在 2MB 以内**（微信小程序硬限制）
2. **static 目录的文件会被原样复制**，大文件放 CDN
3. **启用 tree-shaking**："optimization": { "subPackages": true }
4. **uni_modules 的未使用组件不会被打包**（easycom 按需加载）

### 启动速度优化

1. 减少 App.vue onLaunch 中的同步操作
2. 延迟加载非首屏需要的模块
3. 首页简化，数据异步加载
4. nvue 首页启动更快（原生渲染，无 WebView 初始化）

### 渲染优化

1. **减少 setData 频率**：小程序端每次 setData 都是桥通信，批量更新
2. **避免频繁操作 DOM 节点信息**（boundingClientRect 等）
3. **v-if vs v-show**：频繁切换用 v-show，条件渲染用 v-if
4. **computed 缓存计算结果**，避免 template 中写复杂表达式

---

## 7. 状态管理最佳实践

### Pinia（Vue 3 推荐）

```js
import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    userInfo: null,
    token: uni.getStorageSync('token') || ''
  }),
  getters: {
    isLoggedIn: (state) => !!state.token
  },
  actions: {
    async login(credentials) {
      const res = await uni.request({ /* ... */ })
      this.token = res.data.token
      uni.setStorageSync('token', this.token)
    },
    logout() {
      this.token = ''
      this.userInfo = null
      uni.removeStorageSync('token')
    }
  }
})
```

### 状态持久化注意

1. 不要把整个 store 序列化到 storage，只持久化必要字段
2. token 刷新后要同步更新 storage
3. 敏感数据不要存 storage（iOS 越狱/Android root 可读取）
4. storage 数据在用户换设备后丢失，关键数据要同步到云端

---

## 8. 网络请求最佳实践

### 封装 uni.request

```js
const BASE_URL = 'https://api.example.com'

export function request(options) {
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('token')
    uni.request({
      url: BASE_URL + options.url,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? 'Bearer ' + token : '',
        ...options.header
      },
      success(res) {
        if (res.statusCode === 200) {
          if (res.data.code === 0) {
            resolve(res.data)
          } else if (res.data.code === 401) {
            uni.removeStorageSync('token')
            uni.reLaunch({ url: '/pages/login/login' })
            reject(res.data)
          } else {
            uni.showToast({ title: res.data.message || '请求失败', icon: 'none' })
            reject(res.data)
          }
        } else {
          uni.showToast({ title: '服务器错误(' + res.statusCode + ')', icon: 'none' })
          reject(res)
        }
      },
      fail(err) {
        uni.showToast({ title: '网络异常', icon: 'none' })
        reject(err)
      }
    })
  })
}
```

### 请求要点

1. 统一错误处理：网络异常、业务错误、401 鉴权失效
2. 请求超时设置合理值：普通接口 10s，上传 60s
3. 请求重试：网络异常自动重试 1-2 次
4. 并发控制：小程序限制 10 个并发，大量请求需排队
5. 取消请求：页面销毁时取消未完成的请求

---

## 9. UniCloud 开发避坑

### 云函数 vs 云对象

- **新项目用云对象**，API 更直观、错误处理更好
- 已有项目继续用云函数，两种方式可以共存
- 云对象的 _before/_after 拦截器可以统一做鉴权和日志

### 数据库安全规则

1. 不要在客户端直连数据库做管理操作，安全规则不是万能的
2. schema 中的 permission 是客户端查询的权限控制，服务端不受限制
3. 敏感操作必须走云函数/云对象，在服务端校验权限
4. JQL 的 limit 最大 1000（客户端），大量数据用分页或聚合

### 云存储注意

1. 上传文件大小限制：单文件最大 100MB
2. cloudPath 不要用中文，可能出现编码问题
3. fileID 是永久有效的，可以存到数据库中引用
4. 临时 URL 有过期时间，默认 2 小时

### uni-id 注意

1. token 过期后自动刷新，但刷新 token 也有过期时间
2. 多端登录默认不互踢，需要自己实现
3. 微信小程序登录：先 uni.login 拿 code，再传给云对象换取 openid
4. 手机号获取：微信小程序需要用户点击 button（open-type="getPhoneNumber"）

---

## 10. UniApp X 注意事项

### UTS 语言陷阱

1. 不能用 any 类型 — 必须所有变量都有明确类型
2. 动态属性访问受限 — 不能用 obj[dynamicKey]，用 UTSJSONObject
3. 没有 eval 和 new Function — 无法运行时执行代码
4. 正则表达式有限制 — 部分高级正则特性不支持
5. async/await 正常支持，但回调风格需要手动包装

```typescript
// UTS 正确写法
type UserInfo = {
  name: string
  age: number
  avatar?: string
}

// UTSJSONObject 用于动态数据
let data: UTSJSONObject = { key: "value" }
let val = data['key'] as string
```

### UniApp X 组件差异

1. 没有 DOM，不能使用任何 DOM API
2. CSS 是子集，很多 CSS 属性不支持
3. 组件属性类型更严格 — 字符串/数字必须匹配，不能隐式转换
4. v-html 不存在 — 用 rich-text 组件替代
5. flatten 属性可减少视图层级，提升性能

### 编译与调试

1. UTS 插件的 Android 部分需要云编译，本地编译需要 Android SDK
2. iOS 编译需要 Mac + Xcode
3. 调试用 HBuilderX 内置工具，Chrome DevTools 不能直接用
4. 自定义基座是调试 UTS 原生插件的必经之路

---

## 11. 小程序审核与发布避坑

### 微信小程序

1. 必须配置隐私协议：manifest.json 的 privacy 字段
2. 用户隐私相关 API 需声明：requiredPrivateInfos
3. 虚拟支付 iOS 不允许，必须有实物商品
4. 分享功能需手动定义 onShareAppMessage
5. 域名必须配置白名单：服务器域名、socket 域名等
6. 代码体积限制 20MB（主包 2MB + 分包各 2MB）
7. wx.getUserProfile 已废弃，用头像昵称填写能力

### 支付宝小程序

1. 组件系统不同，部分组件需要条件编译适配
2. 不支持 v-html
3. canvas API 与微信不同

### App 发布

1. Android 签名证书不要丢失，丢了无法更新
2. iOS 证书每年需要续期
3. App Store 审核需要隐私政策链接
4. targetSdkVersion 30+ 需要适配分区存储

---

## 12. 常见 Bug 汇总

### 页面白屏

- 原因1：JS 报错导致渲染中断 -> 检查控制台错误
- 原因2：nvue 页面样式缺失 -> nvue 必须写宽高或 flex
- 原因3：小程序页面未在 pages.json 注册
- 原因4：路由跳转路径错误

### 页面栈溢出

- 现象：navigateTo 无反应
- 原因：页面栈超过 10 层（小程序）
- 解决：用 redirectTo 替代 navigateTo，或 reLaunch 重置栈

### 图片不显示

- 原因1：路径错误 — 检查相对/绝对路径
- 原因2：未设宽高 — image 有默认 320x240
- 原因3：小程序域名未配置白名单
- 原因4：网络图片 HTTP 被拦截

### 键盘遮挡输入框

- 解决1：adjust-position="true"（默认开启）
- 解决2：手动监听 @keyboardheightchange 调整布局
- 解决3：使用 cursor-spacing 设置间距

### setData 卡顿（小程序）

- 原因：频繁调用 setData 或传递大量数据
- 解决：批量更新，只传变化的数据，减少 setData 调用频率

### 原生组件层级问题

- 影响组件：input、textarea、video、map、camera、canvas
- 现象：z-index 无效，原生组件永远在最上层
- 解决1：使用 cover-view / cover-image 覆盖
- 解决2：弹窗时用 v-if 隐藏原生组件
- 解决3：使用 same-layer-rendering（同层渲染，部分平台支持）

### 自定义导航栏适配

```js
const sysInfo = uni.getSystemInfoSync()
const statusBarHeight = sysInfo.statusBarHeight
const navBarHeight = statusBarHeight + (sysInfo.platform === 'ios' ? 44 : 48)
```

### Vue 3 兼容性

1. this.$refs 在 script setup 中不存在，用 ref() + refName.value
2. this.$emit 改为 defineEmits
3. this.$props 改为 defineProps
4. 生命周期用 @dcloudio/uni-app 的钩子（onLoad, onShow 等），不是 Vue 的
5. Pinia 替代 Vuex

### onReachBottom 不触发

- 原因1：页面内容不够长，没有滚动条
- 原因2：使用了 scroll-view，页面级 onReachBottom 不生效
- 解决：在 scroll-view 上用 @scrolltolower

### pullDownRefresh 不生效

- 原因1：pages.json 没有设置 enablePullDownRefresh: true
- 原因2：使用了自定义导航栏 navigationStyle: "custom"
- 解决：使用 scroll-view 的 refresher-enabled 替代页面级下拉刷新
