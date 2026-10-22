# MemoryCacheModule

> 来源：https://kuikly.tds.qq.com/API/modules/memory-cache.html

页面级别内存缓存模块, 可以用来做**页面级别**的键值对缓存，通常用于复杂数据的缓存和传输。

注意：缓存有效期为页面级别, 页面退出后, 缓存就会失效

## setObject方法

缓存键值对

参数：
- `key`: String (必需) - 缓存key
- `value`: Any (必需) - 缓存值

## cacheImage方法

缓存图片

参数：
- `src`: String (必需) - 需要缓存的图片的源
- `sync`: Boolean (必需) - 是否同步缓存（本地资源和base64图片支持同步缓存）
- `callback`: ImageCacheCallback (可选) - 异步回调

返回值（同步缓存时）：
- `state`: String - 缓存图片的状态
- `errorCode`: Int - 错误码，0代表成功
- `errorMsg`: String - 错误信息
- `cacheKey`: String - 缓存图片的key