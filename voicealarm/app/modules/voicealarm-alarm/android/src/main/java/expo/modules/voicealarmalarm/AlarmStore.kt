package expo.modules.voicealarmalarm

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/**
 * 예약된 알람 목록의 유일한 진실 공급원.
 *
 * scheduleAlarm() 이 여기 쓰고, BootReceiver 가 재부팅 후 여기서 읽어 다시 AlarmManager 에
 * 등록한다. AlarmManager 자체는 재부팅 시 등록된 모든 알람을 잃어버리기 때문에, "무엇이
 * 예약돼 있었는가"를 우리가 직접 기억해 둬야 한다.
 */
class AlarmStore(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("voicealarm_scheduled_alarms", Context.MODE_PRIVATE)

    fun put(alarm: AlarmData) {
        prefs.edit().putString(alarm.alarmId, alarm.toJson().toString()).apply()
    }

    fun remove(alarmId: String) {
        prefs.edit().remove(alarmId).apply()
    }

    fun get(alarmId: String): AlarmData? {
        val raw = prefs.getString(alarmId, null) ?: return null
        return runCatching { AlarmData.fromJson(JSONObject(raw)) }.getOrNull()
    }

    fun all(): List<AlarmData> =
        prefs.all.values.mapNotNull { raw ->
            runCatching { AlarmData.fromJson(JSONObject(raw as String)) }.getOrNull()
        }
}
