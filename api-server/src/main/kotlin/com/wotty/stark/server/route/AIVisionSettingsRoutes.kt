package com.wotty.stark.server.route

import com.wotty.stark.server.util.DatabaseFactory
import com.wotty.stark.server.util.UserAIVisionSettings
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.ApplicationCall
import io.ktor.server.auth.principal
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Routing
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Duration
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

private const val AI_VISION_ENCRYPTION_KEY_MIN_LENGTH = 32
private const val AI_VISION_GCM_NONCE_BYTES = 12
private val aiVisionRandom = SecureRandom()
private val aiVisionHttpClient: HttpClient = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(10))
    .followRedirects(HttpClient.Redirect.NEVER)
    .build()

@Serializable
data class AIVisionSettingsPayload(
    val baseUrl: String,
    val model: String,
    val apiKey: String = "",
)

@Serializable
private data class AIVisionSettingsResponse(
    val configured: Boolean,
    val source: String,
    val baseUrl: String,
    val model: String,
    val hasApiKey: Boolean,
    val hasPersonalConfiguration: Boolean,
    val encryptionReady: Boolean,
    val privateEndpointsAllowed: Boolean,
)

data class AIVisionProviderConfig(
    val baseUrl: String,
    val model: String,
    val apiKey: String,
)

@Serializable
private data class AIVisionMessage(val message: String)

private fun ApplicationCall.currentAIVisionUserId(): String = principal<JWTPrincipal>()
    ?.payload?.getClaim("userId")?.asString()
    ?.takeIf(String::isNotBlank)
    ?: error("Missing authenticated user")

internal fun defaultAIVisionProviderConfig(): AIVisionProviderConfig = AIVisionProviderConfig(
    baseUrl = System.getenv("AI_VISION_BASE_URL")?.trim()?.trimEnd('/')?.takeIf(String::isNotEmpty)
        ?: "https://api.openai.com/v1",
    model = System.getenv("AI_VISION_MODEL")?.trim()?.takeIf(String::isNotEmpty)
        ?: "gpt-4o-mini",
    apiKey = System.getenv("AI_VISION_API_KEY")?.trim().orEmpty(),
)

internal fun aiVisionEncryptionKey(): String = System.getenv("AI_VISION_ENCRYPTION_KEY")?.trim().orEmpty()

internal fun aiVisionPrivateEndpointsAllowed(): Boolean =
    System.getenv("AI_VISION_ALLOW_PRIVATE_ENDPOINTS")?.trim()?.equals("true", ignoreCase = true) == true

internal fun aiVisionEncryptionReady(): Boolean = aiVisionEncryptionKey().length >= AI_VISION_ENCRYPTION_KEY_MIN_LENGTH

internal fun resolveUserAIVisionConfig(userId: String): Pair<AIVisionProviderConfig, Boolean> {
    val saved = DatabaseFactory.getUserAIVisionSettings(userId)
        ?: return defaultAIVisionProviderConfig() to false
    val decrypted = decryptAIVisionKey(aiVisionEncryptionKey(), saved.encryptedApiKey)
    return AIVisionProviderConfig(saved.baseUrl, saved.model, decrypted) to true
}

internal fun normalizeAndValidateAIVisionBaseURL(raw: String, allowPrivate: Boolean, resolveHost: Boolean = false): String {
    val normalized = raw.trim().trimEnd('/')
    val uri = runCatching { URI(normalized) }.getOrNull()
        ?: throw IllegalArgumentException("请输入有效的模型服务地址")
    val host = uri.host?.lowercase()?.trimEnd('.')
        ?: throw IllegalArgumentException("请输入有效的模型服务地址")
    if (uri.userInfo != null || uri.rawQuery != null || uri.rawFragment != null) {
        throw IllegalArgumentException("模型服务地址不能包含账号、查询参数或片段")
    }
    if (!uri.scheme.equals("https", ignoreCase = true) && !(allowPrivate && uri.scheme.equals("http", ignoreCase = true))) {
        throw IllegalArgumentException("模型服务地址必须使用 HTTPS；私有服务需由服务器管理员显式允许")
    }
    if (!allowPrivate) {
        if (host == "localhost" || host.endsWith(".localhost")) {
            throw IllegalArgumentException("不能连接本机或内网地址；请联系服务器管理员开启私有模型地址")
        }
        val literal = runCatching {
            if (host.contains(':') || host.matches(Regex("[0-9.]+"))) InetAddress.getByName(host) else null
        }.getOrNull()
        if (literal != null && !isPublicVisionAddress(literal)) {
            throw IllegalArgumentException("不能连接本机或内网地址；请联系服务器管理员开启私有模型地址")
        }
        if (resolveHost) {
            val addresses = runCatching { InetAddress.getAllByName(host) }.getOrElse {
                throw IllegalArgumentException("无法解析模型服务地址")
            }
            if (addresses.isEmpty() || addresses.any { !isPublicVisionAddress(it) }) {
                throw IllegalArgumentException("模型服务地址解析到本机或内网，请联系服务器管理员开启私有模型地址")
            }
        }
    }
    return uri.toASCIIString()
}

