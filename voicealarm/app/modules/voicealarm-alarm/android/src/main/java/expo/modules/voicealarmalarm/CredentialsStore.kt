package expo.modules.voicealarmalarm

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * JS 쪽 AuthContext 가 로그인/토큰 회전할 때마다 복사해 둔 자격증명.
 *
 * 앱이 완전히 종료된 상태로 AlarmManager 가 발화하면 JS 엔진이 아예 안 뜬다. 그 시점에
 * 발화 직전 재검증(GET /alarms/:id/validity) 을 하려면 네이티브 코드가 자기 힘으로
 * 서버를 호출해야 하고, 그러려면 토큰을 자기가 들고 있어야 한다.
 *
 * SecureStore(JS)가 쓰는 저장소를 직접 읽지 않고 별도로 둔 이유: expo-secure-store 의
 * 내부 파일명/키 스킴은 공개 API 가 아니라서 버전이 바뀌면 깨질 수 있다. 대신 JS 가
 * 명시적으로 setCredentials() 를 호출해서 값을 넘겨주는 쪽이 더 안정적이다.
 *
 * EncryptedSharedPreferences 를 쓰는 이유는 SecureStore 와 동급의 보호(Android Keystore 기반
 * 암호화)를 주기 위해서다 — 토큰을 평문 SharedPreferences 에 두면 루팅된 기기에서 그대로 읽힌다.
 */
class CredentialsStore(context: Context) {
    private val prefs: SharedPreferences by lazy {
        val masterKey =
            MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
        EncryptedSharedPreferences.create(
            context,
            "voicealarm_native_credentials",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    data class Credentials(
        val apiBaseUrl: String,
        val accessToken: String,
        val refreshToken: String,
    )

    fun save(credentials: Credentials) {
        prefs
            .edit()
            .putString(KEY_BASE_URL, credentials.apiBaseUrl)
            .putString(KEY_ACCESS_TOKEN, credentials.accessToken)
            .putString(KEY_REFRESH_TOKEN, credentials.refreshToken)
            .apply()
    }

    fun load(): Credentials? {
        val baseUrl = prefs.getString(KEY_BASE_URL, null) ?: return null
        val access = prefs.getString(KEY_ACCESS_TOKEN, null) ?: return null
        val refresh = prefs.getString(KEY_REFRESH_TOKEN, null) ?: return null
        return Credentials(baseUrl, access, refresh)
    }

    /** doRefresh 성공 후 access(+refresh) 토큰만 갱신한다. base URL 은 그대로 둔다. */
    fun updateTokens(
        accessToken: String,
        refreshToken: String,
    ) {
        prefs
            .edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_BASE_URL = "api_base_url"
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
    }
}
