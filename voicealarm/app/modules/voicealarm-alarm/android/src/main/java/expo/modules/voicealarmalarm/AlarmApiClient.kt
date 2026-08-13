package expo.modules.voicealarmalarm

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 발화 직전 재검증(GET /alarms/:id/validity) 전용 최소 HTTP 클라이언트.
 *
 * 앱 JS 의 ApiClient(client.ts)와 같은 재발급 규칙을 따른다: access 토큰이 401 이면
 * 딱 한 번 refresh 를 시도하고, 그래도 안 되면 포기한다. client.ts 와 달리 single-flight
 * 가드가 없다 — 이 클라이언트를 동시에 부르는 호출자가 AlarmReceiver 하나뿐이라
 * 경합이 생길 수가 없다.
 *
 * 의도적으로 외부 HTTP 라이브러리(OkHttp 등)를 쓰지 않았다. 네이티브 모듈 의존성을
 * 늘리면 그만큼 빌드가 깨질 표면이 늘어난다 — 표준 SDK 의 HttpURLConnection 만으로
 * 충분한 단순한 요청 두 개뿐이다.
 */
class AlarmApiClient(private val credentialsStore: CredentialsStore) {
    data class ValidityResult(val valid: Boolean, val reason: String?)

    /**
     * 서버에 물어볼 수 없으면(오프라인, 자격증명 없음 등) null 을 돌려준다.
     * 호출부(AlarmReceiver)는 null 이면 "확인할 수 없었다"로 보고 로컬 알람을 그대로 울린다
     * — 비행기 모드에서도 알람이 울려야 한다는 요구사항 때문이다. 서버가 명시적으로
     * valid:false 라고 답했을 때만 알람을 막는다.
     */
    fun checkValidity(alarmId: String): ValidityResult? {
        val credentials = credentialsStore.load() ?: return null

        val first = requestValidity(credentials.apiBaseUrl, alarmId, credentials.accessToken)
        if (first != null) return first

        val refreshed = refreshTokens(credentials.apiBaseUrl, credentials.refreshToken) ?: return null
        credentialsStore.updateTokens(refreshed.first, refreshed.second)
        return requestValidity(credentials.apiBaseUrl, alarmId, refreshed.first)
    }

    /** 발화 완료 보고. 실패해도 조용히 무시한다 — 통계용이지 안전 규칙이 아니다. */
    fun ack(
        alarmId: String,
        played: Boolean,
    ) {
        val credentials = credentialsStore.load() ?: return
        runCatching {
            val connection = openConnection(credentials.apiBaseUrl, "/alarms/$alarmId/ack", "POST")
            connection.setRequestProperty("Authorization", "Bearer ${credentials.accessToken}")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { it.write("{\"played\":$played}".toByteArray()) }
            connection.responseCode
            connection.disconnect()
        }
    }

    /** @return null 이면 "이 토큰으로는 답을 못 받았다"(401 또는 네트워크 오류) — 호출부가 refresh 를 시도한다. */
    private fun requestValidity(
        baseUrl: String,
        alarmId: String,
        accessToken: String,
    ): ValidityResult? =
        runCatching {
            val connection = openConnection(baseUrl, "/alarms/$alarmId/validity", "GET")
            connection.setRequestProperty("Authorization", "Bearer $accessToken")

            val code = connection.responseCode
            if (code != 200) {
                connection.errorStream?.close()
                connection.disconnect()
                return@runCatching null
            }

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()

            val json = JSONObject(body)
            ValidityResult(
                valid = json.optBoolean("valid", false),
                reason = if (json.isNull("reason")) null else json.optString("reason", null),
            )
        }.getOrNull()

    /** @return (새 access, 새 refresh) 또는 실패 시 null. */
    private fun refreshTokens(
        baseUrl: String,
        refreshToken: String,
    ): Pair<String, String>? =
        runCatching {
            val connection = openConnection(baseUrl, "/auth/refresh", "POST")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use {
                it.write("{\"refresh_token\":\"$refreshToken\"}".toByteArray())
            }

            if (connection.responseCode != 200) {
                connection.errorStream?.close()
                connection.disconnect()
                return@runCatching null
            }

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            connection.disconnect()

            val json = JSONObject(body)
            Pair(json.getString("access_token"), json.getString("refresh_token"))
        }.getOrNull()

    private fun openConnection(
        baseUrl: String,
        path: String,
        method: String,
    ): HttpURLConnection {
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = CONNECT_TIMEOUT_MS
        connection.readTimeout = READ_TIMEOUT_MS
        return connection
    }

    companion object {
        private const val CONNECT_TIMEOUT_MS = 8_000
        private const val READ_TIMEOUT_MS = 8_000
    }
}
