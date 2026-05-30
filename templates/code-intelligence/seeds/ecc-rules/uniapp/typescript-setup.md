# UniApp TypeScript + Composition API 深度参考

## 目录

1. [项目初始化](#1-项目初始化)
2. [script setup 核心模式](#2-script-setup-核心模式)
3. [类型定义与增强](#3-类型定义与增强)
4. [页面生命周期（Composition API）](#4-页面生命周期composition-api)
5. [组件通信](#5-组件通信)
6. [Pinia 状态管理](#6-pinia-状态管理)
7. [泛型组件](#7-泛型组件)
8. [uni.* API 的 TypeScript 类型](#8-uni-api-的-typescript-类型)
9. [常见类型陷阱](#9-常见类型陷阱)

---

## 1. 项目初始化

### 创建 Vue 3 + TypeScript 项目

```bash
npx degit dcloudio/uni-preset-vue#vite-ts my-project
```

### 关键配置文件

**tsconfig.json**（UniApp Vue 3 TS 项目标准配置）：

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "strict": true,
    "jsx": "preserve",
    "importHelpers": true,
    "moduleResolution": "node",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "sourceMap": true,
    "baseUrl": ".",
    "types": ["@dcloudio/types", "@types/uni-app"],
    "paths": {
      "@/*": ["./src/*"]
    },
    "lib": ["esnext", "dom"]
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue"]
}
```

### 必装类型包

```bash
npm install -D @dcloudio/types @types/uni-app
```

- `@dcloudio/types` — uni.* API 类型定义
- `@types/uni-app` — 页面生命周期、组件类型增强

---

## 2. script setup 核心模式

### 基础页面结构

```html
<template>
  <view class="page">
    <text>{{ title }}</text>
    <text>计数：{{ count }}</text>
    <button @click="increment">+1</button>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'

const title = ref<string>('首页')
const count = ref<number>(0)
const doubleCount = computed(() : number => count.value * 2)

function increment() : void {
  count.value++
}

onLoad((options) => {
  console.log('页面参数：', options)
})

onShow(() => {
  console.log('页面显示')
})
</script>

<style scoped>
.page { padding: 20rpx; }
</style>
```

### 响应式数据类型声明

```typescript
import { ref, reactive, computed } from 'vue'

// ref — 简单值
const name = ref<string>('')
const age = ref<number>(0)
const list = ref<UserInfo[]>([])
const isVisible = ref<boolean>(false)

// reactive — 对象
interface FormState {
  username: string
  password: string
  remember: boolean
}
const form = reactive<FormState>({
  username: '',
  password: '',
  remember: false
})

// computed
const fullName = computed<string>(() => `${firstName.value} ${lastName.value}`)
const isValid = computed<boolean>(() => form.username.length > 0 && form.password.length >= 6)
```

### 异步操作

```typescript
import { ref } from 'vue'

const loading = ref(false)
const data = ref<PageData | null>(null)

async function fetchData() : Promise<void> {
  loading.value = true
  try {
    const res = await uni.request({
      url: '/api/data',
      method: 'GET'
    })
    data.value = res.data as PageData
  } catch (err) {
    uni.showToast({ title: '请求失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}
```

---

## 3. 类型定义与增强

### 业务类型定义

```typescript
// types/user.ts
export interface UserInfo {
  id: string
  nickname: string
  avatar: string
  phone?: string
  role: 'admin' | 'editor' | 'viewer'
}

export interface LoginParams {
  username: string
  password: string
}

export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export type PageResult<T> = {
  list: T[]
  total: number
  page: number
  pageSize: number
}
```

### 全局类型声明

```typescript
// src/env.d.ts
/// <reference-types="@dcloudio/types" />

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
```

### uni.* API 返回值类型断言

uni.request 等回调式 API 的返回值默认是 `any`，需要手动断言：

```typescript
interface UserResult {
  code: number
  data: UserInfo
}

const res = await uni.request({
  url: '/api/user',
  method: 'GET'
}) as UniApp.RequestRes & { data: UserResult }

const user = res.data.data
```

**推荐**：封装后的 request 函数直接返回泛型：

```typescript
function request<T>(options: RequestOptions) : Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
      success: (res) => {
        if (res.statusCode === 200) {
          resolve(res.data as T)
        } else {
          reject(res)
        }
      },
      fail: reject
    })
  })
}

// 使用
const user = await request<UserInfo>({ url: '/api/user', method: 'GET' })
```

---

## 4. 页面生命周期（Composition API）

### 从 @dcloudio/uni-app 导入

```typescript
import {
  onLoad,
  onShow,
  onReady,
  onHide,
  onUnload,
  onPullDownRefresh,
  onReachBottom,
  onShareAppMessage,
  onBackPress,
  onNavigationBarButtonTap
} from '@dcloudio/uni-app'
```

### 完整生命周期示例

```typescript
// 页面加载 — 获取路由参数
onLoad((options: Record<string, string>) => {
  const id = options.id
  fetchDetail(id)
})

// 页面显示 — 每次可见都执行
onShow(() => {
  refreshData()
})

// 首次渲染完成
onReady(() => {
  // 可以获取节点信息
  uni.createSelectorQuery()
    .select('.title')
    .boundingClientRect()
    .exec()
})

// 页面隐藏
onHide(() => {
  pauseVideo()
})

// 页面卸载 — 清理监听
onUnload(() => {
  uni.$off('dataUpdated')
  abortController?.abort()
})

// 下拉刷新
onPullDownRefresh(async () => {
  await refreshData()
  uni.stopPullDownRefresh()
})

// 触底加载
onReachBottom(() => {
  if (hasMore.value && !loading.value) {
    loadMore()
  }
})

// 分享
onShareAppMessage(() => ({
  title: '分享标题',
  path: '/pages/index/index',
  imageUrl: '/static/share.png'
}))
```

### 生命周期执行顺序

```
首次进入: onLoad → onShow → onReady
返回页面: onShow（onLoad 不会重新触发）
页面隐藏: onHide
页面销毁: onUnload
```

---

## 5. 组件通信

### Props + Emits

```html
<!-- 子组件 ChildComp.vue -->
<script setup lang="ts">
interface Props {
  title: string
  count?: number
  items: string[]
}

const props = withDefaults(defineProps<Props>(), {
  count: 0
})

const emit = defineEmits<{
  (e: 'change', value: string): void
  (e: 'delete', id: number): void
}>()

function handleClick() {
  emit('change', 'new-value')
}
</script>
```

```html
<!-- 父组件 -->
<template>
  <child-comp
    :title="pageTitle"
    :items="list"
    @change="handleChange"
    @delete="handleDelete"
  />
</template>

<script setup lang="ts">
import ChildComp from '@/components/ChildComp.vue'

const pageTitle = ref('标题')
const list = ref<string[]>(['a', 'b'])

function handleChange(value: string) {
  console.log(value)
}

function handleDelete(id: number) {
  console.log(id)
}
</script>
```

### provide / inject（跨层级）

```typescript
// 祖先组件 provide
import { provide, ref } from 'vue'

const theme = ref<'light' | 'dark'>('light')
provide('theme', theme)

// 后代组件 inject
import { inject } from 'vue'

const theme = inject<Ref<'light' | 'dark'>>('theme')!
```

### uni.$on / uni.$emit（跨页面通信）

```typescript
// 页面 A — 监听
import { onUnload } from '@dcloudio/uni-app'

onShow(() => {
  uni.$on('orderUpdated', handleOrderUpdate)
})

onUnload(() => {
  uni.$off('orderUpdated', handleOrderUpdate) // 必须清理，否则内存泄漏
})

// 页面 B — 触发
uni.$emit('orderUpdated', { orderId: '123' })
```

---

## 6. Pinia 状态管理

### 定义 Store

```typescript
// store/user.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUserStore = defineStore('user', () => {
  const token = ref<string>(uni.getStorageSync('token') || '')
  const userInfo = ref<UserInfo | null>(null)

  const isLoggedIn = computed(() : boolean => !!token.value)
  const nickname = computed(() : string => userInfo.value?.nickname ?? '未登录')

  async function login(params: LoginParams) : Promise<void> {
    const res = await request<LoginResult>({ url: '/auth/login', method: 'POST', data: params })
    token.value = res.token
    userInfo.value = res.user
    uni.setStorageSync('token', res.token)
  }

  function logout() : void {
    token.value = ''
    userInfo.value = null
    uni.removeStorageSync('token')
    uni.reLaunch({ url: '/pages/login/login' })
  }

  return { token, userInfo, isLoggedIn, nickname, login, logout }
})
```

### 在页面中使用 Store

```html
<script setup lang="ts">
import { useUserStore } from '@/store/user'

const userStore = useUserStore()

// 响应式使用
const isLoggedIn = computed(() => userStore.isLoggedIn)

function handleLogout() {
  userStore.logout()
}
</script>

<template>
  <view v-if="isLoggedIn">
    <text>{{ userStore.nickname }}</text>
    <button @click="handleLogout">退出</button>
  </view>
</template>
```

### Pinia 持久化插件

```typescript
// store/plugins/persist.ts
import type { PiniaPluginContext } from 'pinia'

export function piniaPersistPlugin({ store }: PiniaPluginContext) {
  const persistedKeys = (store.$id as string) === 'user' ? ['token'] : []

  // 恢复
  persistedKeys.forEach((key) => {
    const saved = uni.getStorageSync(`${store.$id}_${key}`)
    if (saved !== '' && saved !== undefined) {
      store.$patch({ [key]: saved })
    }
  })

  // 监听变化
  store.$subscribe((mutation, state) => {
    persistedKeys.forEach((key) => {
      uni.setStorageSync(`${store.$id}_${key}`, state[key])
    })
  })
}

// main.ts
import { createPinia } from 'pinia'

const pinia = createPinia()
pinia.use(piniaPersistPlugin)
```

---

## 7. 泛型组件

### 基础泛型列表组件

```html
<!-- components/GenericList.vue -->
<script setup lang="ts" generic="T extends { id: string | number }">
interface Props {
  items: T[]
  loading?: boolean
  finished?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  finished: false
})

const emit = defineEmits<{
  (e: 'loadMore'): void
  (e: 'itemClick', item: T): void
}>()
</script>

<template>
  <scroll-view scroll-y class="list" @scrolltolower="!finished && !loading && emit('loadMore')">
    <view v-for="item in items" :key="item.id" class="item" @click="emit('itemClick', item)">
      <slot name="item" :data="item" />
    </view>
    <view v-if="loading" class="loading">
      <text>加载中...</text>
    </view>
    <view v-if="finished && items.length > 0" class="finished">
      <text>没有更多了</text>
    </view>
  </scroll-view>
</template>
```

### 使用泛型组件

```html
<script setup lang="ts">
import GenericList from '@/components/GenericList.vue'

interface ArticleItem {
  id: number
  title: string
  cover: string
}

const articles = ref<ArticleItem[]>([])
</script>

<template>
  <generic-list :items="articles" @load-more="fetchArticles" @item-click="goDetail">
    <template #item="{ data }">
      <text>{{ (data as ArticleItem).title }}</text>
    </template>
  </generic-list>
</template>
```

---

## 8. uni.* API 的 TypeScript 类型

### 常用 API 类型签名

```typescript
// uni.request
uni.request({
  url: string,
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS',
  data?: any,
  header?: Record<string, string>,
  timeout?: number,
  success?: (result: UniApp.RequestRes) => void,
  fail?: (result: UniApp.RequestFailRes) => void,
  complete?: (result: any) => void
})

// uni.navigateTo
uni.navigateTo({
  url: string,
  animationType?: string,
  animationDuration?: number,
  success?: () => void,
  fail?: () => void
})

// uni.showModal
uni.showModal({
  title?: string,
  content?: string,
  showCancel?: boolean,
  cancelText?: string,
  confirmText?: string,
  editable?: boolean,
  placeholderText?: string,
  success?: (result: { confirm: boolean; cancel: boolean; content?: string }) => void
})

// uni.setStorage
uni.setStorage({
  key: string,
  data: any,
  success?: () => void,
  fail?: () => void
})

// uni.getLocation
uni.getLocation({
  type?: 'wgs84' | 'gcj02',
  altitude?: boolean,
  isHighAccuracy?: boolean,
  success?: (result: { longitude: number; latitude: number; speed: number; accuracy: number }) => void
})
```

### 封装 Promise 化函数

```typescript
function navigateTo(url: string) : Promise<void> {
  return new Promise((resolve, reject) => {
    uni.navigateTo({ url, success: resolve, fail: reject })
  })
}

function showModal(options: UniApp.ShowModalOptions) : Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      ...options,
      success: (res) => resolve(res.confirm)
    })
  })
}

