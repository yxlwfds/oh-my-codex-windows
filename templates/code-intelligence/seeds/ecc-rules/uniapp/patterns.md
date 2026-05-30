# UniApp 常见场景模板

## 目录

1. [微信登录完整流程](#1-微信登录完整流程)
2. [支付完整链路](#2-支付完整链路)
3. [图片上传+压缩+裁剪](#3-图片上传压缩裁剪)
4. [分享海报生成](#4-分享海报生成)
5. [权限申请与引导](#5-权限申请与引导)
6. [自定义导航栏（含安全区适配）](#6-自定义导航栏含安全区适配)
7. [下拉刷新+触底加载列表](#7-下拉刷新触底加载列表)
8. [表单验证](#8-表单验证)

---

## 1. 微信登录完整流程

### 流程图

```
用户点击登录 → uni.login 获取 code → 传给后端换取 openid/session_key → 后端返回 token → 存储 token
```

### 前端实现

```typescript
// api/auth.ts
export function wxLogin() : Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: async (loginRes) => {
        try {
          // 将 code 发送到后端
          const res = await request<LoginResult>({
            url: '/auth/wx-login',
            method: 'POST',
            data: { code: loginRes.code }
          })
          resolve(res)
        } catch (err) {
          reject(err)
        }
      },
      fail: reject
    })
  })
}
```

### 登录页面

```html
<template>
  <view class="login-page">
    <view class="logo-area">
      <image src="/static/logo.png" mode="aspectFit" class="logo" />
    </view>

    <!-- 微信一键登录（仅小程序） -->
    <button v-if="isMP" class="btn-wx" open-type="getPhoneNumber" @getphonenumber="onGetPhoneNumber">
      微信手机号登录
    </button>

    <!-- 通用登录 -->
    <view class="form-area">
      <input v-model="form.phone" type="number" placeholder="请输入手机号" maxlength="11" />
      <view class="code-row">
        <input v-model="form.code" type="number" placeholder="验证码" maxlength="6" />
        <button :disabled="countdown > 0" @click="sendSmsCode" class="btn-sms">
          {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
        </button>
      </view>
      <button :disabled="!canSubmit" @click="onSmsLogin" class="btn-submit">登录</button>
    </view>

    <!-- 协议 -->
    <view class="agreement">
      <switch :checked="agreed" @change="agreed = $event.detail.value" />
      <text>同意《用户协议》和《隐私政策》</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { useUserStore } from '@/store/user'

const userStore = useUserStore()
const isMP = ref(false)
const agreed = ref(false)
const countdown = ref(0)
const form = reactive({ phone: '', code: '' })

const canSubmit = computed(() => form.phone.length === 11 && form.code.length === 6 && agreed.value)

onLoad(() => {
  // #ifdef MP-WEIXIN
  isMP.value = true
  // #endif
})

// 微信手机号登录
async function onGetPhoneNumber(e: any) {
  if (!agreed.value) {
    uni.showToast({ title: '请先同意协议', icon: 'none' })
    return
  }
  if (e.detail.errMsg !== 'getPhoneNumber:ok') return

  try {
    // e.detail.code 是微信返回的手机号凭证，需传给后端解密
    await userStore.wxPhoneLogin({ code: e.detail.code })
    uni.switchTab({ url: '/pages/index/index' })
  } catch (err) {
    uni.showToast({ title: '登录失败', icon: 'none' })
  }
}

// 发送验证码
async function sendSmsCode() {
  if (form.phone.length !== 11) {
    uni.showToast({ title: '请输入正确手机号', icon: 'none' })
    return
  }
  await request({ url: '/auth/send-sms', method: 'POST', data: { phone: form.phone } })
  startCountdown()
}

// 验证码登录
async function onSmsLogin() {
  try {
    await userStore.smsLogin({ phone: form.phone, code: form.code })
    uni.switchTab({ url: '/pages/index/index' })
  } catch (err) {
    uni.showToast({ title: '登录失败', icon: 'none' })
  }
}

function startCountdown() {
  countdown.value = 60
  const timer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) clearInterval(timer)
  }, 1000)
}
</script>
```

### 后端云对象（UniCloud）

```javascript
// uniCloud-aliyun/cloudfunctions/auth/index.obj.js
module.exports = {
  _before() {
    this.startTime = Date.now()
  },

  async wxLogin(code) {
    // 用 code 换取 session_key + openid
    const wxRes = await uniCloud.httpclient.request(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${this.appid}&secret=${this.secret}&js_code=${code}&grant_type=authorization_code`,
      { dataType: 'json' }
    )

    const { openid, session_key } = wxRes.data

    // 查找或创建用户
    const db = uniCloud.database()
    let userRes = await db.collection('users').where({ openid }).get()

    let userId
    if (userRes.data.length === 0) {
      const addRes = await db.collection('users').add({ openid, create_time: Date.now() })
      userId = addRes.id
    } else {
      userId = userRes.data[0]._id
    }

    // 生成 token
    const token = await this.generateToken(userId)

    return { errCode: 0, token, uid: userId }
  },

  async wxPhoneLogin(data) {
    const token = this.getUniIdToken()
    if (!token) throw new Error('未登录')

    // 用 code 换取手机号（微信新版接口）
    const phoneRes = await uniCloud.httpclient.request(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${await this.getAccessToken()}&code=${data.code}`,
      { dataType: 'json', method: 'POST' }
    )

    const phone = phoneRes.data.phone_info.phoneNumber

    // 更新用户手机号
    const db = uniCloud.database()
    await db.collection('users').doc(token.uid).update({ phone })

    return { errCode: 0, phone }
  }
}
```

---

## 2. 支付完整链路

### 流程图

```
用户下单 → 后端创建订单 → 后端调用支付平台统一下单 → 返回支付参数 → 前端拉起支付 → 支付回调通知后端 → 前端查询订单状态
```

### 前端实现

```typescript
// api/payment.ts
interface CreateOrderParams {
  productId: string
  quantity: number
  addressId: string
}

interface OrderResult {
  orderId: string
  paymentParams: Record<string, any>
}

export async function createAndPay(params: CreateOrderParams) : Promise<void> {
  // 1. 创建订单，获取支付参数
  const { orderId, paymentParams } = await request<OrderResult>({
    url: '/order/create',
    method: 'POST',
    data: params
  })

  // 2. 拉起支付
  await new Promise<void>((resolve, reject) => {
    uni.requestPayment({
      provider: getPaymentProvider(),
      ...paymentParams,
      success: () => resolve(),
      fail: (err) => {
        // 用户取消不算失败
        if (err.errMsg?.includes('cancel')) {
          reject(new Error('PAY_CANCELLED'))
        } else {
          reject(new Error('PAY_FAILED'))
        }
      }
    })
  })

  // 3. 支付成功，查询订单状态确认
  await pollOrderStatus(orderId)
}

function getPaymentProvider() : string {
  // #ifdef MP-WEIXIN
  return 'wxpay'
  // #endif
  // #ifdef MP-ALIPAY
  return 'alipay'
  // #endif
  // #ifdef APP-PLUS
  return 'wxpay' // App 端需在 manifest.json 配置
  // #endif
}

async function pollOrderStatus(orderId: string, maxRetries = 5) : Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    await sleep(1000 * (i + 1))
    const order = await request<OrderInfo>({ url: `/order/${orderId}`, method: 'GET' })
    if (order.status === 'paid') return
    if (order.status === 'failed') throw new Error('PAY_FAILED')
  }
  throw new Error('PAY_TIMEOUT')
}

function sleep(ms: number) : Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

### 支付页面调用

```html
<script setup lang="ts">
const loading = ref(false)

async function handleBuy() {
  loading.value = true
  try {
    await createAndPay({
      productId: product.value.id,
      quantity: 1,
      addressId: selectedAddress.value.id
    })
    uni.showToast({ title: '支付成功', icon: 'success' })
    setTimeout(() => {
      uni.redirectTo({ url: '/pages/order/detail?id=' + orderId })
    }, 1500)
  } catch (err) {
    if (err.message === 'PAY_CANCELLED') {
      uni.showToast({ title: '已取消支付', icon: 'none' })
    } else {
      uni.showToast({ title: '支付失败，请重试', icon: 'none' })
    }
  } finally {
    loading.value = false
  }
}
</script>
```

---

## 3. 图片上传+压缩+裁剪

### 选择 + 压缩 + 上传

```typescript
// utils/upload.ts
interface UploadOptions {
  count?: number
  maxSize?: number        // 单位 MB
  quality?: number        // 压缩质量 0-100
  cloudPath?: string      // UniCloud 路径前缀
}

interface UploadResult {
  url: string
  fileID?: string
}

export async function chooseAndUpload(options: UploadOptions = {}) : Promise<UploadResult[]> {
  const { count = 1, maxSize = 5, quality = 80, cloudPath = 'uploads' } = options

  // 1. 选择图片
  const chooseRes = await new Promise<UniApp.ChooseImageRes>((resolve, reject) => {
    uni.chooseImage({
      count,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: resolve,
      fail: reject
    })
  })

  const results: UploadResult[] = []

  for (const tempPath of chooseRes.tempFilePaths) {
    // 2. 检查文件大小
    const fileInfo = await getFileInfo(tempPath)
    if (fileInfo.size > maxSize * 1024 * 1024) {
      uni.showToast({ title: `图片不能超过${maxSize}MB`, icon: 'none' })
      continue
    }

    // 3. 压缩
    const compressedPath = await compressImage(tempPath, quality)

    // 4. 上传
    const uploadRes = await uploadFile(compressedPath, cloudPath)
    results.push(uploadRes)
  }

  return results
}

function compressImage(filePath: string, quality: number) : Promise<string> {
  return new Promise((resolve) => {
    uni.compressImage({
      src: filePath,
      quality,
      success: (res) => resolve(res.tempFilePath),
      fail: () => resolve(filePath) // 压缩失败用原图
    })
  })
}

async function uploadFile(filePath: string, cloudPath: string) : Promise<UploadResult> {
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
  const fullPath = `${cloudPath}/${fileName}`

  // 使用 UniCloud 上传
  const res = await uniCloud.uploadFile({
    filePath,
    cloudPath: fullPath
  })

  return {
    url: res.fileURL,
    fileID: res.fileID
  }
}

function getFileInfo(filePath: string) : Promise<{ size: number }> {
  return new Promise((resolve) => {
    uni.getFileInfo({
      filePath,
      success: (res) => resolve({ size: res.size }),
      fail: () => resolve({ size: 0 })
    })
  })
}
```

### 头像上传组件

```html
<template>
  <view class="avatar-upload" @click="onChoose">
    <image v-if="url" :src="url" mode="aspectFill" class="avatar" />
    <view v-else class="avatar-placeholder">
      <text class="plus">+</text>
    </view>
  </view>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const url = computed(() => props.modelValue)

async function onChoose() {
  const res = await chooseAndUpload({ count: 1, quality: 80, cloudPath: 'avatars' })
  if (res.length > 0) {
    emit('update:modelValue', res[0].url)
  }
}
</script>

<style scoped>
.avatar-upload { width: 160rpx; height: 160rpx; border-radius: 50%; overflow: hidden; }
.avatar { width: 100%; height: 100%; }
.avatar-placeholder { width: 100%; height: 100%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; }
.plus { font-size: 48rpx; color: #ccc; }
</style>
```

---

## 4. 分享海报生成

### Canvas 绘制 → 保存相册

```typescript
// utils/poster.ts
interface PosterConfig {
  width: number
  height: number
  background: string
  elements: PosterElement[]
}

type PosterElement =
  | { type: 'image'; x: number; y: number; width: number; height: number; src: string; borderRadius?: number }
  | { type: 'text'; x: number; y: number; content: string; fontSize?: number; color?: string; fontWeight?: string; maxWidth?: number }
  | { type: 'rect'; x: number; y: number; width: number; height: number; fill: string; borderRadius?: number }
  | { type: 'qrcode'; x: number; y: number; size: number; content: string }

export async function generatePoster(canvasId: string, config: PosterConfig) : Promise<string> {
  const ctx = uni.createCanvasContext(canvasId)

  // 背景
  ctx.setFillStyle(config.background)
  ctx.fillRect(0, 0, config.width, config.height)

  for (const el of config.elements) {
    switch (el.type) {
      case 'image':
        await drawImage(ctx, el)
        break
      case 'text':
        drawText(ctx, el)
        break
      case 'rect':
        drawRect(ctx, el)
        break
      case 'qrcode':
        // 需集成 QR 生成库，将生成的图片用 drawImage 绘制
        break
    }
  }

  return new Promise((resolve, reject) => {
    ctx.draw(false, () => {
      setTimeout(() => {
        uni.canvasToTempFilePath({
          canvasId,
          success: (res) => resolve(res.tempFilePath),
          fail: reject
        })
      }, 300) // 等待渲染完成
    })
  })
}

function drawImage(ctx: any, el: Extract<PosterElement, { type: 'image' }>) : Promise<void> {
  return new Promise((resolve) => {
    if (el.borderRadius) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(el.x + el.borderRadius, el.y + el.borderRadius, el.borderRadius, 0, 2 * Math.PI)
      ctx.clip()
    }
    ctx.drawImage(el.src, el.x, el.y, el.width, el.height)
    if (el.borderRadius) ctx.restore()
    resolve()
  })
}

function drawText(ctx: any, el: Extract<PosterElement, { type: 'text' }>) {
  ctx.setFillStyle(el.color || '#333333')
  ctx.setFontSize(el.fontSize || 14)
  if (el.fontWeight) ctx.font = `${el.fontWeight} ${el.fontSize || 14}px`
  if (el.maxWidth) {
    // 自动换行
    const chars = el.content.split('')
    let line = ''
    let y = el.y
    for (const char of chars) {
      const testLine = line + char
      const metrics = ctx.measureText(testLine)
      if (metrics.width > el.maxWidth) {
        ctx.fillText(line, el.x, y)
        line = char
        y += (el.fontSize || 14) * 1.5
      } else {
        line = testLine
      }
    }
    ctx.fillText(line, el.x, y)
  } else {
    ctx.fillText(el.content, el.x, el.y)
  }
}

function drawRect(ctx: any, el: Extract<PosterElement, { type: 'rect' }>) {
  ctx.setFillStyle(el.fill)
  if (el.borderRadius) {
    const r = el.borderRadius
    ctx.beginPath()
    ctx.moveTo(el.x + r, el.y)
    ctx.lineTo(el.x + el.width - r, el.y)
    ctx.quadraticCurveTo(el.x + el.width, el.y, el.x + el.width, el.y + r)
    ctx.lineTo(el.x + el.width, el.y + el.height - r)
    ctx.quadraticCurveTo(el.x + el.width, el.y + el.height, el.x + el.width - r, el.y + el.height)
    ctx.lineTo(el.x + r, el.y + el.height)
    ctx.quadraticCurveTo(el.x, el.y + el.height, el.x, el.y + el.height - r)
    ctx.lineTo(el.x, el.y + r)
    ctx.quadraticCurveTo(el.x, el.y, el.x + r, el.y)
    ctx.fill()
  } else {
    ctx.fillRect(el.x, el.y, el.width, el.height)
  }
}

export async function saveToAlbum(filePath: string) : Promise<void> {
  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        uni.showToast({ title: '已保存到相册', icon: 'success' })
        resolve()
      },
      fail: (err) => {
        if (err.errMsg?.includes('auth deny')) {
          uni.showModal({
            title: '提示',
            content: '需要相册权限才能保存，是否去设置开启？',
            success: (res) => {
              if (res.confirm) uni.openSetting({})
            }
          })
        }
        reject(err)
      }
    })
  })
}
```

### 使用示例

```html
<template>
  <view>
    <canvas canvas-id="posterCanvas" class="poster-canvas" />
    <button @click="onGenerate">生成海报</button>
    <button @click="onSave">保存到相册</button>
    <image v-if="posterPath" :src="posterPath" mode="widthFix" class="poster-preview" />
  </view>
</template>

<script setup lang="ts">
import { generatePoster, saveToAlbum } from '@/utils/poster'

const posterPath = ref('')

async function onGenerate() {
  posterPath.value = await generatePoster('posterCanvas', {
    width: 375,
    height: 600,
    background: '#ffffff',
    elements: [
      { type: 'rect', x: 0, y: 0, width: 375, height: 300, fill: '#2979ff' },
      { type: 'text', x: 30, y: 100, content: '分享好物', fontSize: 32, color: '#fff', fontWeight: 'bold' },
      { type: 'image', x: 30, y: 320, width: 315, height: 200, src: product.value.cover, borderRadius: 8 },
      { type: 'text', x: 30, y: 540, content: product.value.name, fontSize: 16, color: '#333', maxWidth: 200 },
    ]
  })
}

async function onSave() {
  if (posterPath.value) await saveToAlbum(posterPath.value)
}
</script>

<style scoped>
.poster-canvas { width: 750rpx; height: 1200rpx; position: fixed; left: -9999rpx; }
.poster-preview { width: 750rpx; }
</style>
```

---

## 5. 权限申请与引导

### 动态权限申请（App 端）

```typescript
// utils/permission.ts
type PermissionType = 'location' | 'camera' | 'album' | 'contacts' | 'record'

const permissionMap: Record<PermissionType, { title: string; message: string; android?: string; ios?: string }> = {
  location: {
    title: '位置权限',
    message: '需要获取您的位置信息以提供配送服务',
    android: 'android.permission.ACCESS_FINE_LOCATION',
    ios: 'NSLocationWhenInUseUsageDescription'
  },
  camera: {
    title: '相机权限',
    message: '需要使用相机以拍摄照片',
    android: 'android.permission.CAMERA',
    ios: 'NSCameraUsageDescription'
  },
  album: {
    title: '相册权限',
    message: '需要访问相册以保存图片',
    android: 'android.permission.READ_EXTERNAL_STORAGE',
    ios: 'NSPhotoLibraryUsageDescription'
  },
  contacts: {
    title: '通讯录权限',
    message: '需要访问通讯录以选择联系人',
    android: 'android.permission.READ_CONTACTS',
    ios: 'NSContactsUsageDescription'
  },
  record: {
    title: '麦克风权限',
    message: '需要使用麦克风以录制语音',
    android: 'android.permission.RECORD_AUDIO',
    ios: 'NSMicrophoneUsageDescription'
  }
}

export async function requestPermission(type: PermissionType) : Promise<boolean> {
  const config = permissionMap[type]

  // #ifdef MP-WEIXIN
  return requestMPPermission(type, config)
  // #endif

  // #ifdef APP-PLUS
  return requestAppPermission(type, config)
  // #endif

  // #ifdef H5
  return true // H5 端浏览器自行处理
  // #endif
}

async function requestMPPermission(type: PermissionType, config: typeof permissionMap[PermissionType]) : Promise<boolean> {
  // 微信小程序使用 uni API
  const apiMap = {
    location: 'getLocation',
    camera: 'chooseImage',
    album: 'saveImageToPhotosAlbum',
    contacts: 'chooseContact',
    record: 'startRecord'
  }

  return new Promise((resolve) => {
    uni.authorize({
      scope: `scope.${apiMap[type].replace('get', '').replace('choose', '').toLowerCase()}`,
      success: () => resolve(true),
      fail: () => {
        // 已拒绝过，引导去设置
        uni.showModal({
          title: config.title,
          content: config.message + '，是否去设置开启？',
          success: (res) => {
            if (res.confirm) {
              uni.openSetting({
                success: (settingRes) => {
                  resolve(settingRes.authSetting[`scope.${type}`] === true)
                }
              })
            } else {
              resolve(false)
            }
          }
        })
      }
    })
  })
}

async function requestAppPermission(type: PermissionType, config: typeof permissionMap[PermissionType]) : Promise<boolean> {
  // Android 6.0+ 动态权限
  // #ifdef APP-ANDROID
  return new Promise((resolve) => {
    plus.android.requestPermissions(
      [config.android!],
      (result) => {
        if (result.granted.length > 0) {
          resolve(true)
        } else if (result.deniedAlways.length > 0) {
          // 永久拒绝，引导去设置
          uni.showModal({
            title: config.title,
            content: config.message + '，请在设置中手动开启',
            success: (res) => {
              if (res.confirm) {
                const Intent = plus.android.importClass('android.content.Intent')
                const Settings = plus.android.importClass('android.provider.Settings')
                const Uri = plus.android.importClass('android.net.Uri')
                const intent = new Intent()
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                intent.setData(Uri.fromParts('package', plus.runtime.appid, null))
                plus.android.startActivity(intent)
              }
              resolve(false)
            }
          })
        } else {
          resolve(false)
        }
      }
    )
  })
  // #endif

  // #ifdef APP-IOS
  // iOS 在 Info.plist 中声明后系统自动弹窗，这里只检查状态
  return true
  // #endif
}
```

### 使用示例

```typescript
async function openCamera() {
  const granted = await requestPermission('camera')
  if (!granted) return

  uni.chooseImage({
    count: 1,
    sourceType: ['camera'],
    success: (res) => {
      // 处理拍摄结果
    }
  })
}

async function getLocation() {
  const granted = await requestPermission('location')
  if (!granted) return

  uni.getLocation({
    type: 'gcj02',
    success: (res) => {
      console.log(res.latitude, res.longitude)
    }
  })
}
```

---

## 6. 自定义导航栏（含安全区适配）

### 导航栏组件

```html
<!-- components/NavBar.vue -->
<template>
  <view class="nav-bar" :style="{ paddingTop: statusBarHeight + 'px', backgroundColor: bgColor }">
    <view class="nav-content" :style="{ height: navBarHeight + 'px' }">
      <!-- 左侧 -->
      <view class="nav-left" @click="onBack">
        <image v-if="showBack" src="/static/icons/back.png" mode="aspectFit" class="back-icon" />
        <slot name="left" />
      </view>
      <!-- 标题 -->
      <view class="nav-center">
        <slot>
          <text class="nav-title" :style="{ color: textColor }">{{ title }}</text>
        </slot>
      </view>
      <!-- 右侧 -->
      <view class="nav-right">
        <slot name="right" />
      </view>
    </view>
  </view>
  <!-- 占位：让内容不被导航栏遮挡 -->
  <view :style="{ height: (statusBarHeight + navBarHeight) + 'px' }" />
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  title?: string
  bgColor?: string
  textColor?: string
  showBack?: boolean
}>(), {
  title: '',
  bgColor: '#ffffff',
  textColor: '#333333',
  showBack: true
})

const sysInfo = uni.getSystemInfoSync()
const statusBarHeight = ref(sysInfo.statusBarHeight || 0)
const navBarHeight = ref(sysInfo.platform === 'ios' ? 44 : 48)

function onBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 })
  } else {
    uni.switchTab({ url: '/pages/index/index' })
  }
}
</script>