private fun isPublicVisionAddress(address: InetAddress): Boolean {
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
        address.isSiteLocalAddress || address.isMulticastAddress
    ) return false
    val bytes = address.address.map { it.toInt() and 0xff }
    if (address is Inet6Address && bytes.isNotEmpty() && (bytes[0] and 0xfe) == 0xfc) return false
    if (address is Inet4Address && bytes.size == 4 && bytes[0] == 100 && bytes[1] in 64..127) return false
    return true
}

private fun deriveAIVisionKey(key: String): ByteArray = MessageDigest.getInstance("SHA-256")
    .digest(key.trim().toByteArray(Charsets.UTF_8))

private fun encryptAIVisionKey(masterKey: String, apiKey: String): String {
    require(masterKey.length >= AI_VISION_ENCRYPTION_KEY_MIN_LENGTH) {
        "服务器尚未配置 AI 密钥加密项，请联系管理员"
    }
    val nonce = ByteArray(AI_VISION_GCM_NONCE_BYTES).also(aiVisionRandom::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(deriveAIVisionKey(masterKey), "AES"), GCMParameterSpec(128, nonce))
    val encrypted = cipher.doFinal(apiKey.toByteArray(Charsets.UTF_8))
    return Base64.getEncoder().encodeToString(nonce + encrypted)
}

private fun decryptAIVisionKey(masterKey: String, encryptedKey: String): String {
    require(masterKey.length >= AI_VISION_ENCRYPTION_KEY_MIN_LENGTH) {
        "AI 密钥加密项不可用"
    }
    val payload = runCatching { Base64.getDecoder().decode(encryptedKey) }.getOrElse {
        throw IllegalStateException("AI 密钥加密数据无效")
    }
    require(payload.size > AI_VISION_GCM_NONCE_BYTES) { "AI 密钥加密数据无效" }
    val nonce = payload.copyOfRange(0, AI_VISION_GCM_NONCE_BYTES)
    val encrypted = payload.copyOfRange(AI_VISION_GCM_NONCE_BYTES, payload.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(deriveAIVisionKey(masterKey), "AES"), GCMParameterSpec(128, nonce))
    return runCatching { String(cipher.doFinal(encrypted), Charsets.UTF_8) }
        .getOrElse { throw IllegalStateException("无法解密 AI 密钥") }
}

private suspend fun testAIVisionConnection(provider: AIVisionProviderConfig, allowPrivate: Boolean) {
    require(provider.apiKey.isNotBlank()) { "请填写 API Key" }
    require(provider.model.isNotBlank()) { "请填写模型名称" }
    val baseUrl = withContext(Dispatchers.IO) {
        normalizeAndValidateAIVisionBaseURL(provider.baseUrl, allowPrivate, resolveHost = true)
    }
    val request = HttpRequest.newBuilder(URI.create("$baseUrl/models"))
        .timeout(Duration.ofSeconds(15))
        .header("Authorization", "Bearer ${provider.apiKey}")
        .GET()
        .build()
    val response = try {
        withContext(Dispatchers.IO) {
            aiVisionHttpClient.send(request, HttpResponse.BodyHandlers.discarding())
        }
    } catch (_: Exception) {
        throw IllegalArgumentException("连接模型服务失败，请检查地址、网络和证书")
    }
    if (response.statusCode() !in 200..299) {
        throw IllegalArgumentException("模型服务拒绝连接，请检查模型服务地址和 API Key")
    }
}

