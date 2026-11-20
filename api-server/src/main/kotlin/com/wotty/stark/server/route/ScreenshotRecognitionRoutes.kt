package com.wotty.stark.server.route

import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.PartData
import io.ktor.server.application.call
import io.ktor.server.application.ApplicationCall
import io.ktor.server.auth.principal
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.request.receiveMultipart
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.LocalDateTime
import java.util.Base64

private const val MAX_RECOGNITION_IMAGE_BYTES = 10 * 1024 * 1024
private const val MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024
private val visionHttpClient: HttpClient = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(10))
    .followRedirects(HttpClient.Redirect.NEVER)
    .build()

@Serializable
private data class ScreenshotRecognitionTransaction(
    val type: String? = null,
    val amount: Double? = null,
    val merchant: String? = null,
    val date: String? = null,
    val platform: String? = null,
    val category: String? = null,
    val description: String? = null,
    val confidence: String = "low",
    val warnings: List<String> = emptyList(),
)

@Serializable
private data class ScreenshotRecognitionResponse(
    val transactions: List<ScreenshotRecognitionTransaction>,
    // Keep first-entry fields for older clients; current clients use transactions.
    val type: String?,
    val amount: Double?,
    val merchant: String?,
    val date: String?,
    val platform: String?,
    val category: String?,
    val description: String?,
    val confidence: String,
    val warnings: List<String>,
)

private data class UploadedScreenshot(val bytes: ByteArray, val mimeType: String)

fun Route.screenshotRecognitionRoutes() {
    post("/api/transactions/recognize-screenshot") {
        val userId = call.principal<JWTPrincipal>()?.payload?.getClaim("userId")?.asString()
            ?.takeIf(String::isNotBlank)
        if (userId == null) {
            call.respond(HttpStatusCode.Unauthorized, mapOf("error" to "请先登录云端账户"))
            return@post
        }
        val provider = try {
            resolveUserAIVisionConfig(userId).first
        } catch (_: Exception) {
            call.respond(HttpStatusCode.ServiceUnavailable, mapOf("error" to "个人 AI 配置无法解密，请在设置中重新保存或联系管理员"))
            return@post
        }
        if (provider.apiKey.isEmpty()) {
            call.respond(HttpStatusCode.ServiceUnavailable, mapOf("error" to "AI 识别服务尚未配置，请联系管理员"))
            return@post
        }

        val contentLength = call.request.headers[HttpHeaders.ContentLength]?.toLongOrNull()
        if (contentLength != null && contentLength > MAX_RECOGNITION_IMAGE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
            call.respond(HttpStatusCode.PayloadTooLarge, mapOf("error" to "图片超过 10 MiB，请压缩后重试"))
            return@post
        }

        val upload = try {
            call.receiveRecognitionImage()
        } catch (_: Exception) {
            call.respond(HttpStatusCode.BadRequest, mapOf("error" to "请选择一张 PNG、JPG 或 WebP 截图"))
            return@post
        }
        when (upload) {
            is RecognitionUploadResult.Invalid -> {
                call.respond(upload.status, mapOf("error" to upload.message))
                return@post
            }
            is RecognitionUploadResult.Valid -> {
                val result = try {
                    requestScreenshotRecognition(upload.image, provider)
                } catch (_: Exception) {
                    call.respond(HttpStatusCode.BadGateway, mapOf("error" to "截图识别失败，请稍后重试"))
                    return@post
                }
                if (result == null) {
                    call.respond(HttpStatusCode.UnprocessableEntity, mapOf("error" to "无法识别截图内容，请换一张清晰完整的截图重试"))
                    return@post
                }
                call.respond(HttpStatusCode.OK, result)
            }
        }
    }
}

private sealed interface RecognitionUploadResult {
    data class Valid(val image: UploadedScreenshot) : RecognitionUploadResult
    data class Invalid(val status: HttpStatusCode, val message: String) : RecognitionUploadResult
}