<style scoped>
.nav-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 999; }
.nav-content { display: flex; align-items: center; padding: 0 16px; }
.nav-left { width: 60px; display: flex; align-items: center; }
.nav-center { flex: 1; display: flex; align-items: center; justify-content: center; }
.nav-right { width: 60px; display: flex; align-items: center; justify-content: flex-end; }
.nav-title { font-size: 17px; font-weight: 600; }
.back-icon { width: 24px; height: 24px; }
</style>
```

### 页面使用

```html
<template>
  <nav-bar title="商品详情" bg-color="#fff">
    <template #right>
      <text @click="onShare">分享</text>
    </template>
  </nav-bar>
  <!-- 页面内容 -->
</template>

<script setup lang="ts">
import NavBar from '@/components/NavBar.vue'
</script>
```

**pages.json 必须设置**：`"navigationStyle": "custom"`

---

## 7. 下拉刷新+触底加载列表

### 通用列表 Hook

```typescript
// hooks/useList.ts
import { ref, computed } from 'vue'

interface UseListOptions<T> {
  fetchData: (page: number, pageSize: number) => Promise<{ list: T[]; total: number }>
  pageSize?: number
}

export function useList<T extends { id: string | number }>(options: UseListOptions<T>) {
  const { fetchData, pageSize = 20 } = options

  const list = ref<T[]>([]) as Ref<T[]>
  const page = ref(1)
  const total = ref(0)
  const loading = ref(false)
  const refreshing = ref(false)

  const finished = computed(() : boolean => list.value.length >= total.value && total.value > 0)
  const empty = computed(() : boolean => list.value.length === 0 && !loading.value)

  async function load(reset = false) : Promise<void> {
    if (loading.value) return
    if (!reset && finished.value) return

    loading.value = true
    try {
      if (reset) page.value = 1
      const res = await fetchData(page.value, pageSize)
      if (reset) {
        list.value = res.list
      } else {
        list.value = [...list.value, ...res.list]
      }
      total.value = res.total
      page.value++
    } catch (err) {
      uni.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      loading.value = false
      refreshing.value = false
    }
  }

  async function onRefresh() : Promise<void> {
    refreshing.value = true
    await load(true)
  }

  async function onLoadMore() : Promise<void> {
    await load(false)
  }

  // 初始加载
  load(true)

  return {
    list,
    loading,
    refreshing,
    finished,
    empty,
    onRefresh,
    onLoadMore,
    refresh: () => load(true)
  }
}
```

### 页面使用

```html
<template>
  <scroll-view
    scroll-y
    class="page-list"
    :refresher-enabled="true"
    :refresher-triggered="refreshing"
    @refresherrefresh="onRefresh"
    @scrolltolower="onLoadMore"
  >
    <view v-for="item in list" :key="item.id" class="item" @click="goDetail(item)">
      <image :src="item.cover" mode="aspectFill" class="cover" />
      <text class="title">{{ item.title }}</text>
    </view>
    <view v-if="loading" class="status"><text>加载中...</text></view>
    <view v-if="finished" class="status"><text>没有更多了</text></view>
    <view v-if="empty" class="status"><text>暂无数据</text></view>
  </scroll-view>