function getLocation(type: 'wgs84' | 'gcj02' = 'gcj02') : Promise<{ longitude: number; latitude: number }> {
  return new Promise((resolve, reject) => {
    uni.getLocation({
      type,
      success: resolve,
      fail: reject
    })
  })
}
```

---

## 9. 常见类型陷阱

### ref 解包

```typescript
// 在 script setup 中，ref 在模板自动解包，在 script 中需要 .value
const count = ref(0)
console.log(count.value) // script 中
// <text>{{ count }}</text>  模板中自动解包

// reactive 对象中的 ref 也会自动解包
const state = reactive({ count: ref(0) })
console.log(state.count) // 已解包，不需要 .value
```

### defineProps 的泛型 vs 运行时声明

```typescript
// 泛型声明（推荐，更简洁）
const props = defineProps<{
  title: string
  count?: number
}>()

// 带默认值
const props = withDefaults(defineProps<{
  title: string
  count?: number
}>(), {
  count: 0
})

// 运行时声明（需要复杂验证逻辑时使用）
const props = defineProps({
  title: { type: String, required: true },
  count: { type: Number, default: 0 }
})
```

### uni-app 生命周期 vs Vue 生命周期

```typescript
// ❌ 不要在 UniApp 中使用 Vue 的 onMounted
import { onMounted } from 'vue' // 不推荐

// ✅ 使用 UniApp 的 onLoad / onReady
import { onLoad, onReady } from '@dcloudio/uni-app' // 推荐

// 区别：
// onLoad — 页面加载，接收路由参数（UniApp 特有）
// onReady — 首次渲染完成（近似 onMounted）
// onMounted — 在 UniApp 中行为不稳定，不同平台表现不同
```

### 事件类型

```typescript
// input 事件
function onInput(e: UniHelper.InputOnInputEvent) {
  const value = e.detail.value
}

// click 事件（无需特殊类型，直接用）
function onClick() {
  // ...
}

// scroll 事件
function onScroll(e: { detail: { scrollTop: number; scrollLeft: number } }) {
  // ...
}
```

### 组件 ref 类型

```typescript
import type { ComponentPublicInstance } from 'vue'

// 基础元素
const inputRef = ref<HTMLInputElement | null>(null)

// 组件实例
interface ListCompInstance {
  refresh: () => void
  loadMore: () => void
}
const listRef = ref<ComponentPublicInstance<ListCompInstance> | null>(null)

function handleRefresh() {
  listRef.value?.refresh()
}
```