private suspend fun ApplicationCall.receiveRecognitionImage(): RecognitionUploadResult {
    val multipart = receiveMultipart()
    var imageBytes: ByteArray? = null
    var malformed = false
    var tooLarge = false

    while (true) {
        val part = multipart.readPart() ?: break
        try {
            if (part is PartData.FileItem && part.name == "image") {
                if (imageBytes != null) {
                    malformed = true
                    break
                }
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                val channel = part.provider()
                while (true) {
                    val count = channel.readAvailable(buffer, 0, buffer.size)
                    if (count < 0) break
                    if (count == 0) continue
                    if (output.size() + count > MAX_RECOGNITION_IMAGE_BYTES) {
                        tooLarge = true
                        break
                    }
                    output.write(buffer, 0, count)
                }
                if (!tooLarge) imageBytes = output.toByteArray()
            } else {
                malformed = true
                break
            }
        } finally {
            part.dispose()
        }
        if (tooLarge || malformed) break
    }

    if (tooLarge) return RecognitionUploadResult.Invalid(HttpStatusCode.PayloadTooLarge, "图片超过 10 MiB，请压缩后重试")
    val bytes = imageBytes
    if (malformed || bytes == null || bytes.isEmpty()) {
        return RecognitionUploadResult.Invalid(HttpStatusCode.BadRequest, "请选择一张 PNG、JPG 或 WebP 截图")
    }
    val mimeType = detectImageMime(bytes)
        ?: return RecognitionUploadResult.Invalid(HttpStatusCode.UnsupportedMediaType, "仅支持 PNG、JPG 或 WebP 图片")
    return RecognitionUploadResult.Valid(UploadedScreenshot(bytes, mimeType))
}