fun Routing.aiVisionSettingsRoutes() {
    route("/api/settings/ai-vision") {
        get {
            val userId = call.currentAIVisionUserId()
            val saved = DatabaseFactory.getUserAIVisionSettings(userId)
            val defaults = defaultAIVisionProviderConfig()
            val source = if (saved == null) "server" else "personal"
            val baseUrl = saved?.baseUrl ?: defaults.baseUrl
            val model = saved?.model ?: defaults.model
            val hasKey = if (saved == null) defaults.apiKey.isNotBlank() else saved.encryptedApiKey.isNotBlank()
            val personalKeyReadable = saved == null || runCatching {
                decryptAIVisionKey(aiVisionEncryptionKey(), saved.encryptedApiKey)
            }.isSuccess
            call.respond(
                AIVisionSettingsResponse(
                    configured = baseUrl.isNotBlank() && model.isNotBlank() && hasKey && personalKeyReadable,
                    source = source,
                    baseUrl = baseUrl,
                    model = model,
                    hasApiKey = hasKey,
                    hasPersonalConfiguration = saved != null,
                    encryptionReady = aiVisionEncryptionReady(),
                    privateEndpointsAllowed = aiVisionPrivateEndpointsAllowed(),
                )
            )
        }

        put {
            val userId = call.currentAIVisionUserId()
            val masterKey = aiVisionEncryptionKey()
            if (masterKey.length < AI_VISION_ENCRYPTION_KEY_MIN_LENGTH) {
                call.respond(HttpStatusCode.ServiceUnavailable, AIVisionMessage("服务器尚未配置 AI 密钥加密项，请联系管理员"))
                return@put
            }
            val payload = call.receive<AIVisionSettingsPayload>()
            val baseUrl: String
            val model = payload.model.trim()
            val apiKey = payload.apiKey.trim()
            if (payload.baseUrl.length > 2048 || model.length > 191 || apiKey.length > 8192) {
                call.respond(HttpStatusCode.BadRequest, AIVisionMessage("地址、模型名或 API Key 超出长度限制"))
                return@put
            }
            if (model.isBlank()) {
                call.respond(HttpStatusCode.BadRequest, AIVisionMessage("请填写模型服务地址和模型名称"))
                return@put
            }
            try {
                baseUrl = normalizeAndValidateAIVisionBaseURL(payload.baseUrl, aiVisionPrivateEndpointsAllowed())
            } catch (error: IllegalArgumentException) {
                call.respond(HttpStatusCode.BadRequest, AIVisionMessage(error.message ?: "模型服务地址无效"))
                return@put
            }

            val saved = DatabaseFactory.getUserAIVisionSettings(userId)
            val encryptedKey = if (apiKey.isNotBlank()) {
                encryptAIVisionKey(masterKey, apiKey)
            } else {
                val previous = saved?.encryptedApiKey
                if (previous.isNullOrBlank()) {
                    call.respond(HttpStatusCode.BadRequest, AIVisionMessage("首次保存个人模型配置时，请填写 API Key"))
                    return@put
                }
                try {
                    decryptAIVisionKey(masterKey, previous)
                } catch (_: Exception) {
                    call.respond(HttpStatusCode.ServiceUnavailable, AIVisionMessage("无法解密已保存的 AI 密钥，请重新填写并保存"))
                    return@put
                }
                previous
            }
            DatabaseFactory.saveUserAIVisionSettings(userId, UserAIVisionSettings(baseUrl, model, encryptedKey))
            call.respond(HttpStatusCode.OK, AIVisionMessage("AI 设置已保存"))
        }

        delete {
            DatabaseFactory.deleteUserAIVisionSettings(call.currentAIVisionUserId())
            call.respond(HttpStatusCode.OK, AIVisionMessage("已恢复服务器默认配置"))
        }

        post("/test") {
            val userId = call.currentAIVisionUserId()
            val payload = call.receive<AIVisionSettingsPayload>()
            val key = payload.apiKey.trim().ifBlank {
                val saved = DatabaseFactory.getUserAIVisionSettings(userId)
                if (saved == null) "" else try {
                    decryptAIVisionKey(aiVisionEncryptionKey(), saved.encryptedApiKey)
                } catch (_: Exception) {
                    call.respond(HttpStatusCode.ServiceUnavailable, AIVisionMessage("无法解密已保存的 AI 密钥，请重新填写"))
                    return@post
                }
            }
            try {
                testAIVisionConnection(
                    AIVisionProviderConfig(payload.baseUrl.trim(), payload.model.trim(), key),
                    aiVisionPrivateEndpointsAllowed(),
                )
            } catch (error: IllegalArgumentException) {
                call.respond(HttpStatusCode.BadGateway, AIVisionMessage(error.message ?: "模型服务连接失败"))
                return@post
            }
            call.respond(HttpStatusCode.OK, AIVisionMessage("模型服务连接成功"))
        }
    }
}