</template>

<script setup lang="ts">
import { useList } from '@/hooks/useList'

const { list, loading, refreshing, finished, empty, onRefresh, onLoadMore } = useList<ArticleItem>({
  fetchData: async (page, pageSize) => {
    const res = await request<{ list: ArticleItem[]; total: number }>({
      url: '/api/articles',
      method: 'GET',
      data: { page, pageSize }
    })
    return res
  }
})

function goDetail(item: ArticleItem) {
  uni.navigateTo({ url: `/pages/article/detail?id=${item.id}` })
}
</script>

<style scoped>
.page-list { height: 100vh; }
.item { padding: 20rpx; }
.cover { width: 686rpx; height: 400rpx; border-radius: 12rpx; }
.title { font-size: 16px; color: #333; margin-top: 16rpx; }
.status { padding: 40rpx; text-align: center; color: #999; font-size: 14px; }
</style>
```

---

## 8. 表单验证

### 轻平台轻量验证

```typescript
// utils/validator.ts
type Rule = {
  required?: boolean
  message: string
  min?: number
  max?: number
  pattern?: RegExp
  validator?: (value: any) => boolean
}

type Rules = Record<string, Rule[]>

export function validate(formData: Record<string, any>, rules: Rules) : { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  for (const [field, fieldRules] of Object.entries(rules)) {
    const value = formData[field]

    for (const rule of fieldRules) {
      if (rule.required && (!value || (typeof value === 'string' && value.trim() === ''))) {
        errors[field] = rule.message
        break
      }
      if (rule.min !== undefined && typeof value === 'string' && value.length < rule.min) {
        errors[field] = rule.message
        break
      }
      if (rule.max !== undefined && typeof value === 'string' && value.length > rule.max) {
        errors[field] = rule.message
        break
      }
      if (rule.pattern && !rule.pattern.test(String(value))) {
        errors[field] = rule.message
        break
      }
      if (rule.validator && !rule.validator(value)) {
        errors[field] = rule.message
        break
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors }
}
```

### 常用规则预设

```typescript
// utils/validator-rules.ts
export const commonRules = {
  phone: { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
  email: { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: '请输入正确的邮箱' },
  idCard: { pattern: /^\d{17}[\dXx]$/, message: '请输入正确的身份证号' },
  url: { pattern: /^https?:\/\/.+/, message: '请输入正确的URL' },
  chinese: { pattern: /^[\u4e00-\u9fa5]+$/, message: '请输入中文' },
  password: {
    pattern: /^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z\d!@#$%^&*]{8,20}$/,
    message: '密码需8-20位，包含字母和数字'
  }
}
```

### 表单页面示例

```html
<template>
  <view class="form-page">
    <view class="form-item">
      <text class="label">手机号</text>
      <input v-model="form.phone" type="number" placeholder="请输入手机号" maxlength="11" />
      <text v-if="errors.phone" class="error">{{ errors.phone }}</text>
    </view>

    <view class="form-item">
      <text class="label">密码</text>
      <input v-model="form.password" type="safe-password" placeholder="请输入密码" password />
      <text v-if="errors.password" class="error">{{ errors.password }}</text>
    </view>

    <view class="form-item">
      <text class="label">邮箱</text>
      <input v-model="form.email" placeholder="请输入邮箱" />
      <text v-if="errors.email" class="error">{{ errors.email }}</text>
    </view>

    <button @click="onSubmit" :disabled="submitting" class="btn-submit">
      {{ submitting ? '提交中...' : '提交' }}
    </button>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { validate, commonRules } from '@/utils/validator'

const form = reactive({
  phone: '',
  password: '',
  email: ''
})

const errors = reactive<Record<string, string>>({})
const submitting = ref(false)

const rules = {
  phone: [
    { required: true, message: '请输入手机号' },
    commonRules.phone
  ],
  password: [
    { required: true, message: '请输入密码' },
    commonRules.password
  ],
  email: [
    { required: true, message: '请输入邮箱' },
    commonRules.email
  ]
}

async function onSubmit() {
  const result = validate(form, rules)
  Object.keys(errors).forEach(k => delete errors[k])
  Object.assign(errors, result.errors)

  if (!result.valid) {
    const firstError = Object.values(result.errors)[0]
    uni.showToast({ title: firstError, icon: 'none' })
    return
  }

  submitting.value = true
  try {
    await request({ url: '/api/register', method: 'POST', data: form })
    uni.showToast({ title: '注册成功', icon: 'success' })
  } catch (err) {
    uni.showToast({ title: '注册失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.form-item { padding: 24rpx 32rpx; }
.label { font-size: 14px; color: #333; margin-bottom: 12rpx; }
.error { font-size: 12px; color: #e43d33; margin-top: 8rpx; }
.btn-submit { margin: 60rpx 32rpx 0; }
</style>
```