private fun detectImageMime(bytes: ByteArray): String? {
    if (bytes.size >= 8 && bytes.take(8).map { it.toInt() and 0xff } == listOf(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png"
    if (bytes.size >= 3 && (bytes[0].toInt() and 0xff) == 0xff && (bytes[1].toInt() and 0xff) == 0xd8 && (bytes[2].toInt() and 0xff) == 0xff) return "image/jpeg"
    if (bytes.size >= 12 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP") return "image/webp"
    return null
}

private suspend fun requestScreenshotRecognition(image: UploadedScreenshot, provider: AIVisionProviderConfig): ScreenshotRecognitionResponse? {
    val baseUrl = withContext(Dispatchers.IO) {
        normalizeAndValidateAIVisionBaseURL(provider.baseUrl, aiVisionPrivateEndpointsAllowed(), resolveHost = true)
    }
    val imageBase64 = Base64.getEncoder().encodeToString(image.bytes)
    val dataUrl = "data:${image.mimeType};base64,$imageBase64"
    val prompt = """识别这张支付或订单截图，提取可直接辅助记账的信息。严格遵守：
- 必须识别截图中的所有独立订单或交易，最多 20 笔。禁止只返回第一笔，也不要把多笔金额合并成总额。
- 对于购物平台的商品清单，如果每个商品行都显示各自的“实付”金额，每个商品行分别输出一笔 EXPENSE；description 写商品名、规格和数量，merchant 使用截图中可确认的商户。不要把这些商品行合并成整单一笔。
- 如果商品行只有单价而没有各自的实付金额，则整单只输出一笔，并使用整单实付金额；不能把商品单价当成交款金额。同一商品的多个规格或数量仍按截图中的商品行处理。
- 商品行金额已逐笔输出时，不要再把订单合计、优惠汇总或重复展示的同一订单作为额外支出。
- 商品下方的退款行严格按截图从上到下的顺序归属：某商品下方、下一商品上方显示的“重量不足退款”“差价已自动退款”等，只属于紧挨在它上面的商品；绝不能归给退款行下面的下一件商品。refundAmount 只能填在上方商品对应的交易中，paidAmount 仍填该商品原“实付”。例如：商品 A 实付 63.60，A 下方显示差价退款 2.23，随后才是商品 B 实付 3.89，则 A 的 paidAmount=63.60、refundAmount=2.23，B 的 paidAmount=3.89、refundAmount=0；最终 A 记 61.37，B 记 3.89，绝不能从 B 扣 2.23。同一商品下方、下一商品之前有多条已完成差价退款时，将退款金额累计到该商品。不要把关联商品的差价退款另记为收入。申请中或预计退款的 refundAmount 为 0。无法确认退款归属时不要猜，在 warnings 说明。后端会计算 paidAmount - refundAmount 作为最终支出。
- 与商品无关、明确已完成的独立退款才作为一笔 INCOME，分类为退款。
- paidAmount 取每笔实际实付金额；不确定、被遮挡或只出现商品原价时返回 null，不要猜。
- 只有截图明确表示已支付或完成交易时才判断为 EXPENSE；明确收款/退款时可用 INCOME；转账用 TRANSFER。看不清交易状态时 type 为 null。
- 商户尽量提取实际收款商户（如小象超市、拼多多）；支付宝或微信只是支付平台时，不要把它当商户。
- 分类必须从这些值中选最贴合的一项：餐饮、外卖、买菜、米面粮油、调料、蛋奶、速食、干货、闲食、水果、肉类、水产、糖果、甜品、下午茶、饮品、酒类、烟草、购物、服装、鞋类、箱包、配饰、美容、个人护理、理发、宠物、宠物食品、宠物洗护、宠物医疗、宠物寄养、母婴、玩具、礼物、红包、公益捐赠、借出、借入、收回借款、归还借款、交通、公交地铁、打车、出行、旅游、机票车票、过路费、住宿、加油、充电、汽车保养、停车费、住房、房租、物业费、家具、家电、装修、水费、电费、燃气、网费、清洁、清洁优化、日常清洁、家政、维修、日用、生活用品、快递跑腿、洗衣洗鞋、搬家、通讯、电子产品、数码配件、AI订阅、API、软件应用、云盘备份、云服务器、域名建站、网络加速、影音、打印、素材授权、医疗、药品、门诊、体检、牙科、康复理疗、体育、户外、教育、图书、文具办公、在线课程、数字阅读、娱乐、演出展览、游戏购买、游戏充值、短剧付费、会员订阅、工具、保险、税费手续费、花圃、运动、其他。依据商品明细分类；只知道平台而不知道商品时用购物或其他。
- 有明确细分类时优先使用细分类；AI订阅用于 AI 会员或订阅套餐，API用于接口调用或 Token 用量付费；游戏购买与游戏充值分开，宠物医疗与人员医疗分开。
- 如果类型为 INCOME，分类从工资、奖金、兼职、经营收入、报销、退款、租金、利息分红、补贴、二手转卖、理财、借入、收回借款中选；TRANSFER 的分类是转账。
- 明确个人借款往来时，借出、归还借款使用 EXPENSE，借入、收回借款使用 INCOME；不要把个人借款归还识别为贷款还款，也不要因画面出现转账就覆盖已确认的借款方向。
- 日期只提取截图中清晰可见的交易时间，格式 YYYY-MM-DDTHH:mm；否则返回 null。
- description 只可写简短商品/订单内容摘要；绝不包含订单号、商户单号、流水号、手机号、账号或支付凭证编号。
- confidence 为 high、medium、low 之一；任何关键字段不确定时降低置信度，并在 warnings 用中文简短说明。
只输出 JSON 对象，格式为 {"transactions":[{...}]}。transactions 中每一笔都必须包含 type、paidAmount、refundAmount、merchant、date、platform、category、description、confidence、warnings 字段；refundAmount 没有时返回 0。即使只有一笔也必须放在数组中。没有可识别交易时返回 {"transactions":[]}。平台只能是支付宝、微信、银行卡、现金、其他之一；未知值为 null。"""
    val anthropic = provider.apiFormat == "anthropic"
    val requestJson = if (anthropic) {
        buildJsonObject {
            put("model", provider.model)
            put("max_tokens", 2600)
            if (URI.create(baseUrl).host.equals("api.deepseek.com", ignoreCase = true)) {
                put("thinking", buildJsonObject { put("type", "disabled") })
            }
            put("system", prompt)
            put("messages", buildJsonArray {
                add(buildJsonObject {
                    put("role", "user")
                    put("content", buildJsonArray {
                        add(buildJsonObject { put("type", "text"); put("text", "请识别这张截图。") })
                        add(buildJsonObject {
                            put("type", "image")
                            put("source", buildJsonObject {
                                put("type", "base64")
                                put("media_type", image.mimeType)
                                put("data", imageBase64)
                            })
                        })
                    })
                })
            })
        }
    } else {
        buildJsonObject {
            put("model", provider.model)
            put("max_tokens", 2600)
            put("response_format", buildJsonObject { put("type", "json_object") })
            put("messages", buildJsonArray {
                add(buildJsonObject { put("role", "system"); put("content", prompt) })
                add(buildJsonObject {
                    put("role", "user")
                    put("content", buildJsonArray {
                        add(buildJsonObject { put("type", "text"); put("text", "请识别这张截图。") })
                        add(buildJsonObject {
                            put("type", "image_url")
                            put("image_url", buildJsonObject {
                                put("url", dataUrl)
                                put("detail", "high")
                            })
                        })
                    })
                })
            })
        }
    }.toString()
    val requestBuilder = HttpRequest.newBuilder(URI.create(
        if (anthropic) "$baseUrl/v1/messages" else "$baseUrl/chat/completions"
    )).timeout(Duration.ofSeconds(55)).header("Content-Type", "application/json")
    if (anthropic) {
        requestBuilder.header("x-api-key", provider.apiKey)
            .header("anthropic-version", "2023-06-01")
    } else {
        requestBuilder.header("Authorization", "Bearer ${provider.apiKey}")
    }
    val request = requestBuilder.POST(HttpRequest.BodyPublishers.ofString(requestJson)).build()

    val response = withContext(Dispatchers.IO) {
        visionHttpClient.send(request, HttpResponse.BodyHandlers.ofString())
    }
    if (response.statusCode() !in 200..299) throw IllegalStateException("Vision provider request failed")
    val content = runCatching {
        val body = Json.parseToJsonElement(response.body()).jsonObject
        if (anthropic) {
            body["content"]!!.jsonArray.mapNotNull { block ->
                val item = block.jsonObject
                if (item["type"]?.jsonPrimitive?.content == "text") item["text"]?.jsonPrimitive?.content else null
            }.joinToString("\n")
        } else {
            body["choices"]!!.jsonArray.first().jsonObject["message"]!!.jsonObject["content"]!!.jsonPrimitive.content
        }
    }.getOrNull()?.trim()?.removePrefix("```json")?.removePrefix("```")?.trim()?.removeSuffix("```")?.trim()
        ?: return null
    val parsed = extractRecognitionJsonObject(content) ?: return null
    val entries = (parsed["transactions"] as? JsonArray)
        ?.mapNotNull { it as? JsonObject }
        ?: listOf(parsed)
    val transactions = entries.take(20).map(::parseScreenshotRecognitionTransaction)
    val first = transactions.firstOrNull() ?: return null
    return ScreenshotRecognitionResponse(
        transactions = transactions,
        type = first.type,
        amount = first.amount,
        merchant = first.merchant,
        date = first.date,
        platform = first.platform,
        category = first.category,
        description = first.description,
        confidence = first.confidence,
        warnings = first.warnings,
    )
}

private fun parseScreenshotRecognitionTransaction(parsed: JsonObject): ScreenshotRecognitionTransaction {
    fun stringValue(field: String) = (parsed[field] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
    fun numberValue(field: String) = (parsed[field] as? kotlinx.serialization.json.JsonPrimitive)?.doubleOrNull
    val type = stringValue("type")?.takeIf { it in setOf("EXPENSE", "INCOME", "TRANSFER") }
    val explicitPaidAmount = numberValue("paidAmount")
        ?.takeIf { it > 0 && it <= 1_000_000_000 }
    val paidAmount = (explicitPaidAmount ?: numberValue("amount"))
        ?.takeIf { it > 0 && it <= 1_000_000_000 }
    val refundAmount = numberValue("refundAmount")?.takeIf { it > 0 && it <= 1_000_000_000 } ?: 0.0
    val amount = if (explicitPaidAmount != null) {
        val paid = BigDecimal.valueOf(explicitPaidAmount).setScale(2, RoundingMode.HALF_UP)
        val refund = BigDecimal.valueOf(refundAmount).setScale(2, RoundingMode.HALF_UP)
        (if (refundAmount > 0) paid.subtract(refund) else paid)
            .setScale(2, RoundingMode.HALF_UP)
            .toDouble()
            .takeIf { it > 0 && it <= 1_000_000_000 }
    } else {
        paidAmount
    }
    val merchant = stringValue("merchant")?.safeRecognitionText(120)
    val rawDate = stringValue("date")
    val date = rawDate?.takeIf { runCatching { LocalDateTime.parse(it) }.isSuccess }
    val platform = stringValue("platform")?.takeIf { it in setOf("支付宝", "微信", "银行卡", "现金", "其他") }
    val category = stringValue("category")?.safeRecognitionText(40)
    val description = stringValue("description")?.safeRecognitionDescription()
    val rawConfidence = stringValue("confidence")
    val confidence = rawConfidence?.takeIf { it == "high" || it == "medium" } ?: "low"
    val modelWarnings = (parsed["warnings"] as? JsonArray)?.mapNotNull {
        (it as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull?.safeRecognitionText(120)
    }.orEmpty()
    val refundWarning = if (explicitPaidAmount != null && refundAmount > 0) {
        val gross = BigDecimal.valueOf(explicitPaidAmount).setScale(2, RoundingMode.HALF_UP)
        val refund = BigDecimal.valueOf(refundAmount).setScale(2, RoundingMode.HALF_UP)
        val grossText = gross.toPlainString()
        val refundText = refund.toPlainString()
        if (amount != null) {
            val netText = BigDecimal.valueOf(amount).setScale(2, RoundingMode.HALF_UP).toPlainString()
            "原实付 ¥$grossText，已扣差价退款 ¥$refundText，最终记账 ¥$netText"
        } else {
            "差价退款 ¥$refundText 不低于原实付 ¥$grossText，请核对退款状态；该笔金额未自动填入"
        }
    } else null
    val warnings = (modelWarnings + listOfNotNull(refundWarning)).take(4)
    return ScreenshotRecognitionTransaction(type, amount, merchant, date, platform, category, description, confidence, warnings)
}

private fun extractRecognitionJsonObject(raw: String): JsonObject? {
    val text = raw.trim()
        .removePrefix("```json")
        .removePrefix("```")
        .removeSuffix("```")
        .trim()
    runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull()?.let { return it }

    var cursor = 0
    var lastValidObject: JsonObject? = null
    while (cursor < text.length) {
        val start = text.indexOf('{', cursor)
        if (start < 0) break

        var depth = 0
        var inString = false
        var escaped = false
        var end = -1
        scan@ for (index in start until text.length) {
            val char = text[index]
            if (inString) {
                if (escaped) escaped = false
                else when (char) {
                    '\\' -> escaped = true
                    '"' -> inString = false
                }
            } else {
                when (char) {
                    '"' -> inString = true
                    '{' -> depth += 1
                    '}' -> {
                        depth -= 1
                        if (depth == 0) {
                            end = index
                            break@scan
                        }
                    }
                }
            }
        }

        if (end >= start) {
            runCatching { Json.parseToJsonElement(text.substring(start, end + 1)).jsonObject }
                .getOrNull()?.let { lastValidObject = it }
            cursor = end + 1
        } else {
            cursor = start + 1
        }
    }
    return lastValidObject
}

private fun String.safeRecognitionText(maxLength: Int): String? = trim().takeIf { it.isNotEmpty() }?.take(maxLength)

private fun String.safeRecognitionDescription(): String? {
    val cleaned = replace(Regex("(?i)(订单号|订单编号|商户单号|交易号|流水号|支付凭证号|账单编号)\\s*[:：#-]?\\s*[a-z0-9_-]+"), "")
        .replace(Regex("\\b\\d{10,}\\b"), "")
        .trim(' ', '，', ',', '、', ';', '；', ':', '：', '-', '—')
    return cleaned.takeIf { it.isNotEmpty() }?.take(180)
}
