# NetworkModule

> 来源：https://kuikly.tds.qq.com/API/modules/network.html

HTTP请求模块

## requestGet方法
发送HTTP GET请求

参数：
- `url`: String - 请求url
- `param`: JSONObject - 请求参数
- `responseCallback`: NMAllResponse - 请求回调闭包

## requestPost方法
发送HTTP POST请求

参数：
- `url`: String - 请求url
- `param`: JSONObject - 请求参数
- `responseCallback`: NMAllResponse - 请求回调闭包

## httpRequest方法
发送HTTP通用请求方法

参数：
- `url`: String - 请求url
- `isPost`: Boolean - 是否为POST请求
- `param`: JSONObject - 请求参数
- `headers`: JSONObject (可选) - 请求头参数
- `cookie`: String (可选) - 请求cookie
- `timeout`: Int (可选) - 请求超时时间, 单位为秒
- `responseCallback`: NMAllResponse - 请求回调闭包

## requestGetBinary方法
发送二进制HTTP GET请求

参数：
- `url`: String - 请求url
- `param`: JSONObject - 请求参数
- `responseCallback`: NMDataResponse - 请求回调闭包

## requestPostBinary方法
发送二进制HTTP POST请求

参数：
- `url`: String - 请求url
- `bytes`: ByteArray - 请求参数
- `responseCallback`: NMDataResponse - 请求回调闭包

## httpRequestBinary方法
发送二进制HTTP通用请求方法

参数：
- `url`: String - 请求url
- `isPost`: Boolean - 是否为POST请求
- `bytes`: ByteArray - 请求参数
- `param`: JSONObject (可选) - 请求参数
- `headers`: JSONObject (可选) - 请求头参数
- `cookie`: String (可选) - 请求cookie
- `timeout`: Int (可选) - 请求超时时间, 单位为秒
- `responseCallback`: NMDataResponse - 请求回调闭包

## 类型说明

### NMAllResponse
```
NMAllResponse = (data: JSONObject, success: Boolean, errorMsg: String, response: NetworkResponse) -> Unit
```
- `data`: JSONObject - 返回数据
- `success`: Boolean - 请求是否成功
- `errorMsg`: String - 错误信息
- `response`: NetworkResponse - 响应包信息

### NMDataResponse
```
NMDataResponse = (data: ByteArray, success: Boolean, errorMsg: String, response: NetworkResponse) -> Unit
```
- `data`: ByteArray - 返回数据
- `success`: Boolean - 请求是否成功
- `errorMsg`: String - 错误信息
- `response`: NetworkResponse - 响应包信息

### NetworkResponse
- `headerFields`: JSONObject - 响应头参数
- `statusCode`: Int - 响应状态码
