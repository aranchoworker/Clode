package expo.modules.voicealarmalarm

import org.json.JSONObject

/**
 * 예약된 알람 하나를 나타낸다. AlarmStore 에 JSON 으로 직렬화해 둔다 — 재부팅 후
 * BootReceiver 가 이 정보만으로 AlarmManager 를 다시 채울 수 있어야 하기 때문이다
 * (그 시점에는 JS/React Native 가 전혀 떠 있지 않다).
 */
data class AlarmData(
    val alarmId: String,
    val triggerAtMillis: Long,
    val audioFilePath: String,
    val senderName: String,
    val title: String,
) {
    fun toJson(): JSONObject =
        JSONObject()
            .put("alarmId", alarmId)
            .put("triggerAtMillis", triggerAtMillis)
            .put("audioFilePath", audioFilePath)
            .put("senderName", senderName)
            .put("title", title)

    companion object {
        fun fromJson(json: JSONObject): AlarmData =
            AlarmData(
                alarmId = json.getString("alarmId"),
                triggerAtMillis = json.getLong("triggerAtMillis"),
                audioFilePath = json.getString("audioFilePath"),
                senderName = json.getString("senderName"),
                title = json.optString("title", ""),
            )
    }
}
